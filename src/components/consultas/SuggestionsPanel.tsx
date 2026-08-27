import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Sparkles, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Deal } from "@/lib/mock-data";
import {
  Consultation, ConsultationSuggestion, ConsultationSuggestionType, WAConversation, whatsappApi,
} from "@/lib/whatsapp-api";
import {
  ACOES, AgendarRetornoPayload, ExamesPayload, TextoPayload,
  concluidas, pendentes, textoConfirmacaoLivre, textoOrientacoes,
} from "@/lib/consultation-actions";
import { ScheduleFollowUpDialog } from "./ScheduleFollowUpDialog";
import { ExamChecklistDialog } from "./ExamChecklistDialog";
import { SendWhatsAppDialog } from "./SendWhatsAppDialog";
import { CriarTarefaDialog, RascunhoTarefa } from "@/components/tarefas/CriarTarefaDialog";
import { cn } from "@/lib/utils";
import { mensagemDeErro } from "@/lib/erros";

interface Props {
  consultation: Consultation;
  deal: Deal | null | undefined;
  /** Conversa de WhatsApp do cliente, ou null quando ele ainda não tem uma. */
  conversa: WAConversation | null;
}

/**
 * As ações que a IA propôs a partir da consulta, em um clique cada.
 *
 * O painel é burro de propósito: quem decide o que cada tipo mostra é o registro
 * em src/lib/consultation-actions.ts. Tipo novo aparece aqui sozinho — só
 * precisa de um diálogo em `abrirDialogo` se não for um envio de texto simples.
 */
export function SuggestionsPanel({ consultation, deal, conversa }: Props) {
  const navigate = useNavigate();
  const [aberta, setAberta] = useState<ConsultationSuggestion | null>(null);
  const [rascunho, setRascunho] = useState<RascunhoTarefa | null>(null);

  const pendencias = pendentes(consultation.suggestions);
  const feitas = concluidas(consultation.suggestions);
  if (!pendencias.length && !feitas.length) return null;

  const nome = deal?.customer || "";

  const patch = async (sugestao: ConsultationSuggestion, status: "feito" | "dispensado") => {
    try {
      await whatsappApi.updateConsultationSuggestion(consultation.id, sugestao.id, { status });
    } catch (err) {
      toast.error(`Falha ao atualizar a sugestão: ${mensagemDeErro(err)}`);
      throw err;
    }
  };

  const enviar = async (sugestao: ConsultationSuggestion, texto: string) => {
    if (!conversa) return;
    try {
      await whatsappApi.sendText(conversa.instanceId, conversa.chatId, texto);
    } catch (err) {
      // Sem marcar como feita: a sugestão continua no painel para ser reenviada
      // depois que a instância voltar.
      toast.error(`Falha ao enviar: ${mensagemDeErro(err)}`);
      return;
    }
    await patch(sugestao, "feito").catch(() => {});
    setAberta(null);
    toast.success("Mensagem enviada ao cliente");
  };

  const bloqueada = (tipo: ConsultationSuggestionType) => ACOES[tipo].exigeWhatsApp && !conversa;

  return (
    <>
      <div className="rounded-xl border border-border p-3">
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Próximos passos</span>
          <span className="text-xs text-muted-foreground">sugeridos pela consulta</span>
        </div>

        {!conversa && pendencias.some(s => ACOES[s.tipo].exigeWhatsApp) && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft px-2 py-1.5 text-[11px] text-warning">
            <span className="flex-1">Este cliente ainda não tem conversa no WhatsApp.</span>
            <button type="button" className="underline" onClick={() => navigate("/conversas")}>
              Abrir Conversas
            </button>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {pendencias.map(sugestao => {
            const def = ACOES[sugestao.tipo];
            const Icone = def.icone;
            const travada = bloqueada(sugestao.tipo);
            return (
              <div
                key={sugestao.id}
                className={cn(
                  "flex items-start gap-2 rounded-lg border border-border p-2",
                  travada && "opacity-60",
                )}
              >
                <div className="min-w-0 flex-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mb-1 h-8 w-full justify-start gap-2"
                    disabled={travada}
                    title={travada ? "Precisa de uma conversa de WhatsApp com este cliente" : undefined}
                    onClick={() => setAberta(sugestao)}
                  >
                    <Icone className="h-4 w-4 shrink-0" />
                    <span className="truncate">{def.rotulo}</span>
                  </Button>
                  <p className="line-clamp-2 text-[11px] text-muted-foreground">
                    {def.resumo(sugestao.payload)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground"
                    title="Criar tarefa para a secretaria"
                    onClick={() => setRascunho({
                      ...def.tarefa(sugestao.payload, { nome }),
                      dealId: consultation.dealId,
                      consultationId: consultation.id,
                      origem: "consulta",
                    })}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground"
                    title="Dispensar"
                    onClick={() => patch(sugestao, "dispensado").catch(() => {})}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {feitas.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-border pt-2">
            {feitas.map(sugestao => (
              <div key={sugestao.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Check className="h-3 w-3 shrink-0 text-emerald-600" />
                <span className="truncate">
                  {ACOES[sugestao.tipo].rotulo} — {ACOES[sugestao.tipo].resumo(sugestao.payload)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {rascunho && (
        <CriarTarefaDialog
          open
          onOpenChange={a => { if (!a) setRascunho(null); }}
          rascunho={rascunho}
          nomePaciente={nome}
        />
      )}

      {aberta?.tipo === "agendar_retorno" && (
        <ScheduleFollowUpDialog
          open
          onOpenChange={a => { if (!a) setAberta(null); }}
          payload={aberta.payload as AgendarRetornoPayload}
          deal={deal}
          conversa={conversa}
          onConcluir={() => patch(aberta, "feito")}
        />
      )}

      {aberta?.tipo === "exames" && (
        <ExamChecklistDialog
          open
          onOpenChange={a => { if (!a) setAberta(null); }}
          itens={(aberta.payload as ExamesPayload).itens || []}
          nomePaciente={nome}
          onEnviar={texto => enviar(aberta, texto)}
        />
      )}

      {(aberta?.tipo === "confirmacao" || aberta?.tipo === "orientacoes") && (
        <SendWhatsAppDialog
          open
          onOpenChange={a => { if (!a) setAberta(null); }}
          titulo={ACOES[aberta.tipo].rotulo}
          destinatario={nome}
          textoInicial={
            aberta.tipo === "confirmacao"
              ? textoConfirmacaoLivre({ nome, texto: (aberta.payload as TextoPayload).texto || "" })
              : textoOrientacoes({ nome, texto: (aberta.payload as TextoPayload).texto || "" })
          }
          onEnviar={texto => enviar(aberta, texto)}
        />
      )}
    </>
  );
}
