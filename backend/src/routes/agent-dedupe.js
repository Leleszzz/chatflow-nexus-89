// Proteção contra o agente responder duas vezes a mesma conversa.
//
// O gatilho da resposta automática mora no NAVEGADOR (useAgentAutoReply): ele
// escuta message:new e chama POST /api/agents/respond, que é quem de fato envia
// a mensagem no WhatsApp. As travas do hook (inFlight/processed/debounce) são
// estado em memória DE CADA ABA — duas abas abertas, ou um reload no meio do
// debounce, disparam dois /respond para a mesma conversa e o cliente recebe
// duas respostas. A trava precisa estar no backend, o único ponto comum.
//
// São duas situações distintas, e cada uma precisa da sua trava:
//   1. concorrente  — as duas chamadas se sobrepõem no tempo  -> lock
//   2. sequencial   — a segunda começa depois da primeira terminar -> histórico

// Conversas com resposta sendo gerada agora ("instanceId::chatId").
// Vive no processo: o backend é único, então isto basta.
const respondLocks = new Set();

export const respondLockKey = (instanceId, chatId) => `${instanceId}::${chatId}`;

/** Tenta reservar a conversa. `false` = já existe uma resposta em andamento. */
export function acquireRespondLock(key) {
  if (respondLocks.has(key)) return false;
  respondLocks.add(key);
  return true;
}

export function releaseRespondLock(key) {
  respondLocks.delete(key);
}

/** Só para teste — o estado é global ao processo. */
export function _resetRespondLocks() {
  respondLocks.clear();
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
