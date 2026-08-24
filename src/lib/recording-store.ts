// Persistência dos pedaços da gravação em IndexedDB.
//
// Existe por um motivo só: uma consulta de 40 minutos vive inteira na memória
// da aba até o médico apertar "Parar". Um F5 sem querer, uma queda de energia
// ou um crash do navegador apagariam a consulta inteira, e não dá para pedir
// para o paciente repetir. Cada pedaço de 5s cai aqui assim que o MediaRecorder
// o entrega, e a página oferece a recuperação na próxima vez que abrir.
//
// IndexedDB puro, sem dependência nova — a API é feia, mas são ~4 operações.

const DB_NAME = "consulta-rec";
const DB_VERSION = 1;
const CHUNK_STORE = "chunks";
const SESSION_STORE = "sessions";

export type RecordingSession = {
  id: string;
  startedAt: number;
  updatedAt: number;
  mimeType: string;
  durationSec: number;
  chunkCount: number;
};

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        // Chave composta [sessionId, index] mantém os pedaços na ordem em que
        // foram gravados sem precisar de índice separado.
        db.createObjectStore(CHUNK_STORE, { keyPath: ["sessionId", "index"] });
      }
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function aguardar<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function fechar(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveChunk(sessionId: string, index: number, blob: Blob, meta: Omit<RecordingSession, "id" | "chunkCount">) {
  const db = await abrir();
  try {
    const tx = db.transaction([CHUNK_STORE, SESSION_STORE], "readwrite");
    tx.objectStore(CHUNK_STORE).put({ sessionId, index, blob });
    tx.objectStore(SESSION_STORE).put({ id: sessionId, chunkCount: index + 1, ...meta });
    await fechar(tx);
  } finally {
    db.close();
  }
}

export async function listSessions(): Promise<RecordingSession[]> {
  const db = await abrir();
  try {
    const tx = db.transaction(SESSION_STORE, "readonly");
    const all = await aguardar(tx.objectStore(SESSION_STORE).getAll() as IDBRequest<RecordingSession[]>);
    return (all || []).sort((a, b) => b.startedAt - a.startedAt);
  } finally {
    db.close();
  }
}

/** Remonta o áudio de uma sessão interrompida. Devolve null se não sobrou nada. */
export async function loadSession(sessionId: string): Promise<{ blob: Blob; session: RecordingSession } | null> {
  const db = await abrir();
  try {
    const tx = db.transaction([CHUNK_STORE, SESSION_STORE], "readonly");
    const session = await aguardar(tx.objectStore(SESSION_STORE).get(sessionId) as IDBRequest<RecordingSession | undefined>);
    if (!session) return null;
    const range = IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]);
    const rows = await aguardar(
      tx.objectStore(CHUNK_STORE).getAll(range) as IDBRequest<{ sessionId: string; index: number; blob: Blob }[]>,
    );
    if (!rows?.length) return null;
    rows.sort((a, b) => a.index - b.index);
    return { blob: new Blob(rows.map(r => r.blob), { type: session.mimeType }), session };
  } finally {
    db.close();
  }
}

export async function clearSession(sessionId: string) {
  const db = await abrir();
  try {
    const tx = db.transaction([CHUNK_STORE, SESSION_STORE], "readwrite");
    tx.objectStore(CHUNK_STORE).delete(IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]));
    tx.objectStore(SESSION_STORE).delete(sessionId);
    await fechar(tx);
  } finally {
    db.close();
  }
}

/**
 * Apaga sessões antigas demais para serem recuperáveis. Sem isto o IndexedDB do
 * navegador vira um cemitério de consultas descartadas ocupando centenas de MB.
 */
export async function pruneOldSessions(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const sessions = await listSessions();
  const limite = Date.now() - maxAgeMs;
  await Promise.all(sessions.filter(s => s.updatedAt < limite).map(s => clearSession(s.id)));
}
