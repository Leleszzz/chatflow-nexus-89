import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCRM } from "@/store/crm-store";
import { Agent, MODEL_OPTIONS } from "@/lib/mock-data";
import { whatsappApi } from "@/lib/whatsapp-api";
import { Checkbox } from "@/components/ui/checkbox";
import { Bot, Plus, Copy, Trash2, Pencil, Sparkles, Send, MessageSquare, CheckCircle2, PauseCircle, TestTube2, AlertTriangle, Loader2, DollarSign, RotateCcw, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { mensagemDeErro } from "@/lib/erros";

const VALID_MODEL_IDS = MODEL_OPTIONS.map(o => o.id);
const normalizeModel = (id: string | undefined): Agent["model"] =>
  (VALID_MODEL_IDS as string[]).includes(id || "") ? (id as Agent["model"]) : "balanced";

const formatUsd = (value: number) => {
  if (!Number.isFinite(value) || value === 0) return "$0.0000";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
};

const formatTokens = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
};

const emptyAgent: Omit<Agent, "id" | "conversations" | "updatedAt"> = {
  name: "", description: "", prompt: "", model: "balanced", temperature: 0.7, active: true,
  channel: "WhatsApp Principal", triggerTags: [], blockWords: [], handoffMessage: "Vou te transferir para um especialista.", fallbackMessage: "Não consegui entender totalmente. Pode reformular?",
  extractFields: [],
};

const AGENT_TEMPLATES = [
  { name: "Agente de pré-venda", objective: "Qualificar interesse e encaminhar leads prontos para um atendente.", description: "Responde dúvidas iniciais, coleta informações do cliente e direciona leads qualificados para um atendente.", tone: "Consultivo e objetivo" },
  { name: "Agente de suporte", objective: "Resolver dúvidas frequentes e abrir passagem para humano quando necessário.", description: "Ajuda clientes com perguntas recorrentes, status de atendimento e orientações simples.", tone: "Calmo e didático" },
  { name: "Agente de cobrança", objective: "Negociar pendências com linguagem respeitosa.", description: "Lembra vencimentos, confirma dados e direciona acordos para o financeiro.", tone: "Profissional e cordial" },
  { name: "Agente de recuperação de leads", objective: "Reativar contatos parados sem parecer insistente.", description: "Retoma conversas antigas, entende objeções e tenta recuperar oportunidades.", tone: "Amigável e direto" },
  { name: "Agente de pós-venda", objective: "Acompanhar satisfação e oportunidades futuras.", description: "Confirma entrega, coleta feedback e identifica novas necessidades.", tone: "Cuidadoso e próximo" },
  { name: "Agente de qualificação", objective: "Coletar perfil, necessidade, orçamento e urgência.", description: "Faz perguntas estruturadas para classificar o lead como quente, morno ou frio.", tone: "Claro e organizado" },
];

