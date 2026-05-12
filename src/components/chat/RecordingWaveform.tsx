import { useEffect, useRef } from "react";

const BAR_COUNT = 28;

type Props = {
  stream: MediaStream | null;
  className?: string;
  color?: string;
};

export function RecordingWaveform({ stream, className, color = "currentColor" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!stream) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    ctxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      analyser.getByteFrequencyData(data);
      const bins = data.length;
      const step = Math.max(1, Math.floor(bins / BAR_COUNT));
      const totalGap = (BAR_COUNT - 1) * 3;
      const barW = Math.max(1, (w - totalGap) / BAR_COUNT);
      const minH = 3;

      ctx.fillStyle = color;
      for (let i = 0; i < BAR_COUNT; i++) {
        const v = data[i * step] / 255;
        const barH = Math.max(minH, v * (h - 4));
        const x = i * (barW + 3);
        const y = (h - barH) / 2;
        ctx.beginPath();
        const r = Math.min(barW / 2, 2);
        ctx.roundRect(x, y, barW, barH, r);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try { source.disconnect(); } catch {}
      try { analyser.disconnect(); } catch {}
      audioCtx.close().catch(() => {});
      ctxRef.current = null;
    };
  }, [stream, color]);

  return <canvas ref={canvasRef} className={className} />;
}
