// O motor de variáveis de mensagem é COMPARTILHADO com o backend (o disparo de
// campanha renderiza {{nome}}/{{saudacao}} exatamente igual). Ele mora em
// /shared para que empacotar o backend sozinho — container, deploy separado —
// não dependa da árvore do frontend estar presente.
//
// Antes, backend/src/whatsapp/campaign-sender.js importava
// "../../../src/lib/message-template.js": um `COPY backend/` no Dockerfile
// quebrava o envio de campanha.
export * from "../../shared/message-template.js";
