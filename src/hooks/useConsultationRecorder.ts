import { useCallback, useEffect, useRef, useState } from "react";
import { saveChunk, clearSession } from "@/lib/recording-store";

export type RecorderState = "parado" | "gravando" | "pausado";

// Cada 5s o MediaRecorder entrega um pedaço, que vai direto para o IndexedDB.
// Intervalo menor multiplica escritas sem ganho real; maior aumenta o que se
// perde num crash.
const TIMESLICE_MS = 5000;
// 32 kbps mono deixa 1h de consulta em ~14 MB. Voz em ambiente fechado não
// ganha nada acima disso, e o arquivo ainda é comprimido no servidor antes de
// ir para a transcrição.
const AUDIO_BITRATE = 32000;

function escolherMimeType() {
  // Mesma cascata usada no gravador de áudio das conversas.
  const candidatos = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  for (const tipo of candidatos) {
    if (MediaRecorder.isTypeSupported(tipo)) return tipo;
  }
  return "";
}

export type GravacaoPronta = {
  blob: Blob;
  file: File;
  durationSec: number;
  sessionId: string;
};

export function useConsultationRecorder() {
  const [state, setState] = useState<RecorderState>("parado");
  const [seconds, setSeconds] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sessionIdRef = useRef<string>("");
  const mimeRef = useRef<string>("");
  // Tempo gravado é acumulado por trecho: durante a pausa o relógio não corre,
  // então um Date.now() - início contaria a pausa como consulta.
  const acumuladoRef = useRef(0);
  const inicioTrechoRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const canceladoRef = useRef(false);
  const resolveRef = useRef<((r: GravacaoPronta | null) => void) | null>(null);

  const decorrido = useCallback(() => {
    const emAndamento = inicioTrechoRef.current ? Date.now() - inicioTrechoRef.current : 0;
    return Math.floor((acumuladoRef.current + emAndamento) / 1000);
  }, []);

  const pararTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    setError(null);
    try {
      const midia = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mimeType = escolherMimeType();
      const recorder = new MediaRecorder(midia, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: AUDIO_BITRATE,
      });

      const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessionIdRef.current = sessionId;
      mimeRef.current = mimeType || "audio/webm";
      chunksRef.current = [];
      acumuladoRef.current = 0;
      canceladoRef.current = false;

      recorder.ondataavailable = e => {
        if (!e.data || e.data.size === 0) return;
        const index = chunksRef.current.length;
        chunksRef.current.push(e.data);
        // Falha de escrita não pode derrubar a gravação: o áudio continua na
        // memória, só perde a rede de segurança.
        saveChunk(sessionId, index, e.data, {
          startedAt: Date.now() - acumuladoRef.current,
          updatedAt: Date.now(),
          mimeType: mimeRef.current,
          durationSec: decorrido(),
        }).catch(err => console.warn("[recorder] falha ao salvar pedaço", err));
      };

      recorder.onstop = () => {
        midia.getTracks().forEach(t => t.stop());
        pararTimer();
        inicioTrechoRef.current = 0;
        const duracao = Math.floor(acumuladoRef.current / 1000);
        const pedacos = chunksRef.current;
        const cancelado = canceladoRef.current;

        recorderRef.current = null;
        setState("parado");
        setStream(null);
        setSeconds(0);

        const resolver = resolveRef.current;
        resolveRef.current = null;
        if (cancelado || pedacos.length === 0) {
          clearSession(sessionId).catch(() => {});
          resolver?.(null);
          return;
        }
        const blob = new Blob(pedacos, { type: mimeRef.current });
        const ext = mimeRef.current.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `consulta-${Date.now()}.${ext}`, { type: blob.type });
        resolver?.({ blob, file, durationSec: duracao, sessionId });
      };

      recorderRef.current = recorder;
      inicioTrechoRef.current = Date.now();
      setStream(midia);
      setState("gravando");
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds(decorrido()), 250);
      recorder.start(TIMESLICE_MS);
    } catch (err) {
      const msg = (err as Error).message || String(err);
      setError(`Não foi possível acessar o microfone: ${msg}`);
      throw err;
    }
  }, [decorrido]);

  const pause = useCallback(() => {
    const r = recorderRef.current;
    if (!r || r.state !== "recording") return;
    r.pause();
    acumuladoRef.current += Date.now() - inicioTrechoRef.current;
    inicioTrechoRef.current = 0;
    pararTimer();
    setSeconds(Math.floor(acumuladoRef.current / 1000));
    setState("pausado");
  }, []);

  const resume = useCallback(() => {
    const r = recorderRef.current;
    if (!r || r.state !== "paused") return;
    r.resume();
    inicioTrechoRef.current = Date.now();
    timerRef.current = window.setInterval(() => setSeconds(decorrido()), 250);
    setState("gravando");
  }, [decorrido]);

  /** Para a gravação e resolve com o arquivo. `null` quando foi cancelada. */
  const stop = useCallback((cancelar = false): Promise<GravacaoPronta | null> => {
    const r = recorderRef.current;
    if (!r) return Promise.resolve(null);
    canceladoRef.current = cancelar;
    if (inicioTrechoRef.current) {
      acumuladoRef.current += Date.now() - inicioTrechoRef.current;
      inicioTrechoRef.current = 0;
    }
    return new Promise(resolve => {
      resolveRef.current = resolve;
      if (r.state !== "inactive") r.stop();
      else resolve(null);
    });
  }, []);

  // Aviso do navegador ao tentar sair no meio de uma consulta. O texto é
  // ignorado pelos navegadores modernos, mas o diálogo aparece.
  useEffect(() => {
    if (state === "parado") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state]);

  useEffect(() => () => {
    pararTimer();
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      canceladoRef.current = true;
      r.stop();
    }
  }, []);

  return { state, seconds, stream, error, start, pause, resume, stop };
}
