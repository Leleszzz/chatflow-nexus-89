import { getCol, collections } from "./mongo.js";
import { normalizeRole, isValidRole, ROLE_LABELS } from "../lib/roles.js";

// Migração one-time (idempotente) do esquema antigo de cargos — Administrador,
// Vendedora, Gerente, Suporte, Financeiro, Somente leitura — para admin/doutor/
// secretaria, e backfill de `ownerId` nas instâncias.
//
// Roda no boot, ao lado de reconcileOrphanInstances(). O projeto não tem
// framework de migração; este é o padrão que já existia.
export async function migrarCargos() {
  const usuarios = await migrarCargosDeUsuarios();
  const instancias = await backfillDonoDeInstancias();
  return { usuarios, instancias };
}

async function migrarCargosDeUsuarios() {
  const col = getCol(collections.users);
  const docs = await col.find({}, { projection: { _id: 1, role: 1, name: 1 } }).toArray();
  const pendentes = docs.filter(doc => !isValidRole(doc.role));
  if (!pendentes.length) return 0;

  const ops = pendentes.map(doc => ({
    updateOne: { filter: { _id: doc._id }, update: { $set: { role: normalizeRole(doc.role) } } },
  }));
  await col.bulkWrite(ops, { ordered: false });

  const resumo = pendentes
    .map(doc => `${doc.name || doc._id}: ${doc.role || "(vazio)"} → ${normalizeRole(doc.role)}`)
    .join("; ");
  console.log(`[cargos] migrados ${pendentes.length} usuário(s) — ${resumo}`);
  return pendentes.length;
}

async function backfillDonoDeInstancias() {
  const col = getCol(collections.instances);
  const semCampo = await col.updateMany({ ownerId: { $exists: false } }, { $set: { ownerId: null } });

  // Instância sem dono só é visível para o admin (fail-closed proposital): sem
  // este aviso, um doutor ou secretária "perderia" a instância dele em silêncio
  // logo depois do deploy.
  const orfas = await col.find({ ownerId: null }, { projection: { _id: 1, name: 1 } }).toArray();
  if (orfas.length) {
    const lista = orfas.map(i => `${i.name || i._id} (${i._id})`).join(", ");
    console.warn(
      `[cargos] ${orfas.length} instância(s) sem responsável: ${lista}. ` +
      `Enquanto ficarem assim, só o ${ROLE_LABELS.admin} as enxerga — defina o responsável em /instancias.`,
    );
  }
  return semCampo.modifiedCount || 0;
}
