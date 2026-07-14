#!/usr/bin/env node
// Teste de conexão AO VIVO — deixe rodando ENQUANTO você pareia a instância.
//
// Valida em tempo real: autenticação das rotas, eventos de socket (QR → sem
// flash de "desconectada" → ativa), importação de conversas antigas conforme o
// modo escolhido (none/recent/full), mensagens ao vivo, acks (ticks), edição e
// exclusão de mensagens.
//
// Uso:
//   node scripts/test-connection.js --user admin --pass minhasenha
//   node scripts/test-connection.js --token <JWT> --instance wa-abc123
//   node scripts/test-connection.js --user admin --pass x --send-to 5511999999999
//
// Flags:
//   --url        Base da API (padrão: porta do config, http://localhost:3030)
//   --instance   Id da instância a observar (padrão: a única não-ativa, ou a única)
//   --user/--pass  Credenciais para login (ou --token com um JWT já emitido)
//   --send-to    Telefone (dígitos) para enviar uma mensagem de teste e validar ack
//   Encerrar: Ctrl+C — imprime o resumo final.

import { io as ioClient } from "socket.io-client";
import { config } from "../src/config.js";

const args = parseArgs(process.argv.slice(2));
const BASE = (args.url || process.env.API_URL || `http://localhost:${config.port}`).replace(/\/$/, "");

