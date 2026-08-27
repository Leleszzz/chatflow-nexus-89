import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, Check, ClipboardList, Loader2, MessageCircle, Plus, RotateCcw, Search, Send, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SendWhatsAppDialog } from "@/components/consultas/SendWhatsAppDialog";
import { QuickReplyPicker } from "@/components/chat/QuickReplyPicker";
import { CriarTarefaDialog } from "@/components/tarefas/CriarTarefaDialog";
import { useCRM } from "@/store/crm-store";
import { Task, WhatsAppInstance, whatsappApi } from "@/lib/whatsapp-api";
import { instanciaDaSecretaria } from "@/lib/instance-kinds";
import { isAtendente } from "@/lib/roles";
import { mensagemDeErro } from "@/lib/erros";
import { formatarDataBR } from "@/lib/consultation-actions";
import { cn } from "@/lib/utils";

type Aba = "abertas" | "minhas" | "concluidas";

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Radix recusa SelectItem com value vazio, então "sem responsável" precisa de
// um sentinela — o mesmo motivo do "__sem__" na tela de Instâncias.
const TODOS = "__todos__";
const SEM_RESPONSAVEL = "__fila__";

export default function Secretaria() {
  const navigate = useNavigate();
  const { tasks, refreshTasks, updateTask, removeTask, deals, teamUsers, currentUser } = useCRM();

  const [aba, setAba] = useState<Aba>("abertas");
  const [responsavelFiltro, setResponsavelFiltro] = useState<string>(TODOS);
  const [busca, setBusca] = useState("");
  const [instancias, setInstancias] = useState<WhatsAppInstance[]>([]);
  const [criarAberto, setCriarAberto] = useState(false);
  const [enviando, setEnviando] = useState<Task | null>(null);
  const [textoEnvio, setTextoEnvio] = useState("");
  const [ocupadaId, setOcupadaId] = useState<string | null>(null);

  useEffect(() => { refreshTasks(); }, [refreshTasks]);

  useEffect(() => {
    whatsappApi.listInstances().then(setInstancias).catch(() => setInstancias([]));
  }, []);

  // Cobrança e confirmação saem sempre pelo número da clínica, nunca pelo
  // WhatsApp pessoal do doutor — é para isso que a instância tem tipo.
  const instanciaClinica = useMemo(() => instanciaDaSecretaria(instancias), [instancias]);

  const dealPorId = useMemo(() => new Map(deals.map(d => [d.id, d])), [deals]);
  const usuarioPorId = useMemo(() => new Map(teamUsers.map(u => [u.id, u])), [teamUsers]);
  const responsaveis = useMemo(() => teamUsers.filter(u => u.active && isAtendente(u.role)), [teamUsers]);

  const visiveis = useMemo(() => {
    const hoje = hojeISO();
    let lista = tasks;

    if (aba === "concluidas") lista = lista.filter(t => t.status !== "aberta");
    else if (aba === "minhas") lista = lista.filter(t => t.status === "aberta" && t.assigneeId === currentUser?.id);
    else lista = lista.filter(t => t.status === "aberta");

    if (responsavelFiltro !== TODOS) {
      lista = lista.filter(t => (responsavelFiltro === SEM_RESPONSAVEL ? !t.assigneeId : t.assigneeId === responsavelFiltro));
    }

    const q = busca.trim().toLowerCase();
    if (q) {
      lista = lista.filter(t => {
        const deal = dealPorId.get(t.dealId);
        return [t.titulo, t.descricao, deal?.customer, deal?.phone, ...t.itens.map(i => i.texto)]
          .join(" ").toLowerCase().includes(q);
      });
    }

    // Vencidas primeiro dentro das abertas: é o que a recepção precisa ver ao abrir a tela.
    return [...lista].sort((a, b) => {
      const aVencida = a.status === "aberta" && a.prazo && a.prazo < hoje;
      const bVencida = b.status === "aberta" && b.prazo && b.prazo < hoje;
      if (aVencida !== bVencida) return aVencida ? -1 : 1;
      return 0;
    });
  }, [tasks, aba, responsavelFiltro, busca, dealPorId, currentUser?.id]);

  const contagem = useMemo(() => ({
    abertas: tasks.filter(t => t.status === "aberta").length,
    minhas: tasks.filter(t => t.status === "aberta" && t.assigneeId === currentUser?.id).length,
    concluidas: tasks.filter(t => t.status !== "aberta").length,
  }), [tasks, currentUser?.id]);

  const alternarItem = async (task: Task, indice: number) => {
    const itens = task.itens.map((item, i) => (i === indice ? { ...item, feito: !item.feito } : item));
    try {
      await updateTask(task.id, { itens });
    } catch (err) {
      toast.error(`Falha ao marcar o item: ${mensagemDeErro(err)}`);
    }
  };

  const mudarStatus = async (task: Task, status: Task["status"]) => {
    setOcupadaId(task.id);
    try {
      await updateTask(task.id, { status });
      toast.success(status === "aberta" ? "Tarefa reaberta" : "Tarefa concluída");
    } catch (err) {
      toast.error(`Falha: ${mensagemDeErro(err)}`);
    } finally {
      setOcupadaId(null);
    }
  };

  const excluir = async (task: Task) => {
    if (!window.confirm(`Excluir "${task.titulo}"?`)) return;
    try {
      await removeTask(task.id);
      toast.success("Tarefa excluída");
    } catch (err) {
      toast.error(`Falha ao excluir: ${mensagemDeErro(err)}`);
    }
  };

  const abrirEnvio = (task: Task) => {
    const deal = dealPorId.get(task.dealId);
    if (!deal) {
      toast.error("Esta tarefa não está vinculada a um paciente.");
      return;
    }
    if (!instanciaClinica) {
      toast.error("Nenhum WhatsApp da secretaria configurado. Marque o tipo da instância em Instâncias.");
      return;
    }
    setTextoEnvio(task.mensagemSugerida || "");
    setEnviando(task);
  };

  const enviar = async (texto: string) => {
    if (!enviando || !instanciaClinica) return;
    const deal = dealPorId.get(enviando.dealId);
    if (!deal) return;

    try {
      // Procura a conversa DESTE número; se o paciente nunca falou com a
      // clínica, `startConversation` abre o fio (é idempotente).
      let conversa = await whatsappApi
        .getConversationByDeal(deal.id, instanciaClinica.id)
        .catch(() => null);
      if (!conversa) {
        if (!deal.phone) {
          toast.error("Este paciente não tem telefone cadastrado.");
          return;
        }
        conversa = await whatsappApi.startConversation({
          instanceId: instanciaClinica.id,
          phone: deal.phone,
          customer: deal.customer,
        });
      }
      await whatsappApi.sendText(conversa.instanceId, conversa.chatId, texto);
    } catch (err) {
      // Sem concluir: a tarefa fica na fila para ser reenviada quando a
      // instância voltar.
      toast.error(`Falha ao enviar: ${mensagemDeErro(err)}`);
      return;
    }

    setEnviando(null);
    toast.success(`Mensagem enviada pelo ${instanciaClinica.name}`);
  };

  const hoje = hojeISO();

  return (
    <AppLayout title="Secretaria" subtitle="As tarefas da recepção, em uma fila só">
      <div className="space-y-4">
        {!instanciaClinica && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="flex-1">
              Nenhuma instância está marcada como WhatsApp da secretaria — sem ela não dá para enviar
              mensagem a partir da fila.
            </span>
            <Button size="sm" variant="outline" onClick={() => navigate("/instancias")}>
              Abrir instâncias
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {([
            ["abertas", `Em aberto (${contagem.abertas})`],
            ["minhas", `Minhas (${contagem.minhas})`],
            ["concluidas", `Concluídas (${contagem.concluidas})`],
          ] as [Aba, string][]).map(([valor, rotulo]) => (
            <Button
              key={valor}
              size="sm"
              variant={aba === valor ? "default" : "outline"}
              onClick={() => setAba(valor)}
            >
              {rotulo}
            </Button>
          ))}

          <div className="relative min-w-0 flex-1 basis-full sm:basis-48">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por paciente ou tarefa…"
              className="pl-9"
            />
          </div>

          <Select value={responsavelFiltro} onValueChange={setResponsavelFiltro}>
            <SelectTrigger className="w-full sm:w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os responsáveis</SelectItem>
              <SelectItem value={SEM_RESPONSAVEL}>Sem responsável</SelectItem>
              {responsaveis.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Button className="gap-2" onClick={() => setCriarAberto(true)}>
            <Plus className="h-4 w-4" /> Nova tarefa
          </Button>
        </div>

        {visiveis.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            <ClipboardList className="mx-auto mb-2 h-10 w-10" />
            {aba === "concluidas" ? "Nada concluído ainda." : "Nenhuma tarefa nesta fila. "}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visiveis.map(task => {
              const deal = dealPorId.get(task.dealId);
              const responsavel = usuarioPorId.get(task.assigneeId);
              const vencida = task.status === "aberta" && task.prazo && task.prazo < hoje;
              const feitos = task.itens.filter(i => i.feito).length;

              return (
                <div
                  key={task.id}
                  className={cn(
                    "flex flex-col rounded-2xl border bg-card p-3",
                    vencida ? "border-destructive/50" : "border-border",
                    task.status !== "aberta" && "opacity-70",
                  )}
                >
                  <div className="mb-2 flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{task.titulo}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        {deal && <span className="truncate">{deal.customer}</span>}
                        {task.prazo && (
                          <>
                            {deal && <span>•</span>}
                            <span className={cn(vencida && "font-medium text-destructive")}>
                              {vencida ? "venceu" : "até"} {formatarDataBR(task.prazo)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {responsavel?.name || "Fila geral"}
                    </Badge>
                  </div>

                  {task.descricao && (
                    <p className="mb-2 line-clamp-3 text-xs text-muted-foreground">{task.descricao}</p>
                  )}

                  {task.itens.length > 0 && (
                    <div className="mb-2 space-y-1 rounded-lg bg-secondary/40 p-2">
                      <div className="text-[10px] font-medium uppercase text-muted-foreground">
                        Checklist {feitos}/{task.itens.length}
                      </div>
                      {task.itens.map((item, i) => (
                        <label key={`${task.id}-${i}`} className="flex cursor-pointer items-center gap-2 text-xs">
                          <Checkbox
                            checked={item.feito}
                            disabled={task.status !== "aberta"}
                            onCheckedChange={() => alternarItem(task, i)}
                          />
                          <span className={cn("min-w-0 flex-1 truncate", item.feito && "text-muted-foreground line-through")}>
                            {item.texto}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}

                  <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
                    {task.status === "aberta" ? (
                      <>
                        {deal && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-8 gap-1.5 text-xs"
                            onClick={() => abrirEnvio(task)}
                            disabled={!instanciaClinica}
                            title={instanciaClinica
                              ? `Enviar pelo ${instanciaClinica.name}`
                              : "Configure o WhatsApp da secretaria"}
                          >
                            <Send className="h-3.5 w-3.5" /> Enviar
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => mudarStatus(task, "concluida")}
                          disabled={ocupadaId === task.id}
                        >
                          {ocupadaId === task.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Check className="h-3.5 w-3.5" />}
                          Concluir
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => mudarStatus(task, "aberta")}
                        disabled={ocupadaId === task.id}
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                      </Button>
                    )}
                    {deal && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        title="Abrir conversa"
                        onClick={() => navigate(`/conversas?deal=${encodeURIComponent(deal.id)}`)}
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      title="Excluir"
                      onClick={() => excluir(task)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CriarTarefaDialog
        open={criarAberto}
        onOpenChange={setCriarAberto}
        rascunho={{ origem: "manual" }}
      />

      {enviando && (
        <SendWhatsAppDialog
          open
          onOpenChange={aberto => { if (!aberto) setEnviando(null); }}
          titulo={enviando.titulo}
          destinatario={dealPorId.get(enviando.dealId)?.customer || ""}
          textoInicial={textoEnvio}
          onEnviar={enviar}
        >
          <div className="flex items-center gap-2 rounded-lg bg-secondary/40 px-2 py-1.5 text-[11px] text-muted-foreground">
            <span className="flex-1">Sai pelo {instanciaClinica?.name}</span>
            <QuickReplyPicker
              contexto={{
                nome: dealPorId.get(enviando.dealId)?.customer,
                telefone: dealPorId.get(enviando.dealId)?.phone,
                atendente: currentUser?.name,
              }}
              onEscolher={texto => setTextoEnvio(texto)}
            />
          </div>
        </SendWhatsAppDialog>
      )}
    </AppLayout>
  );
}
