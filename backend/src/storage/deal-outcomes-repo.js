import { nanoid } from "nanoid";
import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.dealOutcomes);
const PROJ = { projection: { _id: 0 } };

const VALID_RESULTS = new Set(["venda", "recusa"]);

// O fechamento de um atendimento: venda ou recusa, com os detalhes que o
// operador preencheu. Antes isto vivia só em memória no cliente e sumia a cada
// refresh — só `stage` e `estimatedValue` chegavam ao banco, pelo deal.
export function normalizeOutcome(record) {
  const amount = Number(record?.amount);
  return {
    id: String(record?.id || `do${Date.now()}-${nanoid(6)}`),
    dealId: String(record?.dealId || ""),
    result: VALID_RESULTS.has(record?.result) ? record.result : "venda",
    amount: Number.isFinite(amount) ? amount : undefined,
    description: record?.description ? String(record.description) : undefined,
    product: record?.product ? String(record.product) : undefined,
    payment: record?.payment ? String(record.payment) : undefined,
    reason: record?.reason ? String(record.reason) : undefined,
    notes: record?.notes ? String(record.notes) : undefined,
    finishedAt: record?.finishedAt || new Date().toISOString(),
    operatorId: String(record?.operatorId || ""),
  };
}

export async function listDealOutcomes() {
  const all = await col().find({}, PROJ).toArray();
  return all
    .map(normalizeOutcome)
    .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
}

export async function createDealOutcome(record) {
  const outcome = normalizeOutcome(record);
  if (!outcome.dealId) throw new Error("dealId é obrigatório");
  await col().updateOne({ _id: outcome.id }, { $set: outcome }, { upsert: true });
  return outcome;
}

// Excluir o card leva junto o histórico de fechamento dele.
export async function deleteOutcomesByDeal(dealId) {
  const res = await col().deleteMany({ dealId: String(dealId) });
  return res.deletedCount || 0;
}
