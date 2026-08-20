import { nanoid } from "nanoid";
import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.appointments);
const PROJ = { projection: { _id: 0 } };

const VALID_TYPES = new Set([
  "retorno", "reuniao", "follow-up", "ligacao",
  "demonstracao", "pos-venda", "retorno-comercial", "outro",
]);
const VALID_STATUS = new Set(["agendado", "concluido", "cancelado"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Mesmo shape do tipo Appointment do front (src/store/crm-store.tsx).
// Data e hora ficam separadas e em formato lexicograficamente ordenável, que é
// como o calendário já ordena e filtra.
export function normalizeAppointment(record) {
  const date = ISO_DATE.test(record?.date) ? record.date : "";
  const startTime = HHMM.test(record?.startTime) ? record.startTime : "";
  return {
    id: String(record?.id || `ap${Date.now()}-${nanoid(6)}`),
    title: String(record?.title || "").trim(),
    dealId: String(record?.dealId || ""),
    date,
    startTime,
    // Fim vazio ou anterior ao início vira o próprio início: melhor um evento
    // pontual do que um intervalo negativo que o calendário desenha invertido.
    endTime: HHMM.test(record?.endTime) && record.endTime >= startTime ? record.endTime : startTime,
    sellerId: String(record?.sellerId || ""),
    description: String(record?.description || ""),
    type: VALID_TYPES.has(record?.type) ? record.type : "outro",
    status: VALID_STATUS.has(record?.status) ? record.status : "agendado",
    origin: record?.origin ? String(record.origin) : undefined,
  };
}

export function validateAppointment(appointment) {
  if (!appointment.title) return "título é obrigatório";
  if (!appointment.date) return "data inválida (use AAAA-MM-DD)";
  if (!appointment.startTime) return "horário inicial inválido (use HH:MM)";
  return null;
}

export async function listAppointments() {
  const all = await col().find({}, PROJ).toArray();
  return all
    .map(normalizeAppointment)
    .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
}

export async function getAppointment(id) {
  return col().findOne({ _id: id }, PROJ);
}

export async function createAppointment(record) {
  const appointment = normalizeAppointment(record);
  const invalid = validateAppointment(appointment);
  if (invalid) throw new Error(invalid);
  await col().updateOne({ _id: appointment.id }, { $set: appointment }, { upsert: true });
  return appointment;
}

export async function patchAppointment(id, patch) {
  const existing = await getAppointment(id);
  if (!existing) return null;
  const updated = normalizeAppointment({ ...existing, ...patch, id });
  const invalid = validateAppointment(updated);
  if (invalid) throw new Error(invalid);
  await col().updateOne({ _id: id }, { $set: updated });
  return updated;
}

export async function deleteAppointment(id) {
  const res = await col().deleteOne({ _id: id });
  return res.deletedCount > 0;
}

// Cascade ao excluir um card: sem isto sobrariam compromissos apontando para um
// lead que não existe mais. Espelha deleteProntuariosByDeal.
export async function deleteAppointmentsByDeal(dealId) {
  const res = await col().deleteMany({ dealId: String(dealId) });
  return res.deletedCount || 0;
}
