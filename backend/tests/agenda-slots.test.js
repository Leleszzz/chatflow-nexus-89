import test from "node:test";
import assert from "node:assert/strict";
import {
  HOUR_SLOTS, minutesFromTime, timeFromMinutes, horariosLivresNoDia, conflitosNoHorario,
} from "../src/lib/agenda-slots.js";

// Estes casos são os mesmos de src/test/agenda.test.ts, de propósito: a regra de
// horário livre agora existe nos dois lados (o front desenha os botões, o
// assistente responde "quais meus horários livres"). Não dá para importar o TS
// daqui, então a paridade é travada repetindo os casos. Divergiu aqui, divergiu
// lá — e o médico vê um horário no chat que a tela não oferece.

const compromisso = (over = {}) => ({
  id: "ap1", title: "Consulta", dealId: "d1", date: "2026-09-03",
  startTime: "09:00", endTime: "10:00", sellerId: "u1", description: "",
  type: "retorno", status: "agendado", ...over,
});

test("converte horário ida e volta", () => {
  assert.equal(minutesFromTime("09:30"), 570);
  assert.equal(timeFromMinutes(570), "09:30");
  assert.equal(timeFromMinutes(minutesFromTime("08:00")), "08:00");
});

test("tira da lista a hora ocupada pelo profissional", () => {
  const livres = horariosLivresNoDia("2026-09-03", [compromisso()], "u1");
  assert.ok(!livres.includes(9), "9h estava ocupada e apareceu como livre");
  assert.ok(livres.includes(10));
});

test("ignora compromisso de outro profissional", () => {
  const livres = horariosLivresNoDia("2026-09-03", [compromisso({ sellerId: "u2" })], "u1");
  assert.ok(livres.includes(9));
});

test("compromisso sem responsável ocupa para todo mundo", () => {
  // Mais seguro oferecer um horário a menos do que marcar dois no mesmo lugar.
  const livres = horariosLivresNoDia("2026-09-03", [compromisso({ sellerId: "" })], "u1");
  assert.ok(!livres.includes(9));
});

test("ignora compromisso cancelado e de outro dia", () => {
  const lista = [compromisso({ status: "cancelado" }), compromisso({ id: "ap2", date: "2026-09-04" })];
  assert.ok(horariosLivresNoDia("2026-09-03", lista, "u1").includes(9));
});

test("dia vazio devolve a faixa inteira, sem amostrar", () => {
  // Aqui está a diferença deliberada em relação ao front: computeFreeTimeButtons
  // corta em cinco porque são botões numa tela estreita. O assistente responde
  // em texto e omitir opção seria mentir.
  assert.deepEqual(horariosLivresNoDia("2026-09-03", [], "u1"), HOUR_SLOTS);
});

test("duração maior exige as horas seguintes livres", () => {
  // Ocupa as 10h: uma janela de 2h às 9h não cabe mais, mas a de 1h sim.
  const lista = [compromisso({ startTime: "10:00", endTime: "11:00" })];
  assert.ok(horariosLivresNoDia("2026-09-03", lista, "u1", 60).includes(9));
  assert.ok(!horariosLivresNoDia("2026-09-03", lista, "u1", 120).includes(9));
});

test("janela que passa do fim do expediente não é horário livre", () => {
  const livres = horariosLivresNoDia("2026-09-03", [], "u1", 120);
  assert.ok(!livres.includes(17), "17h + 2h termina às 19h, fora da faixa");
  assert.ok(livres.includes(16));
});

test("acusa sobreposição parcial", () => {
  const janela = { date: "2026-09-03", startTime: "09:30", endTime: "10:30", sellerId: "u1" };
  assert.equal(conflitosNoHorario([compromisso()], janela).length, 1);
});

test("encostar no fim não é conflito", () => {
  const colado = { date: "2026-09-03", startTime: "10:00", endTime: "11:00", sellerId: "u1" };
  assert.equal(conflitosNoHorario([compromisso()], colado).length, 0);
});

test("não acusa o próprio compromisso ao remarcá-lo", () => {
  const janela = { date: "2026-09-03", startTime: "09:30", endTime: "10:30", sellerId: "u1", ignorarId: "ap1" };
  assert.equal(conflitosNoHorario([compromisso()], janela).length, 0);
});
