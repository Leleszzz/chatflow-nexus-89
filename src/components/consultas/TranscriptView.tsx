import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Consultation, ConsultationSegment, ConsultationSpeaker } from "@/lib/whatsapp-api";

const pad2 = (n: number) => String(n).padStart(2, "0");

function timecode(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`;
}

// Cores por falante. Só as duas primeiras importam na prática (médico e
// paciente); as outras existem para acompanhante e para o caso de a diarização
// inventar um falante a mais.
const CORES = [
  "border-l-primary bg-primary-soft/40",
  "border-l-emerald-500 bg-emerald-500/10",
  "border-l-amber-500 bg-amber-500/10",
  "border-l-violet-500 bg-violet-500/10",
];

/** Junta falas seguidas do mesmo falante — a mesma fusão feita no servidor. */
function agrupar(segments: ConsultationSegment[]) {
  const blocos: { speaker: string; start: number; text: string }[] = [];
  for (const seg of segments) {
    const texto = seg.text.trim();
    if (!texto) continue;
    const ultimo = blocos[blocos.length - 1];
    if (ultimo && ultimo.speaker === seg.speaker) {
      ultimo.text += ` ${texto}`;
      continue;
    }
    blocos.push({ speaker: seg.speaker, start: seg.start, text: texto });
  }
  return blocos;
}

type Props = {
  consultation: Consultation;
  onSeek?: (seconds: number) => void;
  className?: string;
};

export function TranscriptView({ consultation, onSeek, className }: Props) {
  const blocos = useMemo(() => agrupar(consultation.segments), [consultation.segments]);

  const indicePorFalante = useMemo(() => {
    const map = new Map<string, number>();
    consultation.speakers.forEach((s: ConsultationSpeaker, i) => map.set(s.key, i));
    return map;
  }, [consultation.speakers]);

  const rotuloDe = (key: string) =>
    consultation.speakers.find(s => s.key === key)?.label || key;

  // Transcrição editada à mão não tem mais segmentos confiáveis: o texto do
  // médico é a verdade, e reconstruí-lo em bolhas inventaria um alinhamento
  // que não existe mais.
  if (consultation.edited) {
    return (
      <pre className={cn("whitespace-pre-wrap break-words font-sans text-sm leading-relaxed", className)}>
        {consultation.transcriptText}
      </pre>
    );
  }

  if (!blocos.length) {
    return (
      <div className={cn("p-6 text-center text-sm text-muted-foreground", className)}>
        Esta consulta ainda não tem transcrição.
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {blocos.map((bloco, i) => {
        const cor = CORES[(indicePorFalante.get(bloco.speaker) ?? 0) % CORES.length];
        return (
          <div key={i} className={cn("rounded-lg border-l-4 px-3 py-2", cor)}>
            <div className="mb-0.5 flex items-baseline gap-2">
              <span className="text-xs font-semibold">{rotuloDe(bloco.speaker)}</span>
              <button
                type="button"
                onClick={() => onSeek?.(bloco.start)}
                className="font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                title="Ouvir a partir daqui"
              >
                {timecode(bloco.start)}
              </button>
            </div>
            <p className="text-sm leading-relaxed">{bloco.text}</p>
          </div>
        );
      })}
    </div>
  );
}
