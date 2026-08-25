// Proteção contra o agente responder duas vezes a mesma conversa.
//
// São duas situações distintas, e cada uma precisa da sua trava:
//   1. concorrente  — as duas chamadas se sobrepõem no tempo  -> lock
//   2. sequencial   — a segunda começa depois da primeira terminar -> histórico
//
// O lock vivia num Set em memória, com o comentário "o backend é único, então
// isto basta". Isso amarrava o sistema a um único processo para sempre: subir
// uma segunda instância — ou um `pm2 cluster`, que é o jeito normal de
// aguentar mais carga — faria o cliente receber a resposta do agente
// duplicada, porque cada processo teria o seu próprio Set.
//
// Agora a trava é um documento no Mongo com _id determinístico e expiração
// automática. O `insertOne` é atômico: quem perder a corrida recebe erro de
// chave duplicada e desiste, valha isso entre duas abas ou entre dois
// servidores.

import { getCol, collections } from "../storage/mongo.js";

// Se o processo morrer no meio de uma geração, o TTL do Mongo solta a conversa
// sozinho. Sem isso, a conversa ficaria travada para sempre.
const TTL_SEGUNDOS = Number(process.env.AGENT_LOCK_TTL_S || 120);

const col = () => getCol(collections.agentLocks);

export const respondLockKey = (instanceId, chatId) => `${instanceId}::${chatId}`;

/** Tenta reservar a conversa. `false` = já existe uma resposta em andamento. */
export async function acquireRespondLock(key) {
  try {
    await col().insertOne({ _id: key, em: new Date() });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false; // outra aba/processo chegou primeiro
    // Banco indisponível não pode impedir o atendimento: segue sem a trava.
    console.warn(`[agent-dedupe] trava indisponível (${err.message}); seguindo sem ela`);
    return true;
  }
}

export async function releaseRespondLock(key) {
  try {
    await col().deleteOne({ _id: key });
  } catch (err) {
    // O TTL solta sozinho; não vale derrubar nada por causa disto.
    console.warn(`[agent-dedupe] liberar trava falhou: ${err.message}`);
  }
}

/** Índice de expiração. Chamado uma vez no boot, junto dos outros. */
export async function ensureAgentLockIndex() {
  await col().createIndex({ em: 1 }, { expireAfterSeconds: TTL_SEGUNDOS });
}

/** Só para teste. */
export async function _resetRespondLocks() {
  try { await col().deleteMany({}); } catch { /* banco pode não estar de pé */ }
}

/**
 * Se a mensagem mais recente da conversa já é nossa, não há o que responder:
 * ou o agente acabou de responder (outra aba, que terminou antes desta
 * começar), ou um humano assumiu a conversa. Nos dois casos, responder de novo
 * é errado — no segundo, seria o agente falando por cima do atendente.
 *
 * `listMessages` devolve em ordem cronológica, então o último é o mais recente.
 */
export function isAlreadyAnswered(history) {
  if (!Array.isArray(history) || history.length === 0) return false;
  return Boolean(history[history.length - 1]?.fromMe);
}
