// O registro de ações do assistente no front — irmão de
// backend/src/assistant/propostas.js e do registro de ferramentas.
//
// Mesma relação que src/lib/consultation-actions.ts tem com
// backend/src/lib/transcription/suggestions.js: o backend decide o que existe e
// valida; aqui mora só o que a tela precisa saber para desenhar o card. Tipo
// novo lá exige uma entrada aqui, e src/test/assistant-actions.test.ts cobra —
// senão o card aparece sem rótulo nem ícone.

import {
  CalendarPlus, CalendarClock, CalendarX, Send, Clock, ClipboardList, MessageSquare,
  type LucideIcon,
} from "lucide-react";
import type { AssistantPasso, AssistantProposal, TipoProposta } from "@/lib/whatsapp-api";

export type AcaoProposta = {
  rotulo: string;
  icone: LucideIcon;
  rotuloConfirmar: string;
  /**
   * O que o médico pode alterar no card antes de confirmar.
   *
   * Duplicado do `editaveis` de cada ferramenta de escrita no backend, que é
   * quem manda: o servidor descarta qualquer campo fora da lista dele. Aqui a
   * lista só decide o que a tela mostra como editável. Deixar um campo a mais
   * aqui não abre brecha — o servidor recusa —, mas confunde quem usa.
   */
  editaveis: string[];
};

export const ACOES_PROPOSTA: Record<TipoProposta, AcaoProposta> = {
  criar_agendamento: {
    rotulo: "Marcar consulta",
    icone: CalendarPlus,
    rotuloConfirmar: "Marcar",
    editaveis: ["data", "hora_inicio", "hora_fim", "titulo", "descricao", "tipo"],
  },
  remarcar_agendamento: {
    rotulo: "Remarcar consulta",
    icone: CalendarClock,
    rotuloConfirmar: "Remarcar e avisar",
    editaveis: ["nova_data", "nova_hora_inicio", "nova_hora_fim", "mensagem", "avisar_paciente", "instancia"],
  },
  cancelar_agendamento: {
    rotulo: "Cancelar consulta",
    icone: CalendarX,
    rotuloConfirmar: "Cancelar consulta",
    editaveis: ["motivo", "mensagem", "avisar_paciente", "instancia"],
  },
  enviar_whatsapp: {
    rotulo: "Mensagem no WhatsApp",
    icone: Send,
    rotuloConfirmar: "Enviar",
    editaveis: ["texto", "instancia"],
  },
  agendar_whatsapp: {
    rotulo: "Mensagem programada",
    icone: Clock,
    rotuloConfirmar: "Programar",
    editaveis: ["texto", "data", "hora", "instancia"],
  },
  criar_tarefa: {
    rotulo: "Tarefa para a secretaria",
    icone: ClipboardList,
    rotuloConfirmar: "Criar tarefa",
    editaveis: ["titulo", "descricao", "responsavel_id", "prazo", "itens", "mensagem_sugerida"],
  },
  mensagem_interna: {
    rotulo: "Mensagem no chat interno",
    icone: MessageSquare,
    rotuloConfirmar: "Enviar",
    editaveis: ["texto"],
  },
};

/**
 * O que o assistente está fazendo, em gerúndio.
 *
 * Aparece enquanto o turno roda. O backend manda um `resumo` já pronto para cada
 * passo concluído; isto cobre o instante anterior e a ferramenta que o front não
 * conheça (backend novo, front antigo) — nesse caso o nome cru é melhor que
 * nada, porque pelo menos indica movimento.
 */
const GERUNDIO: Record<string, string> = {
  buscar_paciente: "procurando o paciente",
  agenda_do_dia: "consultando a agenda",
  agenda_do_periodo: "consultando a agenda do período",
  horarios_livres: "procurando horários livres",
  consultas_do_paciente: "listando as consultas do paciente",
  ler_consulta: "lendo a consulta",
  consultas_gravadas_no_dia: "lendo as consultas do dia",
  mensagens_do_paciente: "lendo as mensagens do WhatsApp",
  anexos_do_paciente: "vendo o prontuário",
  tarefas: "consultando as tarefas",
  listar_equipe: "vendo quem está na equipe",
  dossie_do_paciente: "montando o dossiê do paciente",
  propor_agendamento: "preparando o agendamento",
  propor_remarcacao: "preparando a remarcação",
  propor_cancelamento: "preparando o cancelamento",
  propor_mensagem_whatsapp: "escrevendo a mensagem",
  propor_mensagem_agendada: "preparando a mensagem programada",
  propor_tarefa: "preparando a tarefa",
  propor_mensagem_interna: "escrevendo a mensagem interna",
};

export function gerundioDaFerramenta(tool: string): string {
  return GERUNDIO[tool] || tool.replace(/_/g, " ");
}

/** A linha que o médico lê para cada passo já concluído. */
export function rotuloDoPasso(passo: AssistantPasso): string {
  return passo.resumo?.trim() || gerundioDaFerramenta(passo.tool);
}

export function acaoDaProposta(tipo: TipoProposta): AcaoProposta | null {
  return ACOES_PROPOSTA[tipo] ?? null;
}

/** Requisitos que impedem o clique. Espelha requisitosPendentes do backend. */
export function bloqueios(proposta: AssistantProposal): string[] {
  return (proposta.requisitos || []).filter(r => !r.ok).map(r => r.aviso).filter(Boolean);
}

export function podeConfirmar(proposta: AssistantProposal): boolean {
  return proposta.status === "pendente" && bloqueios(proposta).length === 0;
}
