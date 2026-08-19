/** Aritmética de horário da agenda — sem React, para poder ser testada direto. */

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
