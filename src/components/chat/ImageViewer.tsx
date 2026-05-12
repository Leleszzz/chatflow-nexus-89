import { useEffect, useRef, useState } from "react";
import { Download, Minus, Plus, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { VideoPlayer } from "./VideoPlayer";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

type Props = {
  src: string;
  alt?: string;
  kind?: "image" | "video";
  open: boolean;
  onClose: () => void;
};

export function ImageViewer({ src, alt = "midia", kind = "image", open, onClose }: Props) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const isVideo = kind === "video";

  useEffect(() => {
    if (open) {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [open, src]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (!isVideo && (e.key === "+" || e.key === "=")) setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP));
      else if (!isVideo && (e.key === "-" || e.key === "_")) setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP));
      else if (!isVideo && e.key === "0") { setZoom(1); setOffset({ x: 0, y: 0 }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, isVideo]);

  if (!open) return null;

  const onWheel = (e: React.WheelEvent) => {
    if (isVideo) return;
    e.preventDefault();
    setZoom(z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z - e.deltaY * 0.002)));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (isVideo || zoom <= 1) return;
    dragRef.current = { x: e.clientX, y: e.clientY, startX: offset.x, startY: offset.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setOffset({
      x: dragRef.current.startX + (e.clientX - dragRef.current.x),
      y: dragRef.current.startY + (e.clientY - dragRef.current.y),
    });
  };
  const onMouseUp = () => { dragRef.current = null; };

  const download = async () => {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = (blob.type.split("/")[1] || (isVideo ? "mp4" : "jpg")).split(";")[0];
      a.download = (alt && alt !== "midia" ? alt : (isVideo ? "video" : "imagem")) + `.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, "_blank");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
      onWheel={onWheel}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        {!isVideo && (
          <>
            <button
              onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
              title="Diminuir (-)"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[3.5rem] rounded-full bg-white/10 px-3 py-1 text-center text-xs font-semibold text-white backdrop-blur">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
              title="Ampliar (+)"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
              title="Resetar (0)"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </>
        )}
        <button
          onClick={download}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
          title="Baixar"
        >
          <Download className="h-4 w-4" />
        </button>
        <button
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
          title="Fechar (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        className={cn("relative max-h-screen max-w-[100vw] select-none", !isVideo && zoom > 1 && "cursor-grab")}
        style={{ cursor: dragRef.current ? "grabbing" : undefined }}
        onClick={e => e.stopPropagation()}
        onMouseDown={onMouseDown}
      >
        {isVideo ? (
          <VideoPlayer src={src} autoPlay className="max-w-[92vw] shadow-2xl" />
        ) : (
          <img
            src={src}
            alt={alt}
            draggable={false}
            className="max-h-[92vh] max-w-[92vw] rounded-lg shadow-2xl transition-transform duration-100"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              transformOrigin: "center",
            }}
          />
        )}
      </div>
    </div>
  );
}
