#!/usr/bin/env node
/**
 * Cifra as chaves de API que já estão gravadas em texto puro no banco.
 *
 * A cifragem em repouso entrou depois que o sistema já estava em uso, então o
 * que foi salvo antes continua em claro na coleção `settings`. O código lê os
 * dois formatos (ver lib/segredos.js), mas enquanto o valor antigo estiver lá,
 * um dump do banco entrega as credenciais.
 *
 * Uso:
 *   node scripts/cifrar-segredos.js --dry-run   (só mostra o que faria)
 *   node scripts/cifrar-segredos.js             (aplica)
 */
import { connectMongo, closeMongo, getCol, collections } from "../src/storage/mongo.js";
import { cifrar, estaCifrado, cifragemAtiva } from "../src/lib/segredos.js";

const simulacao = process.argv.includes("--dry-run");

function mascarar(valor) {
  if (!valor) return "(vazio)";
  if (estaCifrado(valor)) return "(já cifrado)";
  return `${valor.slice(0, 6)}…${valor.slice(-4)} (${valor.length} chars, EM CLARO)`;
}

async function main() {
  if (!cifragemAtiva()) {
    console.error(
      "\nSECRETS_KEY não está definida no backend/.env — não há com o que cifrar.\n" +
      'Gere uma com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n',
    );
    process.exit(1);
  }

  await connectMongo();
  const col = getCol(collections.settings);
  const doc = await col.findOne({ _id: "app" });

  if (!doc) {
    console.log("Nenhuma configuração gravada ainda — nada a fazer.");
    await closeMongo();
    return;
  }

  const campos = [
    ["openai.apiKey", doc.openai?.apiKey],
    ["transcription.groqApiKey", doc.transcription?.groqApiKey],
    ["transcription.assemblyaiApiKey", doc.transcription?.assemblyaiApiKey],
  ];

  console.log("\nEstado atual:\n");
  for (const [caminho, valor] of campos) {
    console.log(`  ${caminho.padEnd(34)} ${mascarar(valor)}`);
  }

  const paraCifrar = campos.filter(([, v]) => v && !estaCifrado(v));
  if (!paraCifrar.length) {
    console.log("\nTudo já está cifrado (ou vazio). Nada a fazer.\n");
    await closeMongo();
    return;
  }

  if (simulacao) {
    console.log(`\n[simulação] ${paraCifrar.length} campo(s) seriam cifrados. Rode sem --dry-run para aplicar.\n`);
    await closeMongo();
    return;
  }

  const set = {};
  for (const [caminho, valor] of paraCifrar) set[caminho] = cifrar(valor);
  await col.updateOne({ _id: "app" }, { $set: set });

  console.log(`\n✓ ${paraCifrar.length} campo(s) cifrado(s).`);
  console.log("\nIMPORTANTE: guarde a SECRETS_KEY junto do backup do banco. Sem ela,");
  console.log("as chaves cifradas não voltam — será preciso cadastrá-las de novo em");
  console.log("Configurações.\n");

  await closeMongo();
}

main().catch(async err => {
  console.error("falhou:", err.message);
  await closeMongo().catch(() => {});
  process.exit(1);
});
