import { useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ListaThreads } from "@/components/assistente/ListaThreads";
import { MensagensAssistente } from "@/components/assistente/MensagensAssistente";
import { ComposerAssistente } from "@/components/assistente/ComposerAssistente";
import { useAssistant } from "@/hooks/useAssistant";
import { useIsCompact } from "@/hooks/use-mobile";
import { whatsappApi } from "@/lib/whatsapp-api";
import { mensagemDeErro } from "@/lib/erros";

/**
 * O assistente do médico.
 *
 * Casca padrão das telas de painel único: card-elevated + app-pane, com a lista
 * de conversas à esquerda no desktop e dentro de um Sheet no compacto — mesma
 * solução de Conversas e Equipe.
 *
 * Quem confirma uma ação é esta página; o card só avisa que o botão foi clicado.
 * O servidor revalida tudo de novo antes de executar, então o que sai daqui é
 * intenção, não autorização.
 */
export default function Assistente() {
  const {
    threads, threadAtiva, mensagens, pensando, passos, erro,
    setThreadAtiva, criarThread, excluirThread, enviar, atualizarMensagem, setErro,
  } = useAssistant();

  const compact = useIsCompact();
  const [listaAberta, setListaAberta] = useState(false);
  const [propostaOcupada, setPropostaOcupada] = useState<string | null>(null);

  const selecionar = (id: string) => {
    setThreadAtiva(id);
    setListaAberta(false);
  };

  const nova = async () => {
    await criarThread();
    setListaAberta(false);
  };

  const decidir = async (
    acao: "confirmar" | "recusar",
    mensagemId: string,
    propostaId: string,
    edicao?: Record<string, unknown>,
  ) => {
    if (!threadAtiva || propostaOcupada) return;
    setPropostaOcupada(propostaId);
    try {
      const { mensagem } = acao === "confirmar"
        ? await whatsappApi.confirmAssistantProposal(threadAtiva, mensagemId, propostaId, edicao)
        : await whatsappApi.refuseAssistantProposal(threadAtiva, mensagemId, propostaId);
      atualizarMensagem(mensagem);
      if (acao === "confirmar") {
        const proposta = mensagem.propostas?.find(p => p.id === propostaId);
        if (proposta?.status === "falhou") toast.error(proposta.erro || "A ação não pôde ser concluída.");
        else toast.success(proposta?.resultado?.detalhe || "Feito.");
      }
    } catch (err) {
      toast.error(mensagemDeErro(err));
    } finally {
      setPropostaOcupada(null);
    }
  };

  // Erro vira aviso dispensável, e não tela em branco: a conversa anterior
  // continua legível. No efeito, e não no corpo do componente, porque avisar e
  // limpar o estado durante a render é mudança de estado no meio da render.
  useEffect(() => {
    if (!erro) return;
    toast.error(erro);
    setErro(null);
  }, [erro, setErro]);

  const lista = (
    <ListaThreads
      threads={threads}
      ativa={threadAtiva}
      onSelecionar={selecionar}
      onNova={nova}
      onExcluir={excluirThread}
      className={compact ? "h-full w-full" : "hidden w-64 border-r lg:flex"}
    />
  );

  return (
    <AppLayout title="Assistente" subtitle="Pergunte por voz ou por escrito — as ações você confirma antes">
      <div className="card-elevated app-pane flex flex-col overflow-hidden lg:flex-row">
        {!compact && lista}

        <div className="flex min-w-0 flex-1 flex-col">
          {compact && (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Sheet open={listaAberta} onOpenChange={setListaAberta}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2">
                    <MessagesSquare className="h-4 w-4" />
                    Conversas
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[280px] p-0">
                  {lista}
                </SheetContent>
              </Sheet>
              <span className="truncate text-sm font-medium">
                {threads.find(t => t.id === threadAtiva)?.titulo || "Nova conversa"}
              </span>
            </div>
          )}

          <MensagensAssistente
            mensagens={mensagens}
            pensando={pensando}
            passos={passos}
            propostaOcupada={propostaOcupada}
            onSugestao={texto => enviar(texto, "texto")}
            onConfirmar={(mensagemId, propostaId, edicao) => decidir("confirmar", mensagemId, propostaId, edicao)}
            onRecusar={(mensagemId, propostaId) => decidir("recusar", mensagemId, propostaId)}
          />

          <ComposerAssistente onEnviar={enviar} ocupado={pensando} />
        </div>
      </div>
    </AppLayout>
  );
}
