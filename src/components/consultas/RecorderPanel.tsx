import { Mic, Pause, Play, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecordingWaveform } from "@/components/chat/RecordingWaveform";
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
  className?: string;
};

export function RecorderPanel({
  state, seconds, stream, onStart, onPause, onResume, onStop, onCancel, className,
}: Props) {
  if (state === "parado") {
    return (
      <Button size="lg" className={cn("gap-2", className)} onClick={onStart}>
        <Mic className="h-5 w-5" /> Gravar consulta
      </Button>
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

      <div className="flex items-center gap-2">
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
