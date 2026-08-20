import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.settings);
const DOC_ID = "app";

// Distribuição automática de leads. `assignCursor` é o contador do rodízio:
// um $inc atômico no Mongo, e não "quem foi o último", porque ler-decidir-gravar
// permite que dois clientes simultâneos escolham o mesmo vendedor — que é
// exatamente o bug que tínhamos com o cursor no localStorage de cada navegador.
const DEFAULT_LEAD_DISTRIBUTION = {
  enabled: false,
  strategy: "round-robin",
  eligibleUserIds: [],
  lastAssignedUserId: "",
  assignCursor: 0,
};

const emptyDay = () => ({ enabled: false, startTime: "18:00", endTime: "23:59" });
const DEFAULT_AGENT_SCHEDULE = {
  enabled: false,
  agentId: "",
  weekly: { 0: emptyDay(), 1: emptyDay(), 2: emptyDay(), 3: emptyDay(), 4: emptyDay(), 5: emptyDay(), 6: emptyDay() },
};

const DEFAULTS = {
  openai: { apiKey: "", defaultModel: "" },
  leadDistribution: DEFAULT_LEAD_DISTRIBUTION,
  agentSchedule: DEFAULT_AGENT_SCHEDULE,
};

const VALID_STRATEGIES = new Set(["round-robin", "load-balanced"]);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeLeadDistribution(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: Boolean(src.enabled),
    strategy: VALID_STRATEGIES.has(src.strategy) ? src.strategy : "round-robin",
    eligibleUserIds: Array.isArray(src.eligibleUserIds) ? src.eligibleUserIds.map(String) : [],
    lastAssignedUserId: src.lastAssignedUserId ? String(src.lastAssignedUserId) : "",
    assignCursor: Number.isInteger(src.assignCursor) && src.assignCursor >= 0 ? src.assignCursor : 0,
  };
}

export function normalizeAgentSchedule(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const weeklySrc = src.weekly && typeof src.weekly === "object" ? src.weekly : {};
  const weekly = {};
  for (let day = 0; day <= 6; day += 1) {
    const d = weeklySrc[day] || weeklySrc[String(day)] || {};
    const fallback = emptyDay();
    weekly[day] = {
      enabled: Boolean(d.enabled),
      // Horário inválido viraria uma janela que nunca abre (ou sempre) — melhor
      // cair no padrão do que gravar lixo que o front não sabe interpretar.
      startTime: HHMM.test(d.startTime) ? d.startTime : fallback.startTime,
      endTime: HHMM.test(d.endTime) ? d.endTime : fallback.endTime,
    };
  }
  return {
    enabled: Boolean(src.enabled),
    agentId: src.agentId ? String(src.agentId) : "",
    weekly,
  };
}

export async function getSettings() {
  const stored = (await col().findOne({ _id: DOC_ID }, { projection: { _id: 0 } })) || {};
  return {
    ...DEFAULTS,
    ...stored,
    openai: { ...DEFAULTS.openai, ...(stored.openai || {}) },
    leadDistribution: normalizeLeadDistribution(stored.leadDistribution),
    agentSchedule: normalizeAgentSchedule(stored.agentSchedule),
  };
}

export async function getOpenaiSettings() {
  const settings = await getSettings();
  return settings.openai;
}

export async function setOpenaiSettings(patch) {
  const current = await getSettings();
  const openai = { ...DEFAULTS.openai, ...(current.openai || {}), ...patch };
  await col().updateOne({ _id: DOC_ID }, { $set: { openai } }, { upsert: true });
  return { ...current, openai };
}

export async function clearOpenaiKey() {
  return setOpenaiSettings({ apiKey: "" });
}

export async function getLeadDistribution() {
  return (await getSettings()).leadDistribution;
}

// O cursor NÃO é sobrescrito pelo cliente: ele é estado interno do rodízio e um
// PUT vindo da tela de configuração não pode reiniciá-lo.
export async function setLeadDistribution(patch) {
  const current = await getLeadDistribution();
  const next = normalizeLeadDistribution({ ...current, ...patch, assignCursor: current.assignCursor });
  await col().updateOne({ _id: DOC_ID }, { $set: { leadDistribution: next } }, { upsert: true });
  return next;
}

/** Avança o rodízio de forma atômica e devolve o valor do contador. */
export async function nextAssignCursor() {
  const res = await col().findOneAndUpdate(
    { _id: DOC_ID },
    { $inc: { "leadDistribution.assignCursor": 1 } },
    { upsert: true, returnDocument: "after", projection: { _id: 0 } },
  );
  const doc = res?.value ?? res;
  return Number(doc?.leadDistribution?.assignCursor) || 0;
}

export async function rememberLastAssigned(userId) {
  await col().updateOne(
    { _id: DOC_ID },
    { $set: { "leadDistribution.lastAssignedUserId": String(userId || "") } },
    { upsert: true },
  );
}

export async function getAgentSchedule() {
  return (await getSettings()).agentSchedule;
}

export async function setAgentSchedule(patch) {
  const current = await getAgentSchedule();
  const next = normalizeAgentSchedule({ ...current, ...patch });
  await col().updateOne({ _id: DOC_ID }, { $set: { agentSchedule: next } }, { upsert: true });
  return next;
}

/**
 * A janela do agente programado está aberta agora? Espelha
 * isAgentScheduleActiveAt do front (src/store/crm-store.tsx) — inclusive o caso
 * da janela que vira a meia-noite (start > end).
 */
export function isAgentScheduleActiveAt(schedule, date = new Date()) {
  if (!schedule?.enabled) return false;
  const window = schedule.weekly?.[date.getDay()];
  if (!window?.enabled) return false;
  const toMinutes = time => {
    const [h, m] = String(time).split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  };
  const start = toMinutes(window.startTime);
  const end = toMinutes(window.endTime);
  if (start === null || end === null) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  return start <= end ? now >= start && now <= end : now >= start || now <= end;
}
