import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

const SPEEDS = [1, 1.5, 2] as const;

const formatTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export function AudioMessage({ src, mine = false }: { src: string; mine?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<typeof SPEEDS[number]>(1);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrent(a.currentTime);
    const onDur = () => {
      const d = a.duration;
      if (Number.isFinite(d)) setDuration(d);
    };
    const onEnd = () => { setPlaying(false); setCurrent(0); a.currentTime = 0; };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("durationchange", onDur);
    a.addEventListener("ended", onEnd);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("durationchange", onDur);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) a.pause();
    else { try { await a.play(); } catch {} }
  };

  const seek = (clientX: number) => {
    const el = trackRef.current;
    const a = audioRef.current;
    if (!el || !a || !duration) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    a.currentTime = ratio * duration;
    setCurrent(a.currentTime);
  };

  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  };

  return (
    <div className={cn(
      "flex w-[260px] items-center gap-3 rounded-2xl px-3 py-2",
      mine ? "bg-primary/30" : "bg-secondary",
    )}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition",
          mine ? "bg-primary-foreground text-primary hover:opacity-90" : "bg-primary text-primary-foreground hover:opacity-90",
        )}
        aria-label={playing ? "Pausar" : "Tocar"}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          ref={trackRef}
          onMouseDown={e => seek(e.clientX)}
          onClick={e => seek(e.clientX)}
          className={cn(
            "relative h-1.5 w-full cursor-pointer overflow-hidden rounded-full",
            mine ? "bg-primary-foreground/30" : "bg-foreground/15",
          )}
        >
          <div
            className={cn("absolute left-0 top-0 h-full rounded-full", mine ? "bg-primary-foreground" : "bg-primary")}
            style={{ width: `${progress}%` }}
          />
          <div
            className={cn("absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full shadow", mine ? "bg-primary-foreground" : "bg-primary")}
            style={{ left: `${progress}%` }}
          />
        </div>
        <div className={cn("flex items-center justify-between text-[10px] font-medium", mine ? "text-primary-foreground/80" : "text-muted-foreground")}>
          <span>{formatTime(playing || current > 0 ? current : duration)}</span>
          <button
            type="button"
            onClick={cycleSpeed}
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase transition",
              mine ? "bg-primary-foreground/20 hover:bg-primary-foreground/30" : "bg-foreground/10 hover:bg-foreground/20",
            )}
          >
            {speed}x
          </button>
        </div>
      </div>
    </div>
  );
}
