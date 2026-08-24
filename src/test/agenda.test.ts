import { describe, expect, it } from "vitest";
import {
  computeFreeTimeButtons, conflitosNoHorario, minutesFromTime, novoHorarioAoArrastar, timeFromMinutes,
} from "@/lib/agenda";
import { phoneKey } from "@/lib/telefone";
import { Appointment } from "@/lib/mock-data";

// A grade do calendário: das 8h às 20h, uma hora = 64px.
const GRADE = { hourHeight: 64, gradeInicio: 8 * 60, gradeFim: 20 * 60 };

describe("aritmética de horário", () => {
  it("converte ida e volta", () => {
    expect(minutesFromTime("09:30")).toBe(570);
    expect(timeFromMinutes(570)).toBe("09:30");
    expect(timeFromMinutes(minutesFromTime("08:00"))).toBe("08:00");
  });
});

describe("arrastar agendamento na grade", () => {
  const card = { startTime: "09:00", endTime: "10:00" };

  it("uma hora para baixo é 64px", () => {
    expect(novoHorarioAoArrastar({ ...card, deltaY: 64, ...GRADE })).toBe("10:00");
  });

  it("uma hora para cima é -64px", () => {
    expect(novoHorarioAoArrastar({ ...card, deltaY: -64, ...GRADE })).toBe("08:00");
  });

  it("encaixa de 15 em 15 minutos", () => {
    // 20px ≈ 18min, que arredonda para o quarto de hora mais próximo.
    expect(novoHorarioAoArrastar({ ...card, deltaY: 20, ...GRADE })).toBe("09:15");
    expect(novoHorarioAoArrastar({ ...card, deltaY: 5, ...GRADE })).toBe("09:00");
  });

  it("não sobe acima do primeiro horário da grade", () => {
    expect(novoHorarioAoArrastar({ ...card, deltaY: -1000, ...GRADE })).toBe("08:00");
  });

  it("não desce a ponto de terminar fora da grade", () => {
    // Card de uma hora: o último início possível é 19:00, para acabar às 20:00.
    expect(novoHorarioAoArrastar({ ...card, deltaY: 1000, ...GRADE })).toBe("19:00");
  });

  it("preserva a duração ao decidir o limite de baixo", () => {
    const meiaHora = { startTime: "09:00", endTime: "09:30" };
    expect(novoHorarioAoArrastar({ ...meiaHora, deltaY: 1000, ...GRADE })).toBe("19:30");
  });
});

describe("casamento de telefone entre conversa e card", () => {
  it("ignora máscara, DDI e o nono dígito", () => {
    // Mesmo assinante nos dois formatos: com o nono dígito e sem ele.
    expect(phoneKey("+55 (31) 99876-5432")).toBe("98765432");
    expect(phoneKey("553198765432")).toBe("98765432");
  });

  it("casa o mesmo número escrito de formas diferentes", () => {
    expect(phoneKey("5531998765432")).toBe(phoneKey("(31) 99876-5432"));
    expect(phoneKey("5531998765432")).toBe(phoneKey("31998765432"));
  });

  it("não casa números diferentes", () => {
    expect(phoneKey("5531998765432")).not.toBe(phoneKey("5531912345678"));
  });

  it("devolve vazio para o que não é telefone", () => {
    expect(phoneKey("")).toBe("");
    expect(phoneKey("abc")).toBe("");
    expect(phoneKey("1234567")).toBe("");
  });
});

// --- horários livres e conflito (usados pela proposta de agendamento no chat e
// pelo diálogo de retorno da tela de Consultas) ---

const compromisso = (over: Partial<Appointment> = {}): Appointment => ({
  id: "ap1", title: "Consulta", dealId: "d1", date: "2026-09-03",
  startTime: "09:00", endTime: "10:00", sellerId: "u1", description: "",
  type: "retorno", status: "agendado", ...over,
});

describe("horários livres do dia", () => {
  it("tira da lista a hora ocupada pelo profissional", () => {
    const livres = computeFreeTimeButtons("2026-09-03", [compromisso()], "u1");
    expect(livres).not.toContain(9);
    expect(livres).toContain(10);
  });

  it("ignora compromisso de outro profissional", () => {
    const livres = computeFreeTimeButtons("2026-09-03", [compromisso({ sellerId: "u2" })], "u1");
    expect(livres).toContain(9);
  });

  it("ignora compromisso cancelado e dia diferente", () => {
    const lista = [compromisso({ status: "cancelado" }), compromisso({ id: "ap2", date: "2026-09-04" })];
    expect(computeFreeTimeButtons("2026-09-03", lista, "u1")).toContain(9);
  });

  it("amostra no máximo cinco horários, cobrindo manhã e tarde", () => {
    const livres = computeFreeTimeButtons("2026-09-03", [], "u1");
    expect(livres).toHaveLength(5);
    expect(livres[0]).toBe(9);
    expect(livres[livres.length - 1]).toBe(17);
  });
});

describe("detecção de conflito", () => {
  const janela = { date: "2026-09-03", startTime: "09:30", endTime: "10:30", sellerId: "u1" };

  it("acusa sobreposição parcial", () => {
    expect(conflitosNoHorario([compromisso()], janela)).toHaveLength(1);
  });

  it("encostar no fim não é conflito", () => {
    const colado = { ...janela, startTime: "10:00", endTime: "11:00" };
    expect(conflitosNoHorario([compromisso()], colado)).toHaveLength(0);
  });

  it("não acusa o próprio compromisso ao remarcá-lo", () => {
    expect(conflitosNoHorario([compromisso()], { ...janela, ignorarId: "ap1" })).toHaveLength(0);
  });
});
