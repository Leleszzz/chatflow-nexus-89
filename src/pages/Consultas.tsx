import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  MessageCircle,
  Mic,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Stethoscope,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AudioMessage } from "@/components/chat/AudioMessage";
import { RecorderPanel, formatDuration } from "@/components/consultas/RecorderPanel";
import { AttachToLeadDialog, AttachResult } from "@/components/consultas/AttachToLeadDialog";
import { TranscriptView } from "@/components/consultas/TranscriptView";
import { SpeakerMapper } from "@/components/consultas/SpeakerMapper";
import { SuggestionsPanel } from "@/components/consultas/SuggestionsPanel";
import { useConsultationRecorder, GravacaoPronta } from "@/hooks/useConsultationRecorder";
import { clearSession, listSessions, loadSession, pruneOldSessions, RecordingSession } from "@/lib/recording-store";
import { useCRM } from "@/store/crm-store";
import { whatsappApi, Consultation, TranscriptionStatus, WAConversation } from "@/lib/whatsapp-api";
import { cn } from "@/lib/utils";

const initials = (name: string) =>
  name.split(" ").filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join("") || "?";

const formatDateTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

function StatusBadge({ status }: { status: Consultation["status"] }) {
  if (status === "processando") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Transcrevendo
      </Badge>
    );
  }
  if (status === "erro") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" /> Erro
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 text-emerald-600">
      <CheckCircle2 className="h-3 w-3" /> Pronta
    </Badge>
  );
}

