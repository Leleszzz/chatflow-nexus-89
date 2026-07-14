import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.leadList);

// Chave de casamento entre o telefone do arquivo e o JID do WhatsApp.
//
// O arquivo traz o número sem DDI (27997230505) enquanto o JID traz com DDI
// (5527997230505) — e, para contas antigas, o WhatsApp OMITE o nono dígito
// (552797230505). Normalizar para DDD + os 8 últimos dígitos faz as três formas
// caírem na mesma chave.
export function phoneKey(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  // Remove o DDI 55 só quando sobra número demais para ser um DDD+telefone
  // nacional (evita comer o DDD 55, do interior do RS).
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length < 10) return "";
  return d.slice(0, 2) + d.slice(2).slice(-8);
}

// Layout esperado: NM_PSSA|NU_DOCUMENTO|NU_FONE_TERMINAL (pipe, com cabeçalho).
const COLUNAS_PADRAO = { idxNome: 0, idxDoc: 1, idxFone: 2 };

// Detecta o cabeçalho e a posição das colunas nele. Devolve null quando a linha
// não é cabeçalho (aí valem as posições padrão).
export function parseLeadsHeader(linha) {
  const texto = String(linha || "").replace(/^﻿/, "").toUpperCase();
  if (!texto.includes("NU_FONE") && !texto.includes("NM_PSSA")) return null;
  const cols = texto.split("|").map(c => c.trim());
  const acha = (...nomes) => cols.findIndex(c => nomes.some(n => c.includes(n)));
  const n = acha("NM_PSSA", "NOME");
  const d = acha("NU_DOCUMENTO", "DOCUMENTO", "CPF");
  const f = acha("NU_FONE", "FONE", "TELEFONE");
  return {
    idxNome: n >= 0 ? n : COLUNAS_PADRAO.idxNome,
    idxDoc: d >= 0 ? d : COLUNAS_PADRAO.idxDoc,
    idxFone: f >= 0 ? f : COLUNAS_PADRAO.idxFone,
  };
}

// Uma linha de dados -> registro, ou null se não houver telefone válido.
export function parseLeadLine(linha, colunas = COLUNAS_PADRAO) {
  if (!linha || !linha.trim()) return null;
  const campos = String(linha).replace(/^﻿/, "").split("|").map(c => c.trim());
  const telefone = campos[colunas.idxFone] || "";
  const key = phoneKey(telefone);
  if (!key) return null;
  return {
    _id: key,
    phoneKey: key,
    nome: campos[colunas.idxNome] || "",
    documento: (campos[colunas.idxDoc] || "").replace(/\D/g, ""),
    telefone: telefone.replace(/\D/g, ""),
  };
}

// Versão em memória — usada nos testes e para arquivos pequenos. Arquivos
// grandes são importados em streaming pela rota (não cabem em uma string).
export function parseLeadsTxt(text) {
  const linhas = String(text || "").split(/\r?\n/);
  const registros = [];
  const invalidas = [];

  const doCabecalho = parseLeadsHeader(linhas[0]);
  const colunas = doCabecalho || COLUNAS_PADRAO;
  const comecoDados = doCabecalho ? 1 : 0;

  for (let i = comecoDados; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha || !linha.trim()) continue;
    const registro = parseLeadLine(linha, colunas);
    if (registro) registros.push(registro);
    else invalidas.push({ linha: i + 1, conteudo: linha.slice(0, 60) });
  }
  return { registros, invalidas };
}

// Grava os registros (upsert por telefone). Importar de novo ATUALIZA os
// existentes e adiciona os novos, sem apagar o que já estava na lista.
export async function upsertLeads(registros, { importadoPor = "" } = {}) {
  if (!registros?.length) return { inseridos: 0, atualizados: 0 };
  const agora = new Date().toISOString();
  // Duas linhas do mesmo número no lote gerariam duplicidade de _id no
  // bulkWrite (E11000). Fica a última ocorrência.
  const porChave = new Map();
  for (const r of registros) porChave.set(r._id, r);
  const ops = [...porChave.values()].map(r => ({
    updateOne: {
      filter: { _id: r._id },
      update: { $set: { ...r, importadoEm: agora, importadoPor } },
      upsert: true,
    },
  }));
  const res = await col().bulkWrite(ops, { ordered: false });
  return {
    inseridos: res.upsertedCount || 0,
    atualizados: res.modifiedCount || 0,
  };
}

// Busca o registro da lista para um telefone/JID qualquer. Devolve null se o
// número não estiver na lista importada.
export async function findLeadByPhone(raw) {
  const key = phoneKey(raw);
  if (!key) return null;
  return col().findOne({ _id: key }, { projection: { _id: 0 } });
}

export async function leadStats() {
  const total = await col().countDocuments();
  const ultimo = await col()
    .find({}, { projection: { importadoEm: 1, _id: 0 } })
    .sort({ importadoEm: -1 })
    .limit(1)
    .toArray();
  return { total, ultimaImportacao: ultimo[0]?.importadoEm || "" };
}

export async function clearLeads() {
  const res = await col().deleteMany({});
  return res.deletedCount || 0;
}
