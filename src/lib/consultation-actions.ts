import { CalendarClock, ClipboardList, HeartPulse, MessageCircle, LucideIcon } from "lucide-react";
import { saudacaoAgora } from "@/lib/message-template";
import { ConsultationSuggestion, ConsultationSuggestionType } from "@/lib/whatsapp-api";

/**
 * O lado do navegador do registro de ações sugeridas.
 *
 * A irmã deste arquivo é backend/src/lib/transcription/suggestions.js, que
 * ensina a IA a propor e valida o que ela devolveu. Aqui fica só a aparência do
 * botão e o texto que vai para o WhatsApp. Ação nova = uma entrada nos dois.
 */

export type AgendarRetornoPayload = { data: string; hora: string; motivo: string };
export type ExamesPayload = { itens: string[] };
export type TextoPayload = { texto: string };

export type AcaoDef = {
  rotulo: string;
  icone: LucideIcon;
  /** Linha de apoio no card, já com o conteúdo da sugestão. */
  resumo: (payload: Record<string, unknown>) => string;
  /** Precisa de conversa no WhatsApp para funcionar? */
  exigeWhatsApp: boolean;
};

export const ACOES: Record<ConsultationSuggestionType, AcaoDef> = {
  agendar_retorno: {
    rotulo: "Agendar retorno",
    icone: CalendarClock,
    exigeWhatsApp: false,
    resumo: p => {
      const { data, hora, motivo } = p as AgendarRetornoPayload;
      const quando = data ? `${formatarDataBR(data)}${hora ? ` às ${hora}` : ""}` : "sem data definida";
      return motivo ? `${quando} — ${motivo}` : quando;
    },
  },
  exames: {
    rotulo: "Solicitar exames",
    icone: ClipboardList,
    exigeWhatsApp: true,
    resumo: p => {
      const itens = (p as ExamesPayload).itens || [];
      return `${itens.length} exame${itens.length === 1 ? "" : "s"}: ${itens.join(", ")}`;
    },
  },
  confirmacao: {
    rotulo: "Confirmar pelo WhatsApp",
    icone: MessageCircle,
    exigeWhatsApp: true,
    resumo: p => (p as TextoPayload).texto || "",
  },
  orientacoes: {
    rotulo: "Enviar orientações",
    icone: HeartPulse,
    exigeWhatsApp: true,
    resumo: p => (p as TextoPayload).texto || "",
  },
};

/** "2026-09-03" -> "03/09". Devolve a entrada crua se não for uma data ISO. */
export function formatarDataBR(data: string, comAno = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data || "");
  if (!m) return data || "";
  return comAno ? `${m[3]}/${m[2]}/${m[1]}` : `${m[3]}/${m[2]}`;
}

/** Data local a partir de "AAAA-MM-DD" + "HH:MM", sem passar por UTC. */
export function instanteLocal(data: string, hora: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data || "");
  const h = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora || "");
  if (!d || !h) return null;
  return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(h[1]), Number(h[2]), 0, 0);
}

const primeiroNome = (nome: string) => String(nome || "").trim().split(/\s+/)[0] || "";

const abertura = (nome: string, agora?: Date) => {
  const pn = primeiroNome(nome);
  return pn ? `${saudacaoAgora(agora)}, ${pn}!` : `${saudacaoAgora(agora)}!`;
};

export function textoConfirmacao({ nome, data, hora, agora }: {
  nome: string; data: string; hora: string; agora?: Date;
}): string {
  const quando = data
    ? `para ${formatarDataBR(data)}${hora ? ` às ${hora}` : ""}`
    : "conforme combinamos";
  return `${abertura(nome, agora)} Confirmando seu retorno ${quando}. Qualquer imprevisto, é só avisar por aqui.`;
}

export function textoExames({ nome, itens, agora }: {
  nome: string; itens: string[]; agora?: Date;
}): string {
  const lista = itens.map(i => `• ${i}`).join("\n");
  return `${abertura(nome, agora)} Seguem os exames solicitados na sua consulta:\n\n${lista}\n\nQualquer dúvida, é só me chamar por aqui.`;
}

export function textoOrientacoes({ nome, texto, agora }: {
  nome: string; texto: string; agora?: Date;
}): string {
  return `${abertura(nome, agora)} Seguem as orientações da sua consulta:\n\n${texto.trim()}\n\nQualquer dúvida, é só me chamar por aqui.`;
}

/**
 * Mensagem que a própria IA redigiu, só com a abertura padrão na frente.
 *
 * A confirmação sugerida já vem contextualizada com o que foi combinado na
 * consulta — reescrevê-la aqui jogaria fora justamente o que ela tem de útil.
 */
export function textoConfirmacaoLivre({ nome, texto, agora }: {
  nome: string; texto: string; agora?: Date;
}): string {
  return `${abertura(nome, agora)} ${texto.trim()}`;
}

export type QuandoLembrete = "vespera" | "duas-horas";

/**
 * Texto do lembrete automático.
 *
 * Sem `saudacaoAgora` de propósito: a mensagem é montada hoje e entregue em
 * outro dia ou período, então "Boa tarde" gravado agora chegaria errado.
 */
export function textoLembrete({ nome, data, hora, quando }: {
  nome: string; data: string; hora: string; quando: QuandoLembrete;
}): string {
  const pn = primeiroNome(nome);
  const ola = pn ? `Olá, ${pn}!` : "Olá!";
  if (quando === "duas-horas") {
    return `${ola} Passando para lembrar: sua consulta é hoje às ${hora}. Até daqui a pouco!`;
  }
  return `${ola} Passando para lembrar da sua consulta amanhã, dia ${formatarDataBR(data)}, às ${hora}. Até lá!`;
}

export const LEMBRETES: { quando: QuandoLembrete; rotulo: string }[] = [
  { quando: "vespera", rotulo: "Lembrete na véspera (18:00)" },
  { quando: "duas-horas", rotulo: "Lembrete 2h antes" },
];

/**
 * Quando cada lembrete deve sair, em ISO.
 *
 * Lembrete que cairia no passado é descartado aqui — o worker de mensagens
 * agendadas dispararia na hora seguinte, e o paciente receberia "sua consulta é
 * amanhã" depois da consulta.
 */
export function calcularLembretes(
  { data, hora }: { data: string; hora: string },
  quaisQuer: QuandoLembrete[],
  agora: Date = new Date(),
): { quando: QuandoLembrete; scheduledAt: string }[] {
  const inicio = instanteLocal(data, hora);
  if (!inicio) return [];

  return quaisQuer
    .map(quando => {
      const alvo = new Date(inicio);
      if (quando === "duas-horas") {
        alvo.setHours(alvo.getHours() - 2);
      } else {
        alvo.setDate(alvo.getDate() - 1);
        alvo.setHours(18, 0, 0, 0);
      }
      return { quando, scheduledAt: alvo };
    })
    .filter(l => l.scheduledAt.getTime() > agora.getTime())
    .map(l => ({ quando: l.quando, scheduledAt: l.scheduledAt.toISOString() }));
}

/** Só as sugestões que ainda pedem uma decisão do médico. */
export const pendentes = (suggestions: ConsultationSuggestion[] = []) =>
  suggestions.filter(s => s.status === "pendente");

export const concluidas = (suggestions: ConsultationSuggestion[] = []) =>
  suggestions.filter(s => s.status === "feito");