// ---------- checklist ----------
const ORDER = [];
const checks = new Map();
function check(id, label) {
  if (!checks.has(id)) { checks.set(id, { label, status: "pending", detail: "" }); ORDER.push(id); }
  return checks.get(id);
}
function setCheck(id, status, detail = "") {
  const c = checks.get(id);
  if (!c || c.status === "pass" || c.status === "fail") return; // primeiro veredito vence
  c.status = status; c.detail = detail;
  const icon = status === "pass" ? "\x1b[32m✓\x1b[0m" : status === "fail" ? "\x1b[31m✗\x1b[0m" : status === "skip" ? "\x1b[33m−\x1b[0m" : "…";
  console.log(`  [${icon}] ${c.label}${detail ? ` — ${detail}` : ""}`);
}
function summary() {
  console.log("\n================ RESUMO ================");
  let fails = 0;
  for (const id of ORDER) {
    const c = checks.get(id);
    const icon = c.status === "pass" ? "\x1b[32mPASS\x1b[0m" : c.status === "fail" ? "\x1b[31mFAIL\x1b[0m" : c.status === "skip" ? "\x1b[33mSKIP\x1b[0m" : "\x1b[36mPEND\x1b[0m";
    if (c.status === "fail") fails++;
    console.log(`  ${icon}  ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log("=========================================");
  if (fails) console.log(`\x1b[31m${fails} verificação(ões) FALHARAM.\x1b[0m`);
  else console.log("\x1b[32mNenhuma falha detectada.\x1b[0m (PEND = não exercitado nesta sessão)");
  return fails;
}

// Declara o checklist na ordem esperada do fluxo.
check("auth-required", "Rotas exigem autenticação (401 sem token)");
check("auth-ok", "Login/token aceito pela API");
check("socket", "Socket.io conectado e autenticado");
check("qr", "QR Code / código de pareamento emitido");
check("no-flash", "Sem flash de \"desconectada\" durante o pareamento (fix 515)");
check("ready", "Instância ficou ATIVA (instance:ready)");
check("history", "Conversas antigas importadas conforme o modo escolhido");
check("live-message", "Mensagem recebida ao vivo (message:new) — envie uma msg de outro celular");
check("ack", "Ack de entrega/leitura subiu (message:ack)");
check("edit", "Edição refletida (message:update edited) — edite uma msg no celular");
check("delete", "Exclusão refletida (message:update deleted) — apague uma msg \"para todos\"");

async function main() {
  console.log(`\nTeste de conexão — API ${BASE}`);
  console.log("Deixe este script rodando e faça o pareamento pela interface web.\n");

  // 1) Sem token deve dar 401.
  try {
    const r = await fetch(`${BASE}/api/instances`);
    if (r.status === 401) setCheck("auth-required", "pass");
    else setCheck("auth-required", "fail", `esperava 401, veio ${r.status}`);
  } catch (err) {
    console.error(`Não consegui falar com a API em ${BASE}: ${err.message}`);
    console.error("O backend está rodando? (cd backend && npm start)");
    process.exit(1);
  }

  // 2) Token: via --token ou login com --user/--pass.
  let token = args.token || process.env.TEST_TOKEN || "";
  if (!token) {
    const user = args.user || process.env.TEST_USER;
    const pass = args.pass || process.env.TEST_PASS;
    if (!user || !pass) {
      console.error("Informe --user e --pass (ou --token). Ex.: node scripts/test-connection.js --user admin --pass senha");
      process.exit(1);
    }
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: user, password: pass }),
    });
    if (!r.ok) { setCheck("auth-ok", "fail", `login falhou: ${r.status} ${await r.text()}`); process.exit(summary() ? 1 : 0); }
    token = (await r.json()).token;
  }
  const authed = (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });

  const instRes = await authed("/api/instances");
  if (!instRes.ok) { setCheck("auth-ok", "fail", `GET /api/instances: ${instRes.status}`); process.exit(summary() ? 1 : 0); }
  const instances = await instRes.json();
  setCheck("auth-ok", "pass");

  // 3) Escolhe a instância a observar.
  let instanceId = args.instance || "";
  if (!instanceId) {
    const candidates = instances.filter(i => i.status !== "ativa" && i.status !== "desligada");
    const pick = candidates.length === 1 ? candidates[0] : (instances.length === 1 ? instances[0] : null);
    if (!pick) {
      console.error("Várias instâncias encontradas — informe qual observar com --instance <id>:");
      for (const i of instances) console.error(`  ${i.id}  ${i.status.padEnd(14)} ${i.name}`);
      process.exit(1);
    }
    instanceId = pick.id;
  }
  const inst = instances.find(i => i.id === instanceId) || (await (await authed(`/api/instances/${instanceId}`)).json());
  const historyMode = inst?.fullHistoryRequested ? "full" : (inst?.historySync || "none");
  console.log(`Observando a instância ${instanceId} ("${inst?.name}") — modo de histórico: ${historyMode}`);
  if (inst?.status === "ativa") {
    console.log("(instância já está ativa — as checagens de pareamento ficarão PEND; para o teste completo crie uma instância nova)");
  }
  console.log("");

  // 4) Socket.io autenticado.
  const socket = ioClient(BASE, { path: "/socket.io", transports: ["websocket", "polling"], auth: { token } });
  let sawQr = false, sawReady = false, readyAt = 0;

  socket.on("connect", () => { setCheck("socket", "pass"); socket.emit("join", instanceId); });
  socket.on("connect_error", err => setCheck("socket", "fail", err.message));

  socket.on("instance:qr", p => { if (p.instanceId !== instanceId) return; sawQr = true; setCheck("qr", "pass", "QR emitido — escaneie pela interface"); });
  socket.on("instance:pairing-code", p => { if (p.instanceId !== instanceId) return; sawQr = true; setCheck("qr", "pass", `código: ${p.code}`); });

  socket.on("instance:status", p => {
    if (p.instanceId !== instanceId) return;
    console.log(`    status → ${p.status}`);
    // Janela do pareamento: do QR até 15s após o ready. Com o fix do 515 o
    // fechamento benigno mostra "conectando"; "desconectada" aqui é regressão.
    const inWindow = sawQr && (!sawReady || Date.now() - readyAt < 15_000);
    if (p.status === "desconectada" && inWindow) {
      setCheck("no-flash", "fail", "status \"desconectada\" apareceu durante o pareamento");
    }
  });

  socket.on("instance:ready", async p => {
    if (p.instanceId !== instanceId) return;
    sawReady = true; readyAt = Date.now();
    setCheck("ready", "pass", `conectado como ${p.phone}`);
    setTimeout(() => { if (checks.get("no-flash").status === "pending") setCheck("no-flash", "pass"); }, 16_000);
    watchHistory();
    if (args["send-to"]) sendTestMessage(String(args["send-to"]).replace(/\D/g, ""));
    else console.log("    (dica: use --send-to <ddi+ddd+numero> para validar envio + ack automaticamente)");
    console.log("    Agora: envie uma mensagem de OUTRO celular para este WhatsApp; depois edite-a e apague-a \"para todos\".");
  });

  socket.on("message:new", p => {
    if (p.conversation?.instanceId !== instanceId) return;
    if (!p.message?.fromMe) setCheck("live-message", "pass", `"${String(p.message?.body || p.message?.type).slice(0, 40)}"`);
  });
  socket.on("message:ack", p => { if (p.ack >= 2) setCheck("ack", "pass", `ack=${p.ack}`); });
  socket.on("message:update", p => {
    if (p.edited) setCheck("edit", "pass", `novo texto: "${String(p.body || "").slice(0, 40)}"`);
    if (p.deleted) setCheck("delete", "pass");
  });

  // 5) Histórico: após o ready, espera as conversas chegarem conforme o modo.
  async function watchHistory() {
    if (historyMode === "none") { setCheck("history", "skip", "modo \"none\" — sem importação por escolha"); return; }
    const deadline = Date.now() + (historyMode === "full" ? 10 * 60_000 : 3 * 60_000);
    while (Date.now() < deadline) {
      try {
        const convs = await (await authed(`/api/conversations?instanceId=${encodeURIComponent(instanceId)}`)).json();
        if (Array.isArray(convs) && convs.length > 0) {
          setCheck("history", "pass", `${convs.length} conversa(s) importada(s)`);
          return;
        }
      } catch { /* backend pode estar ocupado no sync */ }
      await new Promise(r => setTimeout(r, 5000));
    }
    setCheck("history", "fail", `nenhuma conversa importada em ${historyMode === "full" ? 10 : 3}min (modo ${historyMode})`);
  }

  // 6) Envio de teste + ack (opcional, --send-to).
  async function sendTestMessage(digits) {
    try {
      const conv = await (await authed("/api/conversations/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId, phone: digits }),
      })).json();
      const form = new FormData();
      form.append("chatId", conv.chatId);
      form.append("type", "text");
      form.append("body", `Teste de conexão ${new Date().toLocaleTimeString("pt-BR")} ✔`);
      const r = await authed(`/api/instances/${instanceId}/send`, { method: "POST", body: form });
      const out = await r.json();
      if (r.ok && out.messageId) console.log(`    mensagem de teste enviada para ${digits} (id ${out.messageId}) — aguardando ack...`);
      else setCheck("ack", "fail", `envio falhou: ${JSON.stringify(out)}`);
    } catch (err) {
      setCheck("ack", "fail", `envio falhou: ${err.message}`);
    }
  }

  console.log("Aguardando eventos... (Ctrl+C encerra e mostra o resumo)\n");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { out[key] = next; i++; }
      else out[key] = true;
    }
  }
  return out;
}

process.on("SIGINT", () => { const fails = summary(); process.exit(fails ? 1 : 0); });
main().catch(err => { console.error("Erro fatal:", err); process.exit(1); });
