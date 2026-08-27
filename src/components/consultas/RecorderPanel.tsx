import { useRef, useState } from "react";
import { Mic, Pause, Play, Square, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecordingWaveform } from "@/components/chat/RecordingWaveform";
import { ACCEPT_IMPORTACAO } from "@/lib/audio-file";
import { cn } from "@/lib/utils";
import type { RecorderState } from "@/hooks/useConsultationRecorder";

const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

type Props = {
  state: RecorderState;
  seconds: number;
  stream: MediaStream | null;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onCancel: () => void;
  /** Arquivo escolhido no seletor ou solto na área. */
  onImport: (file: File) => void;
  className?: string;
};

export function RecorderPanel({
  state, seconds, stream, onStart, onPause, onResume, onStop, onCancel, onImport, className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);

  if (state === "parado") {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-2xl border border-dashed p-4 transition",
          arrastando ? "border-primary bg-primary-soft" : "border-border bg-secondary/20",
          className,
        )}
        onDragOver={e => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={e => {
          e.preventDefault();
          setArrastando(false);
          const file = Array.from(e.dataTransfer.files)[0];
          if (file) onImport(file);
        }}
      >
        <Button size="lg" className="gap-2" onClick={onStart}>
          <Mic className="h-5 w-5" /> Gravar consulta
        </Button>
        <Button size="lg" variant="outline" className="gap-2" onClick={() => inputRef.current?.click()}>
          <Upload className="h-5 w-5" /> Importar áudio
        </Button>
        <span className="text-xs text-muted-foreground">
          ou arraste aqui um áudio ou vídeo gravado fora do sistema
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_IMPORTACAO}
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            // Zerar permite escolher o MESMO arquivo de novo depois de um erro:
            // sem isto o `change` não dispara na segunda vez.
            e.target.value = "";
            if (file) onImport(file);
          }}
        />
      </div>
    );
  }

  const gravando = state === "gravando";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3",
        gravando && "border-destructive/40",
        className,
      )}
    >
      <span
        className={cn(
          "h-3 w-3 shrink-0 rounded-full",
          gravando ? "animate-pulse bg-destructive" : "bg-muted-foreground",
        )}
        aria-hidden
      />
      <div className="shrink-0">
        <div className="whitespace-nowrap text-sm font-medium">
          {gravando ? "Gravando consulta…" : "Gravação pausada"}
        </div>
        <div className="font-mono text-lg tabular-nums">{formatDuration(seconds)}</div>
      </div>

      {/* A cor vai explícita: o contexto 2D do canvas não resolve `currentColor`
          e cairia para preto. Mesmo motivo do gravador em Conversas. */}
      <RecordingWaveform
        stream={gravando ? stream : null}
        className="h-8 max-w-[280px] flex-1"
        color={gravando ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))"}
      />

      <div className="flex flex-wrap items-center gap-2">
        {gravando ? (
          <Button variant="outline" size="sm" className="gap-2" onClick={onPause}>
            <Pause className="h-4 w-4" /> Pausar
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-2" onClick={onResume}>
            <Play className="h-4 w-4" /> Continuar
          </Button>
        )}
        <Button size="sm" className="gap-2" onClick={onStop}>
          <Square className="h-4 w-4" /> Encerrar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-destructive hover:text-destructive"
          onClick={onCancel}
          title="Descartar a gravação"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
