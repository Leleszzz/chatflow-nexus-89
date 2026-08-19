import { describe, expect, it } from "vitest";
import { minutesFromTime, novoHorarioAoArrastar, timeFromMinutes } from "@/lib/agenda";
import { phoneKey } from "@/lib/telefone";

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
