import { describe, expect, it } from "vitest";
import {
  ACOES,
  calcularLembretes,
  formatarDataBR,
  instanteLocal,
  textoConfirmacao,
  textoExames,
  textoLembrete,
  textoOrientacoes,
} from "@/lib/consultation-actions";

// 10h da manhã do dia 20/08/2026 — hora fixa para a saudação não variar.
const MANHA = new Date(2026, 7, 20, 10, 0, 0);

describe("formatação de data", () => {
  it("converte ISO para o formato brasileiro", () => {
    expect(formatarDataBR("2026-09-03")).toBe("03/09");
    expect(formatarDataBR("2026-09-03", true)).toBe("03/09/2026");
  });

  it("devolve a entrada crua quando não é uma data ISO", () => {
    expect(formatarDataBR("")).toBe("");
    expect(formatarDataBR("amanhã")).toBe("amanhã");
  });

  it("monta o instante no fuso local, sem passar por UTC", () => {
    const d = instanteLocal("2026-09-03", "14:00");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(8);
    expect(d?.getDate()).toBe(3);
    expect(d?.getHours()).toBe(14);
  });

  it("recusa data ou hora inválida", () => {
    expect(instanteLocal("03/09/2026", "14:00")).toBeNull();
    expect(instanteLocal("2026-09-03", "25:00")).toBeNull();
    expect(instanteLocal("2026-09-03", "")).toBeNull();
  });
});

describe("textos enviados ao paciente", () => {
  it("confirma retorno com data e hora", () => {
    expect(textoConfirmacao({ nome: "Maria Silva Souza", data: "2026-09-03", hora: "14:00", agora: MANHA }))
      .toBe("Bom dia, Maria! Confirmando seu retorno para 03/09 às 14:00. Qualquer imprevisto, é só avisar por aqui.");
  });

  it("confirma sem data sem inventar uma", () => {
    const texto = textoConfirmacao({ nome: "Maria", data: "", hora: "", agora: MANHA });
    expect(texto).toContain("conforme combinamos");
    expect(texto).not.toContain("undefined");
  });

  it("lista os exames em tópicos", () => {
    const texto = textoExames({ nome: "João Pedro", itens: ["Hemograma completo", "TSH"], agora: MANHA });
    expect(texto).toContain("Bom dia, João!");
    expect(texto).toContain("• Hemograma completo\n• TSH");
  });

  it("monta as orientações sem espaço sobrando", () => {
    const texto = textoOrientacoes({ nome: "Ana", texto: "  Beber 2L de água por dia.  ", agora: MANHA });
    expect(texto).toContain("Beber 2L de água por dia.\n\nQualquer dúvida");
  });

  it("aguenta cliente sem nome sem deixar vírgula solta", () => {
    const texto = textoConfirmacao({ nome: "", data: "2026-09-03", hora: "14:00", agora: MANHA });
    expect(texto.startsWith("Bom dia! Confirmando")).toBe(true);
  });
});

describe("lembretes", () => {
  it("não usa saudação por período — a mensagem é entregue depois", () => {
    const vespera = textoLembrete({ nome: "Maria", data: "2026-09-03", hora: "14:00", quando: "vespera" });
    expect(vespera).toBe("Olá, Maria! Passando para lembrar da sua consulta amanhã, dia 03/09, às 14:00. Até lá!");

    const duasHoras = textoLembrete({ nome: "Maria", data: "2026-09-03", hora: "14:00", quando: "duas-horas" });
    expect(duasHoras).toBe("Olá, Maria! Passando para lembrar: sua consulta é hoje às 14:00. Até daqui a pouco!");
  });

  it("agenda a véspera às 18h e o outro duas horas antes", () => {
    const agora = new Date(2026, 7, 20, 10, 0, 0);
    const [vespera, duasHoras] = calcularLembretes(
      { data: "2026-09-03", hora: "14:00" }, ["vespera", "duas-horas"], agora,
    );

    const dVespera = new Date(vespera.scheduledAt);
    expect(dVespera.getDate()).toBe(2);
    expect(dVespera.getHours()).toBe(18);

    const dDuas = new Date(duasHoras.scheduledAt);
    expect(dDuas.getDate()).toBe(3);
    expect(dDuas.getHours()).toBe(12);
  });

  it("descarta lembrete que já passou em vez de disparar atrasado", () => {
    // Consulta hoje às 14h, já são 13h: a véspera passou e faltam menos de 2h.
    const agora = new Date(2026, 7, 20, 13, 0, 0);
    const out = calcularLembretes({ data: "2026-08-20", hora: "14:00" }, ["vespera", "duas-horas"], agora);
    expect(out).toEqual([]);
  });

  it("sem data não há lembrete", () => {
    expect(calcularLembretes({ data: "", hora: "14:00" }, ["vespera"], MANHA)).toEqual([]);
  });
});

describe("registro de ações", () => {
  it("descreve o retorno sem data sem mentir", () => {
    expect(ACOES.agendar_retorno.resumo({ data: "", hora: "", motivo: "" })).toBe("sem data definida");
    expect(ACOES.agendar_retorno.resumo({ data: "2026-09-03", hora: "14:00", motivo: "reavaliar pressão" }))
      .toBe("03/09 às 14:00 — reavaliar pressão");
  });

  it("conta os exames no resumo do card", () => {
    expect(ACOES.exames.resumo({ itens: ["TSH"] })).toBe("1 exame: TSH");
    expect(ACOES.exames.resumo({ itens: ["TSH", "Hemograma"] })).toBe("2 exames: TSH, Hemograma");
  });

  it("só o agendamento funciona sem conversa no WhatsApp", () => {
    expect(ACOES.agendar_retorno.exigeWhatsApp).toBe(false);
    expect(ACOES.exames.exigeWhatsApp).toBe(true);
    expect(ACOES.confirmacao.exigeWhatsApp).toBe(true);
    expect(ACOES.orientacoes.exigeWhatsApp).toBe(true);
  });
});
