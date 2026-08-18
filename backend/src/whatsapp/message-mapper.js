function formatPhone(number) {
  if (!number) return "";
  const digits = String(number).replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    const cc = digits.slice(0, 2);
    const area = digits.slice(2, 4);
    const part1 = digits.slice(4, 9);
    const part2 = digits.slice(9);
    return `+${cc} ${area} ${part1}-${part2}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    const cc = digits.slice(0, 2);
    const area = digits.slice(2, 4);
    const part1 = digits.slice(4, 8);
    const part2 = digits.slice(8);
    return `+${cc} ${area} ${part1}-${part2}`;
  }
  return digits ? `+${digits}` : "";
}

export function buildConversationId(instanceId, chatId) {
  return `${instanceId}__${chatId}`;
}

// Telefone formatado a partir do JID, quando ele É um número (@s.whatsapp.net).
// Para @lid devolve "" — o WhatsApp não revela o número por trás do LID.
export function phoneFromChatId(chatId) {
  if (typeof chatId !== "string" || !chatId.endsWith("@s.whatsapp.net")) return "";
  const user = chatId.split("@")[0].split(":")[0];
  return /^\d{8,15}$/.test(user) ? formatPhone(user) : "";
}

function looksLikeJid(s) {
  return typeof s === "string" && /@(s\.whatsapp\.net|lid)$/.test(s);
}
function looksLikeRawDigits(s) {
  return typeof s === "string" && /^\d{8,}$/.test(s);
}
// Nome "provisório" (vazio, um JID ou só dígitos) que deve ser substituído por um melhor.
export function isPlaceholderName(s) {
  return !s || looksLikeJid(s) || looksLikeRawDigits(s);
}

// Melhor nome REAL entre vários registros de contato do mesmo número (o cadastro
// pode estar sob o @lid ou sob o @s.whatsapp.net). Ignora nomes provisórios.
export function bestName(contacts) {
  for (const c of contacts || []) {
    const name = c?.notify || c?.name || c?.verifiedName || c?.short;
    if (name && !isPlaceholderName(name)) return name;
  }
  return "";
}

export function jidIsGroup(jid) {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

export function jidIsUnsupported(jid) {
  if (!jid || typeof jid !== "string") return true;
  if (jidIsGroup(jid)) return true;
  if (jid.endsWith("@broadcast")) return true;
  if (jid.endsWith("@newsletter")) return true;
  if (jid === "status@broadcast") return true;
  return false;
}

function previewFor(message) {
  if (!message) return "";
  if (message.body) return message.body;
  switch (message.type) {
    case "contact": return "[contato]";
    case "image": return "[imagem]";
    case "audio":
    case "ptt": return "[áudio]";
    case "video": return message.isGif ? "[GIF]" : "[vídeo]";
    case "document": return "[documento]";
    case "sticker": return "[figurinha]";
    default: return "";
  }
}

function extractContent(msg) {
  let content = msg?.message || {};
  if (content.ephemeralMessage?.message) content = content.ephemeralMessage.message;
  if (content.viewOnceMessage?.message) content = content.viewOnceMessage.message;
  if (content.viewOnceMessageV2?.message) content = content.viewOnceMessageV2.message;
  if (content.documentWithCaptionMessage?.message) content = content.documentWithCaptionMessage.message;
  if (content.editedMessage?.message) content = content.editedMessage.message;
  return content;
}

// Corpo de uma edição vinda de messages.update (update.message =
// { editedMessage: { message: ... } }). Cobre texto e captions de mídia.
export function extractEditedBody(updateMessage) {
  return bodyOf(extractContent({ message: updateMessage }));
}

function messageTypeOf(content) {
  if (!content) return "chat";
  if (content.conversation || content.extendedTextMessage) return "chat";
  if (content.contactMessage || content.contactsArrayMessage) return "contact";
  if (content.imageMessage) return "image";
  if (content.videoMessage) return "video";
  if (content.audioMessage) return content.audioMessage.ptt ? "ptt" : "audio";
  if (content.documentMessage) return "document";
  if (content.stickerMessage) return "sticker";
  return "chat";
}

function bodyOf(content) {
  if (!content) return "";
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.contactMessage?.displayName ||
    content.contactsArrayMessage?.displayName ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ""
  );
}

// stanzaId da mensagem citada, presente no contextInfo de qualquer tipo de
// conteúdo (não só texto — respostas com mídia também carregam a citação).
function quotedIdOf(content) {
  if (!content) return undefined;
  const carriers = [
    content.extendedTextMessage, content.imageMessage, content.videoMessage,
    content.audioMessage, content.documentMessage, content.stickerMessage,
    content.contactMessage, content.contactsArrayMessage,
  ];
  for (const c of carriers) {
    const id = c?.contextInfo?.stanzaId;
    if (id) return id;
  }
  return undefined;
}

function phoneFromVcard(vcard) {
  if (!vcard || typeof vcard !== "string") return "";
  const telLine = vcard.split(/\r?\n/).find(line => /^TEL/i.test(line));
  if (!telLine) return "";
  return telLine.split(":").slice(1).join(":").replace(/\D/g, "");
}

function contactsOf(content) {
  if (!content) return [];
  if (content.contactMessage) {
    const c = content.contactMessage;
    return [{
      displayName: c.displayName || c.vcard?.match(/^FN:(.+)$/m)?.[1]?.trim() || "Contato",
      phone: phoneFromVcard(c.vcard),
      vcard: c.vcard || "",
    }];
  }
  if (content.contactsArrayMessage) {
    return (content.contactsArrayMessage.contacts || []).map(c => ({
      displayName: c.displayName || c.vcard?.match(/^FN:(.+)$/m)?.[1]?.trim() || "Contato",
      phone: phoneFromVcard(c.vcard),
      vcard: c.vcard || "",
    }));
  }
  return [];
}

export function isMediaMessage(msg) {
  const content = extractContent(msg);
  if (!content) return false;
  return Boolean(
    content.imageMessage ||
    content.videoMessage ||
    content.audioMessage ||
    content.documentMessage ||
    content.stickerMessage,
  );
}

export function isDisplayableMessage(msg) {
  const content = extractContent(msg);
  if (!content) return false;
  return Boolean(
    content.conversation ||
    content.extendedTextMessage ||
    content.contactMessage ||
    content.contactsArrayMessage ||
    content.imageMessage ||
    content.videoMessage ||
    content.audioMessage ||
    content.documentMessage ||
    content.stickerMessage,
  );
}

export function mapBaileysStatusToAck(status) {
  if (typeof status !== "number") return 0;
  if (status <= 1) return 0;       // ERROR, PENDING → relógio
  if (status === 2) return 1;      // SERVER_ACK → ✓
  if (status === 3) return 2;      // DELIVERY_ACK → ✓✓
  if (status === 4) return 3;      // READ → ✓✓ azul
  if (status === 5) return 4;      // PLAYED → played
  return 0;
}

export function ackForSentResult(status) {
  const ack = mapBaileysStatusToAck(status);
  return ack > 0 ? ack : 1;
}

export function mapMessage(msg, { instanceId, mediaUrl, mediaMime } = {}) {
  const content = extractContent(msg);
  const type = messageTypeOf(content);
  const body = bodyOf(content);
  const contacts = contactsOf(content);
  const isGif = Boolean(content.videoMessage?.gifPlayback);
  const ack = msg.key?.fromMe && typeof msg.status !== "number"
    ? 1
    : mapBaileysStatusToAck(msg.status);
  const ts = Number(msg.messageTimestamp);
  return {
    id: msg.key?.id || "",
    chatId: msg.key?.remoteJid || "",
    instanceId,
    fromMe: Boolean(msg.key?.fromMe),
    author: msg.key?.participant || msg.participant || msg.key?.remoteJid || "",
    type,
    isGif,
    body,
    contact: contacts[0] || undefined,
    contacts: contacts.length ? contacts : undefined,
    timestamp: Number.isFinite(ts) && ts > 0 ? ts : Math.floor(Date.now() / 1000),
    mediaUrl: mediaUrl || undefined,
    mediaMime: mediaMime || undefined,
    ack,
    quotedMsgId: quotedIdOf(content),
  };
}

function jidUser(jid) {
  if (!jid || typeof jid !== "string") return "";
  return jid.split("@")[0].split(":")[0];
}

function jidServer(jid) {
  if (!jid || typeof jid !== "string") return "";
  return jid.split("@")[1] || "";
}

function isLikelyPhone(digits) {
  return /^\d{8,15}$/.test(String(digits || ""));
}

export function resolveContactInfo(jid, contact) {
  let phoneNumber = "";
  let pushname = "";
  if (contact) {
    pushname = contact.notify || contact.name || contact.verifiedName || contact.short || "";
  }
  const server = jidServer(jid);
  const user = jidUser(jid);
  if (server === "s.whatsapp.net" && isLikelyPhone(user)) phoneNumber = user;
  return { phoneNumber, pushname };
}

export function mapChatFromBaileys({ jid, chatEntry, contact, instanceId, lastMessage } = {}) {
  const { phoneNumber, pushname } = resolveContactInfo(jid, contact);
  // Nome de exibição: apenas um nome REAL (pushname/contato). Nunca número cru
  // nem JID/LID — quando não há nome, fica vazio e o telefone formatado é exibido.
  const rawName = pushname || chatEntry?.name || chatEntry?.subject || "";
  const whatsappName = isPlaceholderName(rawName) ? "" : rawName;
  const customer = whatsappName;
  const tsCandidates = [
    Number(lastMessage?.timestamp),
    Number(chatEntry?.conversationTimestamp),
    Number(chatEntry?.t),
  ].filter(n => Number.isFinite(n) && n > 0);
  const ts = tsCandidates[0];
  return {
    id: buildConversationId(instanceId, jid),
    instanceId,
    chatId: jid,
    customer,
    whatsappName,
    phone: formatPhone(phoneNumber),
    isGroup: jidIsGroup(jid),
    lastMessage: previewFor(lastMessage) || "",
    lastInteraction: ts ? new Date(ts * 1000).toISOString() : "",
    unread: (chatEntry?.unreadCount || 0) > 0,
    unreadCount: chatEntry?.unreadCount || 0,
  };
}

export { formatPhone, previewFor };
