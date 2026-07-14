import { useEffect, useRef, useState } from "react";
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/format";

const SPEEDS = [1, 1.5, 2] as const;

type Props = {
  src: string;
  className?: string;
  autoPlay?: boolean;
};

export function VideoPlayer({ src, className, autoPlay = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(autoPlay);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<typeof SPEEDS[number]>(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrent(v.currentTime);
    const onDur = () => { const d = v.duration; if (Number.isFinite(d)) setDuration(d); };
    const onEnd = () => { setPlaying(false); setControlsVisible(true); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVol = () => setMuted(v.muted);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onDur);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("ended", onEnd);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("volumechange", onVol);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onDur);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("ended", onEnd);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("volumechange", onVol);
    };
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const armHide = () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 2500);
  };
  const showControls = () => { setControlsVisible(true); armHide(); };

  useEffect(() => {
    if (playing) armHide();
    else setControlsVisible(true);
  }, [playing]);

  const toggle = async () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.pause();
    else { try { await v.play(); } catch {} }
  };

  const seek = (clientX: number) => {
    const el = trackRef.current;
    const v = videoRef.current;
    if (!el || !v || !duration) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = ratio * duration;
    setCurrent(v.currentTime);
  };

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  };

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) await el.requestFullscreen().catch(() => {});
    else await document.exitFullscreen().catch(() => {});
  };

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className={cn(
        "group relative flex items-center justify-center bg-black",
        fullscreen ? "h-screen w-screen" : "overflow-hidden rounded-lg",
        className,
      )}
      onMouseMove={showControls}
      onMouseLeave={() => playing && setControlsVisible(false)}
      onClick={e => { if (e.target === e.currentTarget) toggle(); }}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        playsInline
        className={cn(
          "block",
          fullscreen ? "h-full w-full object-contain" : "max-h-[92vh] max-w-full",
        )}
        onClick={toggle}
      />

      {!playing && (
        <button
          type="button"
          onClick={toggle}
          className="absolute inset-0 flex items-center justify-center bg-black/10 transition hover:bg-black/20"
          aria-label="Tocar"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/60 text-white shadow-2xl backdrop-blur-sm transition hover:scale-110">
            <Play className="h-7 w-7 translate-x-[2px]" />
          </span>
        </button>
      )}

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-10 flex items-center gap-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-3 pt-8 transition-opacity duration-200",
          controlsVisible ? "opacity-100" : "opacity-0",
        )}
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={toggle}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
          aria-label={playing ? "Pausar" : "Tocar"}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            ref={trackRef}
            onMouseDown={e => seek(e.clientX)}
            onClick={e => { e.stopPropagation(); seek(e.clientX); }}
            className="group/track relative h-1.5 w-full cursor-pointer overflow-visible rounded-full bg-white/25"
          >
            <div className="absolute left-0 top-0 h-full rounded-full bg-white" style={{ width: `${progress}%` }} />
            <div
              className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white opacity-0 shadow group-hover/track:opacity-100"
              style={{ left: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] font-medium text-white/85">
            <span>{formatTime(current)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={cycleSpeed}
          className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold uppercase text-white backdrop-blur transition hover:bg-white/25"
          title="Velocidade"
        >
          {speed}x
        </button>

        <button
          type="button"
          onClick={toggleMute}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
          aria-label={muted ? "Reativar som" : "Mutar"}
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={toggleFullscreen}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
          aria-label={fullscreen ? "Sair tela cheia" : "Tela cheia"}
        >
          {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
