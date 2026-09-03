import { describe, expect, it } from "vitest";
import { ACOES_PROPOSTA, rotuloDoPasso, gerundioDaFerramenta, bloqueios, podeConfirmar } from "@/lib/assistant-actions";
import type { AssistantProposal, TipoProposta } from "@/lib/whatsapp-api";
// O registro do backend, importado de verdade em vez de copiado: é o que
// transforma "as duas listas combinam" numa afirmação verificável em vez de uma
// promessa no comentário. Mesmo espírito do teste de agenda-slots no backend,
// que repete os casos porque LÁ não dá para importar o TS.
import { ESCRITA } from "../../backend/src/assistant/tools/escrita.js";
import { TIPOS_PROPOSTA, TOOL_DE_PROPOSTA } from "../../backend/src/assistant/propostas.js";

const proposta = (over: Partial<AssistantProposal> = {}): AssistantProposal => ({
  id: "pr-1",
  tipo: "enviar_whatsapp",
  titulo: "Mensagem para Lucas",
  resumo: "pelo WhatsApp da clínica",
  payload: { texto: "oi" },
  requisitos: [],
  preview: { texto: "oi", linhas: [] },
  status: "pendente",
  resultado: null,
  erro: "",
  geradoEm: "2026-08-28T17:00:00.000Z",
  decididoEm: "",
  ...over,
});

describe("registro de ações do assistente", () => {
  it("todo tipo de proposta do backend tem rótulo e ícone aqui", () => {
    // Sem isto, um tipo novo no backend faria o card aparecer em branco na tela.
    for (const tipo of TIPOS_PROPOSTA as TipoProposta[]) {
      const acao = ACOES_PROPOSTA[tipo];
      expect(acao, `tipo "${tipo}" não tem entrada em ACOES_PROPOSTA`).toBeTruthy();
      expect(acao.rotulo.length).toBeGreaterThan(0);
      expect(acao.rotuloConfirmar.length).toBeGreaterThan(0);
      expect(acao.icone).toBeTruthy();
    }
  });

  it("não inventa tipo que o backend não conhece", () => {
    for (const tipo of Object.keys(ACOES_PROPOSTA)) {
      expect(TIPOS_PROPOSTA).toContain(tipo);
    }
  });

  it("os campos editáveis do front são um subconjunto dos do backend", () => {
    // O servidor descarta o que não está na lista dele. Um campo a mais aqui não
    // abre brecha — ele é ignorado —, mas mostra ao médico um campo que não vai
    // valer nada quando ele clicar.
    for (const tipo of TIPOS_PROPOSTA as TipoProposta[]) {
      const nomeDaTool = TOOL_DE_PROPOSTA[tipo] as keyof typeof ESCRITA;
      const doBackend: string[] = ESCRITA[nomeDaTool].editaveis;
      for (const campo of ACOES_PROPOSTA[tipo].editaveis) {
        expect(doBackend, `${tipo}: "${campo}" é editável no front e não no backend`).toContain(campo);
      }
    }
  });

  it("o destinatário nunca é editável", () => {
    // A defesa contra injeção de prompt: trocar quem recebe depois que o card foi
    // desenhado é exatamente o que um texto malicioso tentaria.
    const proibidos = ["paciente_id", "agendamento_id", "usuario_id"];
    for (const acao of Object.values(ACOES_PROPOSTA)) {
      for (const campo of proibidos) {
        expect(acao.editaveis).not.toContain(campo);
      }
    }
  });
});

describe("rótulo dos passos", () => {
  it("usa o resumo que o backend mandou", () => {
    expect(rotuloDoPasso({ tool: "agenda_do_dia", resumo: "agenda de 28/08: 3 compromisso(s)", ok: true, ms: 12 }))
      .toBe("agenda de 28/08: 3 compromisso(s)");
  });

  it("cai no gerúndio quando não há resumo", () => {
    expect(rotuloDoPasso({ tool: "ler_consulta", resumo: "", ok: true, ms: 0 })).toBe("lendo a consulta");
  });

  it("ferramenta desconhecida ainda produz algo legível", () => {
    // Backend novo com front antigo: o nome cru é melhor que nada, porque pelo
    // menos indica movimento.
    expect(gerundioDaFerramenta("ferramenta_nova_qualquer")).toBe("ferramenta nova qualquer");
  });
});

describe("estado do card", () => {
  it("proposta pendente e sem impedimento pode ser confirmada", () => {
    expect(podeConfirmar(proposta())).toBe(true);
    expect(bloqueios(proposta())).toEqual([]);
  });

  it("requisito não atendido bloqueia e expõe o aviso", () => {
    const p = proposta({
      requisitos: [
        { chave: "conversa_whatsapp", ok: true, aviso: "" },
        { chave: "instancia_conectada", ok: false, aviso: "O WhatsApp da clínica está desconectado." },
      ],
    });
    expect(podeConfirmar(p)).toBe(false);
    expect(bloqueios(p)).toEqual(["O WhatsApp da clínica está desconectado."]);
  });

  it("proposta já decidida não pode ser confirmada de novo", () => {
    expect(podeConfirmar(proposta({ status: "confirmada" }))).toBe(false);
    expect(podeConfirmar(proposta({ status: "recusada" }))).toBe(false);
  });
});
