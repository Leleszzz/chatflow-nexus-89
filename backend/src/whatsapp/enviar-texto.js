// Enviar uma mensagem de texto por uma instância. Saiu de dentro do handler de
// POST /api/instances/:id/send quando o assistente do médico passou a precisar
// enviar sem passar por HTTP — a mesma lição de agent-service.js, que também
// nasceu preso a uma rota.
//
// Quem chama é responsável pela permissão: a rota usa requireInstanceAccess, o
// assistente usa userCanUseInstance antes de executar a proposta. A checagem
// não mora aqui porque os dois caminhos a fazem em momentos diferentes.

import { connectionManager } from "./ConnectionManager.js";
import { finalizeOutgoingMessage } from "./outgoing.js";
import { cancelDueToAgentReply } from "../storage/scheduled-messages-repo.js";
import { emitToInstance } from "../socket/events.js";
import { HttpError } from "../middleware/error-handler.js";

/**
 * Envia texto e devolve `{ messageId, timestamp }`.
 *
 * Lança `HttpError(404, ..., "INSTANCIA_OFFLINE")` quando a instância não está
 * conectada — é o caso comum (celular sem bateria, sessão caída) e o chamador
 * precisa distinguir dele de um erro de verdade.
 */
export async function enviarTexto({ io, instanceId, chatId, body, logLabel = "enviar-texto" }) {
  const texto = String(body ?? "").trim();
  if (!instanceId) throw new HttpError(400, "instanceId é obrigatório", "PARAMETRO_INVALIDO");
  if (!chatId) throw new HttpError(400, "chatId é obrigatório", "PARAMETRO_INVALIDO");
  if (!texto) throw new HttpError(400, "body é obrigatório para text", "PARAMETRO_INVALIDO");

  const client = connectionManager.get(instanceId);
  if (!client) throw new HttpError(404, "instância não conectada", "INSTANCIA_OFFLINE");

  const result = await client.sendMessage(chatId, { text: texto });

  const { messageId, timestamp } = await finalizeOutgoingMessage({
    io, client, instanceId, chatId, result, logLabel,
    message: { type: "chat", body: texto },
  });

  // Falar com o cliente cancela o que estava programado para ele: um lembrete
  // disparado logo depois de uma resposta humana soa como robô desatento.
  // Falha aqui não desfaz o envio — a mensagem já saiu.
  try {
    const cancelled = await cancelDueToAgentReply(instanceId, chatId);
    for (const sch of cancelled) emitToInstance(io, instanceId, "scheduled:update", { scheduled: sch });
  } catch (cancelErr) {
    console.warn(`[${logLabel}] cancel scheduled on agent reply failed: ${cancelErr.message}`);
  }

  return { messageId, timestamp };
}
