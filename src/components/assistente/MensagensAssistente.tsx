import { useLayoutEffect, useRef } from "react";
import { BrainCircuit, Mic, TriangleAlert } from "lucide-react";
import type { AssistantMessage, AssistantPasso } from "@/lib/whatsapp-api";
import { CardProposta } from "./CardProposta";
import { PassosDaIA } from "./PassosDaIA";
import { cn } from "@/lib/utils";

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const SUGESTOES = [
  "Quais consultas tenho marcadas para hoje?",
  "Quais meus horários livres na semana que vem?",
  "Analise minhas consultas gravadas hoje e me diga o que ficou para eu fazer",
];

function Vazio({ onSugestao }: { onSugestao: (texto: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-2xl bg-primary-soft p-3">
        <BrainCircuit className="h-7 w-7 text-primary" />
      </div>
      <div>
        <p className="font-display text-lg font-semibold">Em que posso ajudar?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pergunte sobre sua agenda, suas consultas gravadas ou o caso de um paciente.
          Ações como enviar mensagem ou criar tarefa aparecem para você confirmar antes.
        </p>
      </div>
      <div className="flex w-full max-w-md flex-col gap-2">
        {SUGESTOES.map(texto => (
          <button
            key={texto}
            type="button"
            onClick={() => onSugestao(texto)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-left text-sm transition hover:border-primary hover:bg-primary-soft"
          >
            {texto}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MensagensAssistente({
  mensagens, pensando, passos, propostaOcupada, onSugestao, onConfirmar, onRecusar,
}: {
  mensagens: AssistantMessage[];
  pensando: boolean;
  passos: AssistantPasso[];
  propostaOcupada: string | null;
  onSugestao: (texto: string) => void;
  onConfirmar: (mensagemId: string, propostaId: string, edicao?: Record<string, unknown>) => void;
  onRecusar: (mensagemId: string, propostaId: string) => void;
}) {
  const fim = useRef<HTMLDivElement>(null);

  // Mesmo padrão de Equipe.tsx: âncora no fim + scrollIntoView. Os passos entram
  // na dependência porque cada um cresce a lista enquanto o turno roda.
  useLayoutEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [mensagens.length, passos.length, pensando]);

  if (!mensagens.length && !pensando) {
    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <Vazio onSugestao={onSugestao} />
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3 scrollbar-thin sm:p-6">
      {mensagens.map(mensagem => {
        const minha = mensagem.role === "user";
        return (
          <div key={mensagem.id} className={cn("flex", minha ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2 text-sm shadow-sm sm:max-w-[70%]",
                minha ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-card",
              )}
            >
              <div className="whitespace-pre-wrap break-words">{mensagem.body}</div>

              {/* Cada ação preparada vira um card dentro da própria resposta:
                  a decisão fica ao lado do texto que a explica. */}
              {(mensagem.propostas || []).map(proposta => (
                <CardProposta
                  key={proposta.id}
                  proposta={proposta}
                  ocupado={propostaOcupada === proposta.id}
                  onConfirmar={edicao => onConfirmar(mensagem.id, proposta.id, edicao)}
                  onRecusar={() => onRecusar(mensagem.id, proposta.id)}
                />
              ))}

              {mensagem.interrompido && (
                <div className="mt-2 flex items-start gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-[11px] text-warning">
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>Parei antes de verificar tudo — a resposta pode estar incompleta.</span>
                </div>
              )}

              <div
                className={cn(
                  "mt-1 flex items-center gap-1 text-[10px]",
                  minha ? "justify-end text-primary-foreground/70" : "text-muted-foreground",
                )}
              >
                {mensagem.entrada === "voz" && <Mic className="h-2.5 w-2.5" />}
                <span>{hora(mensagem.createdAt)}</span>
              </div>
            </div>
          </div>
        );
      })}

      <PassosDaIA passos={passos} ativo={pensando} />
      <div ref={fim} />
    </div>
  );
}
