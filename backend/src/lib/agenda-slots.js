// Aritmética de horário da agenda no backend. Espelha src/lib/agenda.ts — os
// dois precisam ser alterados juntos, e backend/tests/agenda-slots.test.js
// repete os casos de src/test/agenda.test.ts justamente para travar a paridade
// (não dá para importar o TS daqui).
//
// A diferença deliberada: o front tem `computeFreeTimeButtons`, que AMOSTRA no
// máximo cinco horários porque são botões numa tela estreita. Aqui a função
// devolve a lista inteira — o assistente responde "quais meus horários livres"
// e omitir opção seria mentir.

/** Faixa de atendimento. Mesma constante de src/lib/agenda.ts. */
export const HOUR_SLOTS = [9, 10, 11, 12, 13, 14, 15, 16, 17];

export function minutesFromTime(time) {
  const [hours, minutes] = String(time || "0:0").split(":").map(Number);
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

export function timeFromMinutes(totalMinutes) {
  const t = Math.max(0, Math.floor(Number(totalMinutes) || 0));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * Compromissos que disputam a agenda de um profissional num dia.
 *
 * Compromisso sem `sellerId` conta para todo mundo — é mais seguro oferecer um
 * horário a menos do que marcar duas pessoas no mesmo lugar. Cancelado não
 * ocupa nada.
 */
function concorrentes(appointments, dateKey, sellerId) {
  return (appointments || []).filter(a => {
    if (a?.date !== dateKey) return false;
    if (a.status === "cancelado") return false;
    if (sellerId && a.sellerId && a.sellerId !== sellerId) return false;
    return true;
  });
}

/**
 * Horas cheias livres de um dia, lista completa.
 *
 * `duracaoMin` permite perguntar por uma janela maior que uma hora: com 90, o
 * horário das 9h só entra se as 9h e as 10h estiverem ambas livres.
 */
export function horariosLivresNoDia(dateKey, appointments, sellerId, duracaoMin = 60) {
  const ocupados = concorrentes(appointments, dateKey, sellerId);
  const duracao = Math.max(15, Number(duracaoMin) || 60);
  const ultimoFim = (HOUR_SLOTS[HOUR_SLOTS.length - 1] + 1) * 60;

  return HOUR_SLOTS.filter(h => {
    const slotStart = h * 60;
    const slotEnd = slotStart + duracao;
    // Janela que passaria do fim do expediente não é horário livre.
    if (slotEnd > ultimoFim) return false;
    return !ocupados.some(c =>
      minutesFromTime(c.startTime) < slotEnd && minutesFromTime(c.endTime) > slotStart,
    );
  });
}

/** Compromissos que colidem com uma janela. Vazio = pode marcar. */
export function conflitosNoHorario(appointments, { date, startTime, endTime, sellerId, ignorarId } = {}) {
  const inicio = minutesFromTime(startTime);
  const fim = minutesFromTime(endTime);
  return concorrentes(appointments, date, sellerId).filter(a => {
    if (ignorarId && a.id === ignorarId) return false;
    return minutesFromTime(a.startTime) < fim && minutesFromTime(a.endTime) > inicio;
  });
}
