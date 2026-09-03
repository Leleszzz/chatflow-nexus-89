import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RecordingWaveform } from "@/components/chat/RecordingWaveform";
import { useIsCompact } from "@/hooks/use-mobile";
import { whatsappApi } from "@/lib/whatsapp-api";
import { mensagemDeErro } from "@/lib/erros";
import type { AssistantEntrada } from "@/lib/whatsapp-api";

/** Teto de gravação. Um comando falado passa longe disso; o limite existe para o
 *  microfone esquecido aberto não virar um upload de dez minutos. */
const MAX_SEGUNDOS = 120;

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function ComposerAssistente({
  onEnviar, ocupado,
}: {
  onEnviar: (texto: string, entrada: AssistantEntrada) => void;
  ocupado: boolean;
}) {
  const [rascunho, setRascunho] = useState("");
  const [entrada, setEntrada] = useState<AssistantEntrada>("texto");
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [transcrevendo, setTranscrevendo] = useState(false);
  const [temMicrofone, setTemMicrofone] = useState(false);

  const compact = useIsCompact();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  // O mic só aparece se a transcrição do Groq estiver configurada: o assistente
  // usa sempre o Groq (é o rápido), então uma clínica só com AssemblyAI não tem
  // como transcrever comando de voz, e um botão que sempre falha é pior que
  // botão nenhum.
  useEffect(() => {
    whatsappApi.getTranscriptionStatus()
      .then(s => setTemMicrofone(Boolean(s.groqConfigured)))
      .catch(() => setTemMicrofone(false));
  }, []);

  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => setSegundos(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [gravando]);

  // Corta sozinho no teto, em vez de deixar a gravação correndo.
  useEffect(() => {
    if (gravando && segundos >= MAX_SEGUNDOS) pararGravacao(false);
  }, [gravando, segundos]);

  const enviar = () => {
    const texto = rascunho.trim();
    if (!texto || ocupado) return;
    onEnviar(texto, entrada);
    setRascunho("");
    setEntrada("texto");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const iniciarGravacao = async () => {
    try {
      const midia = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Mesma cascata de MIME de Conversas.tsx: o Safari não tem webm/opus.
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
        .find(m => MediaRecorder.isTypeSupported(m)) || "";
      const recorder = new MediaRecorder(midia, mime ? { mimeType: mime } : undefined);
      const pedacos: BlobPart[] = [];

      recorder.ondataavailable = e => { if (e.data.size) pedacos.push(e.data); };
      recorder.onstop = async () => {
        midia.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setStream(null);
        const cancelado = (recorder as MediaRecorder & { _cancelado?: boolean })._cancelado;
        if (cancelado || !pedacos.length) return;

        const tipo = mime || "audio/webm";
        const ext = tipo.includes("ogg") ? "ogg" : "webm";
        const arquivo = new File([new Blob(pedacos, { type: tipo })], `comando-${Date.now()}.${ext}`, { type: tipo });

        setTranscrevendo(true);
        try {
          const { texto } = await whatsappApi.transcribeAssistantAudio(arquivo);
          // Cai no campo em vez de ser enviado direto: o Whisper erra nome
          // próprio ("Matheus" vira "Mateus"), e errar o nome com desambiguação
          // em cima é frustração garantida.
          setRascunho(atual => (atual.trim() ? `${atual.trim()} ${texto}` : texto));
          setEntrada("voz");
          requestAnimationFrame(() => inputRef.current?.focus());
        } catch (err) {
          toast.error(mensagemDeErro(err, "Não consegui transcrever o áudio."));
        } finally {
          setTranscrevendo(false);
        }
      };

      recorderRef.current = recorder;
      streamRef.current = midia;
      setStream(midia);
      setSegundos(0);
      setGravando(true);
      recorder.start();
    } catch {
      toast.error("Não consegui acessar o microfone. Verifique a permissão do navegador.");
    }
  };

  const pararGravacao = (cancelar: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    (recorder as MediaRecorder & { _cancelado?: boolean })._cancelado = cancelar;
    if (recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    setGravando(false);
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  if (gravando) {
    return (
      <div className="flex items-center gap-2 border-t border-border bg-card p-2 sm:p-3">
        <Button variant="ghost" size="iconSm" onClick={() => pararGravacao(true)} title="Cancelar">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" />
          <RecordingWaveform stream={stream} className="h-7 min-w-0 flex-1" color="hsl(var(--destructive))" />
          <span className="shrink-0 text-xs tabular-nums text-destructive">{mmss(segundos)}</span>
        </div>
        <Button size="sm" onClick={() => pararGravacao(false)} className="shrink-0 gap-1.5">
          <Send className="h-4 w-4" />
          <span className="hidden sm:inline">Usar</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-1 border-t border-border bg-card p-2 sm:gap-2 sm:p-3">
      {temMicrofone && (
        <Button
          variant="ghost"
          size="iconSm"
          onClick={iniciarGravacao}
          disabled={ocupado || transcrevendo}
          title="Falar em vez de digitar"
          className="shrink-0"
        >
          {transcrevendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
        </Button>
      )}
      <Textarea
        ref={inputRef}
        value={rascunho}
        onChange={e => setRascunho(e.target.value)}
        onKeyDown={e => {
          // Enter envia só no desktop: no teclado virtual não há Shift+Enter,
          // então enviar no Enter impediria escrever mais de uma linha.
          if (e.key === "Enter" && !e.shiftKey && !compact) {
            e.preventDefault();
            enviar();
          }
        }}
        placeholder={transcrevendo ? "Transcrevendo o áudio…" : "Pergunte sobre a agenda, uma consulta, um paciente…"}
        rows={1}
        disabled={ocupado}
        className="max-h-32 min-h-[40px] resize-none bg-secondary"
      />
      <Button
        onClick={enviar}
        disabled={ocupado || !rascunho.trim()}
        className="shrink-0 gap-2 px-3 sm:px-4"
        aria-label="Enviar"
      >
        {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        <span className="hidden sm:inline">Enviar</span>
      </Button>
    </div>
  );
}