export default function Agentes() {
  const { agents, addAgent, updateAgentConfig, removeAgent, customFields, agentUsage, refreshAgentUsage, resetAgentUsage, conversationPatches, deals } = useCRM();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Agent | null>(null);
  const [open, setOpen] = useState(false);
  const [testInput, setTestInput] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    refreshAgentUsage().catch(() => {});
  }, [refreshAgentUsage]);

  const openNew = () => { setEditing({ ...emptyAgent, id: "new", conversations: 0, updatedAt: new Date().toISOString() } as Agent); setOpen(true); };
  const openTemplate = (template: typeof AGENT_TEMPLATES[number]) => {
    setEditing({
      ...emptyAgent,
      id: "new",
      name: template.name,
      description: template.description,
      prompt: `Objetivo: ${template.objective}\nTom de voz: ${template.tone}\nQuando transferir para humano: quando houver pedido de desconto, reclamação, compra pronta ou dúvida fora do escopo.\nMensagem de fallback: ${emptyAgent.fallbackMessage}`,
      conversations: 0,
      updatedAt: new Date().toISOString(),
    } as Agent);
    setOpen(true);
  };
  const openEdit = (a: Agent) => { setEditing({ ...a, model: normalizeModel(a.model) }); setOpen(true); };

  const editingHistory = useMemo(() => {
    if (!editing || editing.id === "new") return [];
    const items: { conversationId: string; customer: string; lastInteraction?: string; dealId?: string }[] = [];
    const seen = new Set<string>();
    for (const [convId, patch] of Object.entries(conversationPatches)) {
      const dealLinked = patch.dealId ? deals.find(d => d.id === patch.dealId) : undefined;
      const matches = (dealLinked?.aiAgentId === editing.id) || (patch.aiAgentId === editing.id);
      if (!matches) continue;
      if (seen.has(convId)) continue;
      seen.add(convId);
      items.push({
        conversationId: convId,
        customer: patch.customer || dealLinked?.customer || convId,
        lastInteraction: dealLinked?.lastInteraction,
        dealId: dealLinked?.id,
      });
    }
    return items.sort((a, b) => (b.lastInteraction || "").localeCompare(a.lastInteraction || ""));
  }, [editing, conversationPatches, deals]);

  const editingUsage = editing && editing.id !== "new" ? agentUsage[editing.id] : undefined;

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) return toast.error("Nome do agente é obrigatório");
    const { id, conversations, updatedAt, ...payload } = editing;
    if (id === "new") {
      const criado = await addAgent(payload);
      if (!criado) return toast.error("Não foi possível criar o agente");
      toast.success("Agente criado!");
    } else {
      await updateAgentConfig(id, payload);
      toast.success("Agente atualizado!");
    }
    setOpen(false);
  };

  const duplicate = async (a: Agent) => {
    const { id, conversations, updatedAt, ...payload } = a;
    const criado = await addAgent({ ...payload, name: `${a.name} (cópia)` });
    toast[criado ? "success" : "error"](criado ? "Agente duplicado" : "Não foi possível duplicar");
  };
  const remove = async (id: string) => { await removeAgent(id); toast.success("Agente removido"); };

  const toggleExtractField = (key: string) => {
    if (!editing) return;
    const atual = editing.extractFields || [];
    setEditing({
      ...editing,
      extractFields: atual.includes(key) ? atual.filter(k => k !== key) : [...atual, key],
    });
  };
  const runTest = async () => {
    if (!editing) return;
    const message = testInput.trim();
    if (!message) return;
    setTesting(true);
    setTestOutput("Pensando...");
    try {
      const { reply, model } = await whatsappApi.testAgent({
        model: editing.model,
        temperature: editing.temperature,
        systemPrompt: editing.prompt,
        userMessage: message,
      });
      setTestOutput(`${reply}\n\n[Resposta gerada pelo modelo ${model}]`);
    } catch (err) {
      const msg = mensagemDeErro(err) || "Falha ao testar o agente";
      if (msg.includes("OpenAI key não configurada")) {
        toast.error("Configure a OpenAI API key em Configurações");
      } else {
        toast.error(msg);
      }
      setTestOutput("");
    } finally {
      setTesting(false);
    }
  };

  return (
    <AppLayout title="Agentes de IA" subtitle="Piloto automático para suas conversas">
      <div className="flex items-center justify-between mb-6">
        <div className="text-sm text-muted-foreground">{agents.length} agentes configurados · {agents.filter(a => a.active).length} ativos</div>
        <Button onClick={openNew} className="bg-gradient-primary gap-2"><Plus className="w-4 h-4" /> Criar novo agente</Button>
      </div>

      <section className="card-elevated mb-6 p-5">
        <div className="mb-4">
          <h2 className="font-display text-base font-bold">Modelos prontos de agentes</h2>
          <p className="text-xs text-muted-foreground">Escolha um ponto de partida e ajuste instruções antes de ativar.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {AGENT_TEMPLATES.map(template => (
            <button key={template.name} type="button" onClick={() => openTemplate(template)} className="rounded-xl border border-border/70 bg-background p-4 text-left transition hover:border-primary/30 hover:bg-secondary/50">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-primary" /> {template.name}</div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{template.description}</p>
              <div className="mt-3 text-[11px] font-semibold text-primary">{template.tone}</div>
            </button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {agents.map(a => {
          const model = MODEL_OPTIONS.find(o => o.id === normalizeModel(a.model));
          const usage = agentUsage[a.id];
          const totalTokens = (usage?.promptTokens || 0) + (usage?.completionTokens || 0);
          return (
            <div key={a.id} className="card-elevated p-5 hover:shadow-soft transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
                  <Bot className="w-5 h-5 text-primary-foreground" />
                </div>
              </div>
              <h3 className="font-display font-bold text-base mb-1">{a.name}</h3>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{a.description}</p>

              <div className="flex flex-wrap gap-1.5 mb-4">
                <span className={cn("inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold",
                  a.active ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>
                  {a.active ? <CheckCircle2 className="h-3 w-3" /> : <PauseCircle className="h-3 w-3" />}
                  {a.active ? "Ativo" : "Inativo"}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-warning-soft text-warning font-semibold"><TestTube2 className="h-3 w-3" /> Em teste</span>
                {!a.prompt && <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-destructive-soft text-destructive font-semibold"><AlertTriangle className="h-3 w-3" /> Requer revisão</span>}
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-soft text-primary font-semibold">{model?.label}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground font-semibold">{a.conversations} conversas</span>
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-info-soft text-info font-semibold" title={`${(usage?.promptTokens || 0).toLocaleString()} prompt + ${(usage?.completionTokens || 0).toLocaleString()} completion`}>
                  <DollarSign className="h-3 w-3" /> {formatUsd(usage?.costUsd || 0)} · {formatTokens(totalTokens)} tk
                </span>
              </div>

              <div className="text-[10px] text-muted-foreground mb-3">Atualizado {formatDistanceToNow(new Date(a.updatedAt), { locale: ptBR, addSuffix: true })}</div>

              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => openEdit(a)}><Pencil className="w-3 h-3" /> Editar</Button>
                <Button size="icon" variant="outline" onClick={() => duplicate(a)}><Copy className="w-3.5 h-3.5" /></Button>
                <Button size="icon" variant="outline" onClick={() => remove(a.id)} className="text-destructive hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> {editing?.id === "new" ? "Criar novo agente" : "Editar agente"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <Tabs defaultValue="config">
              <TabsList className="grid grid-cols-5 w-full bg-secondary">
                <TabsTrigger value="config">Configuração</TabsTrigger>
                <TabsTrigger value="prompt">Prompt</TabsTrigger>
                <TabsTrigger value="rules">Regras</TabsTrigger>
                <TabsTrigger value="test">Teste</TabsTrigger>
                <TabsTrigger value="history">Histórico</TabsTrigger>
              </TabsList>

              <TabsContent value="config" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Nome do agente *</Label><Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
                  <div><Label>Canal vinculado</Label><Input value={editing.channel} onChange={e => setEditing({ ...editing, channel: e.target.value })} /></div>
                </div>
                <div><Label>Objetivo e descrição interna</Label><Textarea value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={3} /></div>

                <div>
                  <Label className="mb-2 block">Modelo de IA</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {MODEL_OPTIONS.map(m => {
                      const selected = normalizeModel(editing.model) === m.id;
                      return (
                        <button key={m.id} type="button" onClick={() => setEditing({ ...editing, model: m.id })}
                          className={cn("p-3 rounded-xl border-2 text-left transition-all",
                            selected ? "border-primary bg-primary-soft" : "border-border bg-card hover:border-primary/40")}>
                          <div className="font-semibold text-sm">{m.label}</div>
                          <div className="text-[10px] font-mono text-muted-foreground">{m.model}</div>
                          <div className="text-[10px] text-muted-foreground mt-1">{m.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {editing.id !== "new" && editingUsage && (
                  <div className="rounded-xl border border-border bg-secondary/60 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold flex items-center gap-1.5"><DollarSign className="h-3.5 w-3.5 text-primary" /> Custo acumulado</div>
                        <div className="text-[11px] text-muted-foreground">Soma de todas as respostas geradas por este agente.</div>
                      </div>
                      <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={async () => {
                        await resetAgentUsage(editing.id);
                        toast.success("Custo zerado");
                      }}>
                        <RotateCcw className="w-3 h-3" /> Zerar
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-card p-2">
                        <div className="text-[10px] text-muted-foreground">Custo total</div>
                        <div className="text-sm font-bold">{formatUsd(editingUsage.costUsd || 0)}</div>
                      </div>
                      <div className="rounded-lg bg-card p-2">
                        <div className="text-[10px] text-muted-foreground">Prompt</div>
                        <div className="text-sm font-bold">{(editingUsage.promptTokens || 0).toLocaleString()}</div>
                      </div>
                      <div className="rounded-lg bg-card p-2">
                        <div className="text-[10px] text-muted-foreground">Completion</div>
                        <div className="text-sm font-bold">{(editingUsage.completionTokens || 0).toLocaleString()}</div>
                      </div>
                    </div>
                    {editingUsage.lastUpdatedAt && (
                      <div className="text-[10px] text-muted-foreground">Atualizado {formatDistanceToNow(new Date(editingUsage.lastUpdatedAt), { locale: ptBR, addSuffix: true })}</div>
                    )}
                  </div>
                )}

                <div>
                  <Label>Temperatura: {editing.temperature.toFixed(1)}</Label>
                  <Slider value={[editing.temperature]} min={0} max={1} step={0.1} onValueChange={(v) => setEditing({ ...editing, temperature: v[0] })} className="mt-2" />
                </div>

                <div className="rounded-xl bg-secondary p-3">
                  <div className="font-semibold text-sm">Status operacional</div>
                  <div className="text-xs text-muted-foreground">A ativação será controlada pela conversa e pelas regras. O horário de funcionamento do agente fica em Configurações → Distribuições & Agente.</div>
                </div>
              </TabsContent>

              <TabsContent value="prompt" className="space-y-4 mt-4">
                <div><Label>Prompt / instruções do agente</Label>
                  <Textarea value={editing.prompt} onChange={e => setEditing({ ...editing, prompt: e.target.value })} rows={10} className="font-mono text-xs" /></div>
                <div><Label>Quando deve transferir para humano</Label>
                  <Input value={editing.blockWords.join(", ")} onChange={e => setEditing({ ...editing, blockWords: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} placeholder="reclamação, desconto, cancelar, falar com atendente" /></div>
                <div><Label>Mensagem de transferência para humano</Label>
                  <Input value={editing.handoffMessage} onChange={e => setEditing({ ...editing, handoffMessage: e.target.value })} /></div>
                <div><Label>Mensagem de fallback</Label>
                  <Input value={(editing as Agent & { fallbackMessage?: string }).fallbackMessage || ""} onChange={e => setEditing({ ...editing, fallbackMessage: e.target.value } as Agent & { fallbackMessage?: string })} /></div>
              </TabsContent>

              <TabsContent value="rules" className="space-y-4 mt-4">
                <div><Label>Tags que ativam o agente (separadas por vírgula)</Label>
                  <Input value={editing.triggerTags.join(", ")} onChange={e => setEditing({ ...editing, triggerTags: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} /></div>
                <div><Label>Tom de voz</Label>
                  <Input defaultValue="Consultivo, claro e humano" /></div>
                <div><Label>Palavras que bloqueiam o agente</Label>
                  <Input value={editing.blockWords.join(", ")} onChange={e => setEditing({ ...editing, blockWords: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} /></div>
                <div><Label>Limite de mensagens automáticas por conversa</Label><Input type="number" defaultValue={10} /></div>

                <div className="rounded-xl border border-border/70 bg-secondary/40 p-3">
                  <Label className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary" /> Meta de coleta
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Os campos marcados entram no objetivo do agente: ele conduz a conversa para
                    obtê-los e grava no cadastro do lead assim que o cliente informar.
                  </p>
                  {customFields.length === 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Nenhum campo personalizado cadastrado ainda. Crie em{" "}
                      <span className="font-medium">Configurações &rsaquo; Campos do lead</span>.
                    </p>
                  ) : (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {customFields.map(field => {
                        const marcado = (editing.extractFields || []).includes(field.key);
                        return (
                          <label
                            key={field.id}
                            className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/70 bg-card p-2 text-xs transition hover:border-primary/50"
                          >
                            <Checkbox checked={marcado} onCheckedChange={() => toggleExtractField(field.key)} className="mt-0.5" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{field.label}</span>
                              <span className="block truncate font-mono text-[10px] text-muted-foreground">
                                {field.key} · {field.type}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="test" className="space-y-3 mt-4">
                <div className="text-xs text-muted-foreground bg-info-soft text-info p-3 rounded-xl">
                  Teste em chat simulado antes de ativar. Modelo em uso: <strong>{MODEL_OPTIONS.find(m => m.id === editing.model)?.model}</strong>
                </div>
                <div><Label>Mensagem do cliente</Label>
                  <Textarea value={testInput} onChange={e => setTestInput(e.target.value)} rows={3} placeholder="Digite uma mensagem para testar..." /></div>
                <Button onClick={runTest} className="bg-gradient-primary gap-2" disabled={testing || !testInput.trim()}>
                  {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Testar agente
                </Button>
                {testOutput && (
                  <div className="rounded-xl border border-border bg-secondary p-4">
                    <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><Bot className="w-3 h-3" /> Resposta gerada</div>
                    <div className="text-sm whitespace-pre-wrap">{testOutput}</div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="history" className="mt-4 space-y-2">
                {editing.id === "new" ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <div className="text-sm">Salve o agente para começar a registrar histórico.</div>
                  </div>
                ) : editingHistory.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <div className="text-sm">Ainda nenhuma conversa atendida por este agente.</div>
                  </div>
                ) : (
                  <>
                    <div className="text-xs text-muted-foreground mb-2">{editingHistory.length} conversa(s) já atendida(s) por este agente.</div>
                    <div className="max-h-[400px] overflow-y-auto divide-y divide-border rounded-xl border border-border">
                      {editingHistory.map(item => (
                        <button
                          key={item.conversationId}
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            navigate(`/conversas?id=${encodeURIComponent(item.conversationId)}`);
                          }}
                          className="w-full text-left p-3 hover:bg-secondary/60 transition flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{item.customer}</div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {item.lastInteraction
                                ? `Última interação ${formatDistanceToNow(new Date(item.lastInteraction), { locale: ptBR, addSuffix: true })}`
                                : "Sem registro de última interação"}
                            </div>
                          </div>
                          <MessageSquare className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          )}
          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} className="bg-gradient-primary">Salvar agente</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