export default function Consultas() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    deals, canViewDeal, consultations, refreshConsultations, removeConsultation, currentUser, isDoutor,
  } = useCRM();

  const recorder = useConsultationRecorder();

  const [busca, setBusca] = useState("");
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);
  const [filtroDealId, setFiltroDealId] = useState<string | null>(searchParams.get("dealId"));

  const [gravacao, setGravacao] = useState<GravacaoPronta | null>(null);
  const [gravadaEm, setGravadaEm] = useState<string>("");
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);

  const [recuperavel, setRecuperavel] = useState<RecordingSession | null>(null);
  const [config, setConfig] = useState<TranscriptionStatus | null>(null);
  const [conversa, setConversa] = useState<WAConversation | null>(null);

  const [editando, setEditando] = useState(false);
  const [textoEditado, setTextoEditado] = useState("");
  const [salvandoTexto, setSalvandoTexto] = useState(false);
  const [gerandoResumo, setGerandoResumo] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    refreshConsultations();
  }, [refreshConsultations]);

  useEffect(() => {
    whatsappApi.getTranscriptionStatus().then(setConfig).catch(() => setConfig(null));
  }, []);

  // Gravação órfã de uma sessão anterior (F5, crash, queda de energia).
  useEffect(() => {
    pruneOldSessions().catch(() => {});
    listSessions()
      .then(sessoes => {
        const candidata = sessoes.find(s => s.chunkCount > 0);
        if (candidata) setRecuperavel(candidata);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const dealId = searchParams.get("dealId");
    setFiltroDealId(dealId);
  }, [searchParams]);

  const dealPorId = useMemo(() => new Map(deals.map(d => [d.id, d])), [deals]);

  const visiveis = useMemo(
    () => consultations.filter(c => {
      const deal = dealPorId.get(c.dealId);
      return !deal || canViewDeal(deal);
    }),
    [consultations, dealPorId, canViewDeal],
  );

  const filtradas = useMemo(() => {
    let lista = visiveis;
    if (filtroDealId) lista = lista.filter(c => c.dealId === filtroDealId);
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter(c => {
      const deal = dealPorId.get(c.dealId);
      const alvo = [c.title, deal?.customer, deal?.phone, c.transcriptText].join(" ").toLowerCase();
      return alvo.includes(q);
    });
  }, [visiveis, filtroDealId, busca, dealPorId]);

  const selecionada = useMemo(
    () => filtradas.find(c => c.id === selecionadaId) || visiveis.find(c => c.id === selecionadaId) || null,
    [filtradas, visiveis, selecionadaId],
  );

  const dealSelecionado = selecionada ? dealPorId.get(selecionada.dealId) : null;

  // A conversa do cliente é o que permite mandar exames e confirmação daqui. O
  // 404 é o caso normal de quem nunca conversou pelo WhatsApp — sem toast de
  // erro, os botões de envio só ficam desabilitados.
  useEffect(() => {
    const dealId = dealSelecionado?.id;
    if (!dealId) {
      setConversa(null);
      return;
    }
    let cancelado = false;
    whatsappApi.getConversationByDeal(dealId)
      .then(c => { if (!cancelado) setConversa(c); })
      .catch(() => { if (!cancelado) setConversa(null); });
    return () => { cancelado = true; };
  }, [dealSelecionado?.id]);

  // Sai do modo edição quando o médico troca de consulta, para não salvar o
  // texto de uma na outra.
  useEffect(() => {
    setEditando(false);
  }, [selecionadaId]);

  const configurado = config
    ? (config.provider === "groq" ? config.groqConfigured : config.assemblyaiConfigured)
    : true;

  const iniciarGravacao = async () => {
    if (!configurado) {
      toast.error("Configure a chave de transcrição em Configurações → Transcrição antes de gravar");
      return;
    }
    try {
      await recorder.start();
    } catch {
      toast.error(recorder.error || "Não foi possível acessar o microfone");
    }
  };

  const encerrarGravacao = async () => {
    const pronta = await recorder.stop(false);
    if (!pronta) {
      toast.error("A gravação saiu vazia");
      return;
    }
    setGravacao(pronta);
    setGravadaEm(new Date().toISOString());
  };

  const cancelarGravacao = async () => {
    if (!window.confirm("Descartar esta gravação? O áudio será perdido.")) return;
    await recorder.stop(true);
    toast.info("Gravação descartada");
  };

  const recuperarGravacao = async () => {
    if (!recuperavel) return;
    const dados = await loadSession(recuperavel.id);
    if (!dados) {
      toast.error("Não foi possível recuperar esta gravação");
      setRecuperavel(null);
      return;
    }
    const ext = dados.session.mimeType.includes("ogg") ? "ogg" : "webm";
    const file = new File([dados.blob], `consulta-${dados.session.startedAt}.${ext}`, { type: dados.blob.type });
    setGravacao({ blob: dados.blob, file, durationSec: dados.session.durationSec, sessionId: dados.session.id });
    setGravadaEm(new Date(dados.session.startedAt).toISOString());
    setRecuperavel(null);
  };

  const descartarRecuperavel = async () => {
    if (!recuperavel) return;
    if (!window.confirm("Descartar a gravação recuperada? O áudio será perdido.")) return;
    await clearSession(recuperavel.id);
    setRecuperavel(null);
  };

  const enviarConsulta = async ({ dealId, title }: AttachResult) => {
    if (!gravacao) return;
    setEnviando(true);
    setProgresso(0);
    try {
      const criada = await whatsappApi.uploadConsultation(
        {
          dealId,
          title,
          file: gravacao.file,
          durationSec: gravacao.durationSec,
          recordedAt: gravadaEm || new Date().toISOString(),
        },
        setProgresso,
      );
      // Só apaga o backup local depois que o servidor confirmou o recebimento.
      await clearSession(gravacao.sessionId).catch(() => {});
      setGravacao(null);
      setSelecionadaId(criada.id);
      await refreshConsultations();
      toast.success("Consulta enviada — a transcrição aparece aqui assim que ficar pronta");
    } catch (err) {
      toast.error(`Falha ao enviar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setEnviando(false);
      setProgresso(0);
    }
  };

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    audio.play().catch(() => {});
  }, []);

  const tentarDeNovo = async (consultation: Consultation) => {
    try {
      await whatsappApi.retryConsultation(consultation.id);
      toast.success("Reprocessando a transcrição…");
    } catch (err) {
      toast.error(`Falha ao reprocessar: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const gerarResumo = async (consultation: Consultation) => {
    setGerandoResumo(true);
    try {
      await whatsappApi.generateConsultationSummary(consultation.id);
      toast.success("Resumo clínico gerado");
    } catch (err) {
      toast.error(`Falha ao gerar o resumo: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGerandoResumo(false);
    }
  };

  const salvarTexto = async () => {
    if (!selecionada) return;
    setSalvandoTexto(true);
    try {
      await whatsappApi.patchConsultation(selecionada.id, { transcriptText: textoEditado });
      setEditando(false);
      toast.success("Transcrição corrigida");
    } catch (err) {
      toast.error(`Falha ao salvar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSalvandoTexto(false);
    }
  };

  const excluir = async (consultation: Consultation) => {
    if (!window.confirm(`Excluir "${consultation.title}"? O áudio e a transcrição serão perdidos.`)) return;
    try {
      await removeConsultation(consultation.id);
      if (selecionadaId === consultation.id) setSelecionadaId(null);
      toast.success("Consulta excluída");
    } catch (err) {
      toast.error(`Falha ao excluir: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const limparFiltroDeal = () => {
    setFiltroDealId(null);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("dealId");
      return next;
    });
  };

  const dealDoFiltro = filtroDealId ? dealPorId.get(filtroDealId) : null;

  return (
    <AppLayout title="Consultas" subtitle="Grave a consulta e tenha a transcrição no prontuário do cliente">
      <div className="space-y-4">
        {!configurado && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="flex-1">
              A transcrição ainda não está configurada. Adicione a chave do provedor para gravar consultas.
            </span>
            <Button size="sm" variant="outline" onClick={() => navigate("/configuracoes")}>
              Abrir configurações
            </Button>
          </div>
        )}

        {recuperavel && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary-soft px-4 py-3 text-sm">
            <RotateCcw className="h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1">
              Recuperamos uma gravação de {formatDuration(recuperavel.durationSec)} iniciada em{" "}
              {formatDateTime(new Date(recuperavel.startedAt).toISOString())}.
            </span>
            <Button size="sm" onClick={recuperarGravacao}>Anexar a um cliente</Button>
            <Button size="sm" variant="ghost" onClick={descartarRecuperavel}>Descartar</Button>
          </div>
        )}

        <RecorderPanel
          state={recorder.state}
          seconds={recorder.seconds}
          stream={recorder.stream}
          onStart={iniciarGravacao}
          onPause={recorder.pause}
          onResume={recorder.resume}
          onStop={encerrarGravacao}
          onCancel={cancelarGravacao}
        />

        <div className="grid h-[calc(100vh-280px)] min-h-[420px] grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
          {/* Lista de consultas */}
          <aside className="flex min-h-0 flex-col rounded-2xl border border-border bg-card">
            <div className="space-y-2 border-b border-border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar por cliente ou pelo que foi dito…"
                  className="pl-9"
                />
              </div>
              {dealDoFiltro && (
                <button
                  type="button"
                  onClick={limparFiltroDeal}
                  className="flex w-full items-center gap-2 rounded-lg bg-primary-soft px-2 py-1 text-xs text-primary"
                >
                  <span className="flex-1 truncate text-left">Filtrando: {dealDoFiltro.customer}</span>
                  <X className="h-3 w-3" />
                </button>
              )}
              <div className="text-xs text-muted-foreground">
                {filtradas.length} consulta{filtradas.length === 1 ? "" : "s"}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {filtradas.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Nenhuma consulta gravada ainda. Use o botão "Gravar consulta" acima.
                </div>
              ) : (
                filtradas.map(consulta => {
                  const deal = dealPorId.get(consulta.dealId);
                  const ativa = selecionadaId === consulta.id;
                  return (
                    <button
                      key={consulta.id}
                      type="button"
                      onClick={() => setSelecionadaId(consulta.id)}
                      className={cn(
                        "mb-1 flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition",
                        ativa ? "bg-primary-soft text-primary" : "hover:bg-secondary/60",
                      )}
                    >
                      <Avatar className="mt-0.5 h-9 w-9">
                        <AvatarImage src={deal?.avatar} alt={deal?.customer || ""} />
                        <AvatarFallback>{initials(deal?.customer || "?")}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{deal?.customer || "Cliente removido"}</div>
                        <div className="truncate text-xs text-muted-foreground">{consulta.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={consulta.status} />
                          {consulta.durationSec > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              {formatDuration(consulta.durationSec)}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Detalhe */}
          <section className="flex min-h-0 flex-col rounded-2xl border border-border bg-card">
            {!selecionada ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-muted-foreground">
                <Stethoscope className="h-10 w-10" />
                <div className="text-sm">
                  Selecione uma consulta à esquerda, ou grave uma nova.
                </div>
              </div>
            ) : (
              <>
                <header className="flex flex-wrap items-start gap-3 border-b border-border p-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold">{selecionada.title}</div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{dealSelecionado?.customer || "Cliente removido"}</span>
                      {dealSelecionado?.phone && <><span>•</span><span>{dealSelecionado.phone}</span></>}
                      <span>•</span>
                      <span>{formatDateTime(selecionada.recordedAt)}</span>
                      {selecionada.durationSec > 0 && (
                        <><span>•</span><span>{formatDuration(selecionada.durationSec)}</span></>
                      )}
                      {selecionada.edited && <><span>•</span><span>corrigida à mão</span></>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {dealSelecionado && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => navigate(`/prontuarios?dealId=${encodeURIComponent(dealSelecionado.id)}`)}
                        >
                          <FileText className="h-4 w-4" /> Prontuário
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => navigate(`/conversas?deal=${encodeURIComponent(dealSelecionado.id)}`)}
                        >
                          <MessageCircle className="h-4 w-4" /> Conversa
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2 text-destructive hover:text-destructive"
                      onClick={() => excluir(selecionada)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </header>

                <div className="flex-1 space-y-4 overflow-y-auto p-4">
                  {/* Player. O <audio> cru convive com o AudioMessage porque é
                      ele que o seek por timestamp controla. */}
                  <div className="rounded-xl border border-border bg-secondary/20 p-3">
                    <audio ref={audioRef} src={selecionada.audioUrl} preload="metadata" className="hidden" />
                    <AudioMessage src={selecionada.audioUrl} mine={false} />
                  </div>

                  {selecionada.status === "processando" && (
                    <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/20 p-4 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span>
                        Transcrevendo e separando os falantes. Pode fechar esta tela — a transcrição
                        aparece aqui sozinha quando terminar.
                      </span>
                    </div>
                  )}

                  {selecionada.status === "erro" && (
                    <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                        <AlertTriangle className="h-4 w-4" /> A transcrição falhou
                      </div>
                      <p className="text-xs text-muted-foreground">{selecionada.error}</p>
                      <p className="text-xs text-muted-foreground">
                        O áudio está salvo — dá para tentar de novo sem regravar.
                      </p>
                      <Button size="sm" className="gap-2" onClick={() => tentarDeNovo(selecionada)}>
                        <RefreshCw className="h-4 w-4" /> Tentar de novo
                      </Button>
                    </div>
                  )}

                  {selecionada.status === "pronto" && (
                    <>
                      {!selecionada.edited && (
                        <SpeakerMapper
                          consultation={selecionada}
                          nomeDoProfissional={isDoutor ? currentUser?.name : undefined}
                        />
                      )}

                      {selecionada.summary ? (
                        <div className="rounded-xl border border-border p-3">
                          <div className="mb-2 flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-primary" />
                            <span className="text-sm font-medium">Resumo clínico</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="ml-auto h-7 gap-1 px-2 text-xs"
                              onClick={() => gerarResumo(selecionada)}
                              disabled={gerandoResumo}
                            >
                              {gerandoResumo
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <RefreshCw className="h-3 w-3" />}
                              Regerar
                            </Button>
                          </div>
                          <dl className="grid gap-2 text-sm sm:grid-cols-2">
                            {([
                              ["Queixa", selecionada.summary.queixa],
                              ["Histórico", selecionada.summary.historico],
                              ["Avaliação", selecionada.summary.avaliacao],
                              ["Conduta", selecionada.summary.conduta],
                            ] as const).map(([rotulo, valor]) => (
                              <div key={rotulo}>
                                <dt className="text-xs font-medium text-muted-foreground">{rotulo}</dt>
                                <dd className="whitespace-pre-wrap">{valor || "—"}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => gerarResumo(selecionada)}
                          disabled={gerandoResumo}
                        >
                          {gerandoResumo
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Sparkles className="h-4 w-4" />}
                          Gerar resumo clínico
                        </Button>
                      )}

                      <SuggestionsPanel
                        consultation={selecionada}
                        deal={dealSelecionado}
                        conversa={conversa}
                      />

                      <div className="rounded-xl border border-border p-3">
                        <div className="mb-3 flex items-center gap-2">
                          <Mic className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Transcrição</span>
                          {!editando ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="ml-auto h-7 gap-1 px-2 text-xs"
                              onClick={() => {
                                setTextoEditado(selecionada.transcriptText);
                                setEditando(true);
                              }}
                            >
                              <Pencil className="h-3 w-3" /> Corrigir
                            </Button>
                          ) : (
                            <div className="ml-auto flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setEditando(false)}
                              >
                                Cancelar
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 gap-1 px-2 text-xs"
                                onClick={salvarTexto}
                                disabled={salvandoTexto}
                              >
                                {salvandoTexto
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <Save className="h-3 w-3" />}
                                Salvar
                              </Button>
                            </div>
                          )}
                        </div>

                        {editando ? (
                          <>
                            <Textarea
                              value={textoEditado}
                              onChange={e => setTextoEditado(e.target.value)}
                              rows={20}
                              className="font-mono text-xs"
                            />
                            <p className="mt-2 text-xs text-muted-foreground">
                              Salvar a correção substitui a transcrição usada pelos agentes de IA e
                              desliga a separação automática por falante desta consulta.
                            </p>
                          </>
                        ) : (
                          <TranscriptView consultation={selecionada} onSeek={seek} />
                        )}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      <AttachToLeadDialog
        open={Boolean(gravacao)}
        onOpenChange={aberto => { if (!aberto) setGravacao(null); }}
        durationSec={gravacao?.durationSec || 0}
        recordedAt={gravadaEm || new Date().toISOString()}
        enviando={enviando}
        progresso={progresso}
        onConfirm={enviarConsulta}
      />
    </AppLayout>
  );
}
