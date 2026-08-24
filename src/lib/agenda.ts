/** Aritmética de horário da agenda — sem React, para poder ser testada direto. */

import { Appointment } from "@/lib/mock-data";

export const minutesFromTime = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

export const timeFromMinutes = (totalMinutes: number) =>
  `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Horário de início depois de arrastar um agendamento na grade.
 *
 * O deslocamento vertical em pixels vira minutos (uma hora = `hourHeight` px),
 * encaixado de 15 em 15 — a mesma resolução do clique que cria o agendamento.
 * O resultado nunca escapa da grade: o fim do compromisso é respeitado, então
 * um card de uma hora não para meia hora depois do último horário exibido.
 */
export function novoHorarioAoArrastar({ startTime, endTime, deltaY, hourHeight, gradeInicio, gradeFim }: {
  startTime: string;
  endTime: string;
  deltaY: number;
  hourHeight: number;
  gradeInicio: number;
  gradeFim: number;
}) {
  const minutosArrastados = Math.round(((deltaY / hourHeight) * 60) / 15) * 15;
  const duracao = Math.max(15, minutesFromTime(endTime) - minutesFromTime(startTime));
  return timeFromMinutes(clamp(
    minutesFromTime(startTime) + minutosArrastados,
    gradeInicio,
    gradeFim - duracao,
  ));
}

/** Faixa de atendimento oferecida nos botões de horário livre. */
export const HOUR_SLOTS = [9, 10, 11, 12, 13, 14, 15, 16, 17];

/**
 * Horários livres de um dia, para oferecer como botão.
 *
 * Um horário está livre quando nenhum compromisso não-cancelado do mesmo
 * profissional encosta na hora cheia. Compromisso sem `sellerId` conta como
 * conflito para todo mundo — é mais seguro oferecer um horário a menos do que
 * marcar duas pessoas no mesmo lugar. Acima de cinco opções a lista é amostrada
 * ao longo do dia, para o médico ver manhã e tarde em vez de só as primeiras.
 */
export function computeFreeTimeButtons(
  dateKey: string,
  appointments: Appointment[],
  sellerId: string | undefined,
): number[] {
  const conflicting = appointments.filter(a => {
    if (a.date !== dateKey) return false;
    if (a.status === "cancelado") return false;
    if (sellerId && a.sellerId && a.sellerId !== sellerId) return false;
    return true;
  });
  const free = HOUR_SLOTS.filter(h => {
    const slotStart = h * 60;
    const slotEnd = slotStart + 60;
    return !conflicting.some(c =>
      minutesFromTime(c.startTime) < slotEnd && minutesFromTime(c.endTime) > slotStart,
    );
  });
  if (free.length <= 5) return free;
  const out: number[] = [];
  for (let i = 0; i < 5; i++) {
    const idx = Math.round((i * (free.length - 1)) / 4);
    if (!out.includes(free[idx])) out.push(free[idx]);
  }
  return out;
}

/** Há conflito com algum compromisso do profissional nesta janela? */
export function conflitosNoHorario(
  appointments: Appointment[],
  { date, startTime, endTime, sellerId, ignorarId }: {
    date: string; startTime: string; endTime: string; sellerId?: string; ignorarId?: string;
  },
): Appointment[] {
  const inicio = minutesFromTime(startTime);
  const fim = minutesFromTime(endTime);
  return appointments.filter(a => {
    if (a.id === ignorarId) return false;
    if (a.date !== date) return false;
    if (a.status === "cancelado") return false;
    if (sellerId && a.sellerId && a.sellerId !== sellerId) return false;
    return minutesFromTime(a.startTime) < fim && minutesFromTime(a.endTime) > inicio;
  });
}
