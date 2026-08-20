import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLeadDistribution,
  normalizeAgentSchedule,
  isAgentScheduleActiveAt,
} from "../src/storage/settings-repo.js";
import { normalizeAppointment, validateAppointment } from "../src/storage/appointments-repo.js";
import { normalizeOutcome } from "../src/storage/deal-outcomes-repo.js";
import { normalizeTagName } from "../src/storage/tags-repo.js";

// ---- Distribuição de leads ----

test("cursor do rodízio só aceita inteiro não-negativo", () => {
  assert.equal(normalizeLeadDistribution({ assignCursor: 7 }).assignCursor, 7);
  assert.equal(normalizeLeadDistribution({ assignCursor: -1 }).assignCursor, 0);
  assert.equal(normalizeLeadDistribution({ assignCursor: 1.5 }).assignCursor, 0);
  assert.equal(normalizeLeadDistribution({}).assignCursor, 0);
});

test("estratégia desconhecida cai em round-robin", () => {
  assert.equal(normalizeLeadDistribution({ strategy: "load-balanced" }).strategy, "load-balanced");
  assert.equal(normalizeLeadDistribution({ strategy: "aleatorio" }).strategy, "round-robin");
});

// ---- Agente programado ----

test("agenda semanal sempre tem os 7 dias, mesmo vinda incompleta", () => {
  const schedule = normalizeAgentSchedule({ enabled: true, weekly: { 2: { enabled: true, startTime: "08:00", endTime: "12:00" } } });
  assert.deepEqual(Object.keys(schedule.weekly), ["0", "1", "2", "3", "4", "5", "6"]);
  assert.equal(schedule.weekly[2].startTime, "08:00");
  assert.equal(schedule.weekly[5].enabled, false);
});

test("horário inválido cai no padrão em vez de gravar lixo", () => {
  const dia = normalizeAgentSchedule({ weekly: { 1: { enabled: true, startTime: "25:00", endTime: "abc" } } }).weekly[1];
  assert.equal(dia.startTime, "18:00");
  assert.equal(dia.endTime, "23:59");
});

test("janela do agente: dentro, fora e virando a meia-noite", () => {
  const janela = (startTime, endTime) => ({
    enabled: true, agentId: "a1",
    weekly: { 3: { enabled: true, startTime, endTime } },
  });
  // 2026-08-19 é uma quarta-feira (dia 3).
  const as = h => new Date(`2026-08-19T${h}:00`);

  assert.equal(isAgentScheduleActiveAt(janela("18:00", "23:59"), as("20:00")), true);
  assert.equal(isAgentScheduleActiveAt(janela("18:00", "23:59"), as("10:00")), false);
  // Janela que atravessa a meia-noite: 22h→06h vale às 23h.
  assert.equal(isAgentScheduleActiveAt(janela("22:00", "06:00"), as("23:00")), true);
  assert.equal(isAgentScheduleActiveAt(janela("22:00", "06:00"), as("12:00")), false);
});

test("agenda desligada nunca está ativa, mesmo dentro da janela", () => {
  const schedule = normalizeAgentSchedule({ enabled: false, weekly: { 3: { enabled: true, startTime: "00:00", endTime: "23:59" } } });
  assert.equal(isAgentScheduleActiveAt(schedule, new Date("2026-08-19T12:00:00")), false);
});

// ---- Agenda (compromissos) ----

test("compromisso exige título, data e hora válidos", () => {
  const ok = normalizeAppointment({ title: "Retorno", date: "2026-08-20", startTime: "09:00", endTime: "09:30" });
  assert.equal(validateAppointment(ok), null);

  assert.match(validateAppointment(normalizeAppointment({ date: "2026-08-20", startTime: "09:00" })), /título/);
  assert.match(validateAppointment(normalizeAppointment({ title: "x", date: "20/08/2026", startTime: "09:00" })), /data/);
  assert.match(validateAppointment(normalizeAppointment({ title: "x", date: "2026-08-20", startTime: "9h" })), /horário/);
});

test("fim anterior ao início vira evento pontual, não intervalo negativo", () => {
  const a = normalizeAppointment({ title: "x", date: "2026-08-20", startTime: "14:00", endTime: "10:00" });
  assert.equal(a.endTime, "14:00");
});

test("tipo e status desconhecidos caem no padrão", () => {
  const a = normalizeAppointment({ title: "x", date: "2026-08-20", startTime: "09:00", type: "churrasco", status: "talvez" });
  assert.equal(a.type, "outro");
  assert.equal(a.status, "agendado");
});

// ---- Fechamentos ----

test("fechamento preserva os campos que antes eram descartados", () => {
  const o = normalizeOutcome({
    dealId: "d1", result: "venda", amount: 2500, product: "Plano Pro",
    payment: "Cartão 3x", notes: "fechou rápido", finishedAt: "2026-08-19T10:00:00.000Z", operatorId: "s1",
  });
  assert.equal(o.amount, 2500);
  assert.equal(o.product, "Plano Pro");
  assert.equal(o.payment, "Cartão 3x");
  assert.equal(o.notes, "fechou rápido");
  assert.equal(o.operatorId, "s1");
  assert.ok(o.id, "precisa de id próprio para o socket não duplicar a linha");
});

test("resultado inválido não vira recusa por acidente", () => {
  assert.equal(normalizeOutcome({ dealId: "d1", result: "talvez" }).result, "venda");
  assert.equal(normalizeOutcome({ dealId: "d1", result: "recusa" }).result, "recusa");
});

test("valor não numérico não é gravado como NaN", () => {
  assert.equal(normalizeOutcome({ dealId: "d1", amount: "abc" }).amount, undefined);
});

// ---- Tags ----

test("nome de tag é normalizado (a tag É a sua chave)", () => {
  assert.equal(normalizeTagName("  Cliente   antigo  "), "Cliente antigo");
  assert.equal(normalizeTagName(""), "");
  assert.equal(normalizeTagName(null), "");
});
