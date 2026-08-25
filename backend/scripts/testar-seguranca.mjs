#!/usr/bin/env node
/**
 * Bateria de segurança ponta a ponta, contra o servidor EM EXECUÇÃO.
 *
 * A suíte de `npm test` cobre as funções isoladamente. Isto aqui é o outro
 * lado: exercita a aplicação de verdade — HTTP real, cookies reais, socket
 * real, banco real — porque foi exatamente aí que os problemas moravam. Várias
 * das falhas encontradas na auditoria (secretária lendo prontuário, QR
 * acessível a quem só tinha leitura, `io.emit` global vazando a agenda) passavam
 * despercebidas em teste unitário: cada peça estava certa, o encaixe é que não.
 *
 * Cria três usuários temporários (`zz-teste-*`) e os remove no fim. NÃO envia
 * nenhuma mensagem por WhatsApp.
 *
 * Uso:
 *   1. suba o backend        (npm start)
 *   2. node scripts/testar-seguranca.mjs
 */
import { io as conectarSocket } from "socket.io-client";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";
import { connectMongo, closeMongo, getCol } from "../src/storage/mongo.js";
import { hashPassword } from "../src/lib/password.js";

const API = process.env.TESTE_API || "http://127.0.0.1:3030";
const ORIGEM = config.corsOrigin;
const SENHA = "TesteSeguranca!" + Math.random().toString(36).slice(2, 10);
const PREFIXO = "zz-teste-";

let ok = 0, falhou = 0;
const linhas = [];
const checar = (nome, cond, detalhe = "") => {
  if (cond) { ok++; linhas.push(`  ok    ${nome}${detalhe ? "   " + detalhe : ""}`); }
  else { falhou++; linhas.push(`  FALHA ${nome}${detalhe ? "   " + detalhe : ""}`); }
};
const secao = t => linhas.push(`\n${t}`);
const esperar = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- sessão HTTP
function novaSessao() {
  const jar = new Map();
  return {
    jar,
    cookieHeader() { return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "); },
    csrf() { return jar.get("crm_csrf"); },
    async req(caminho, { method = "GET", body, semCsrf = false, raw } = {}) {
      const headers = raw ? {} : { "Content-Type": "application/json" };
      const ck = this.cookieHeader();
      if (ck) headers.Cookie = ck;
      if (!semCsrf && this.csrf()) headers["X-CSRF-Token"] = this.csrf();
      const res = await fetch(API + caminho, {
        method,
        headers,
        body: raw !== undefined ? raw : (body ? JSON.stringify(body) : undefined),
      });
      for (const sc of res.headers.getSetCookie?.() || []) {
        const [par] = sc.split(";");
        const i = par.indexOf("=");
        const nome = par.slice(0, i).trim();
        const val = par.slice(i + 1).trim();
        if (val === "") jar.delete(nome); else jar.set(nome, val);
      }
      const texto = await res.text();
      let corpo; try { corpo = JSON.parse(texto); } catch { corpo = texto; }
      return { status: res.status, corpo, headers: res.headers };
    },
  };
}

async function entrar(username) {
  const s = novaSessao();
  const r = await s.req("/api/auth/login", { method: "POST", body: { identifier: username, password: SENHA } });
  if (r.status !== 200) throw new Error(`login de ${username} falhou: ${r.status}`);
  return s;
}

function abrirSocket(cookie) {
  return new Promise((resolve, reject) => {
    const s = conectarSocket(API, {
      transports: ["polling", "websocket"],
      // Origin legítima: o servidor só aceita config.corsOrigin, e sem isto o
      // próprio CORS (corretamente) recusa o handshake.
      extraHeaders: { Origin: ORIGEM, ...(cookie ? { Cookie: cookie } : {}) },
      reconnection: false,
      timeout: 6000,
    });
    const t = setTimeout(() => { s.close(); reject(new Error("timeout")); }, 8000);
    s.on("connect", () => { clearTimeout(t); resolve(s); });
    s.on("connect_error", e => { clearTimeout(t); s.close(); reject(e); });
  });
}

// --------------------------------------------------------------- preparação
async function criarUsuarios() {
  await connectMongo();
  const col = getCol("users");
  for (const [sufixo, role] of [["admin", "admin"], ["doutor", "doutor"], ["secre", "secretaria"]]) {
    const id = PREFIXO + sufixo;
    const cred = await hashPassword(SENHA);
    await col.updateOne({ _id: id }, {
      $set: {
        _id: id, id, name: "TESTE " + role, username: id, email: `${id}@teste.local`,
        role, active: true, avatar: "", allowedTags: [], allowedConversationIds: [],
        allowedInstanceIds: [], receivesNewLeads: false,
        passwordHash: cred.passwordHash, passwordSalt: cred.passwordSalt,
      },
    }, { upsert: true });
  }
}

async function removerUsuarios() {
  try {
    await getCol("users").deleteMany({ _id: { $regex: `^${PREFIXO}` } });
    await getCol("auditoria").deleteMany({ usuarioId: { $regex: `^${PREFIXO}` } });
  } catch { /* banco já fechado */ }
  await closeMongo().catch(() => {});
}

// -------------------------------------------------------------------- testes
async function main() {
  await criarUsuarios();

  const admin = await entrar(PREFIXO + "admin");
  const doutor = await entrar(PREFIXO + "doutor");
  const secre = await entrar(PREFIXO + "secre");

  // ---- 1. Sessão -----------------------------------------------------------
  secao("1. AUTENTICAÇÃO");
  checar("login emite cookie de sessão", Boolean(admin.jar.get("crm_token")));
  checar("login emite cookie CSRF", Boolean(admin.csrf()));
  checar("GET /me devolve o usuário", (await admin.req("/api/auth/me")).corpo.user?.role === "admin");

  // O segredo "queijo" era o fallback embutido E o valor commitado no .env:
  // forjar um cookie de admin era uma linha de shell.
  const forjado = novaSessao();
  forjado.jar.set("crm_token",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc4NzU5ODE1MiwiZXhwIjoxNzg3NjI2OTUyfQ.vtRbo0vswDWfl6Sfq-ADH7dyPj4SjDJ1Xpn7okBSkAQ");
  checar("token forjado com o segredo publicado é rejeitado", (await forjado.req("/api/auth/me")).status === 401);
  checar("senha errada devolve 401",
    (await novaSessao().req("/api/auth/login", { method: "POST", body: { identifier: PREFIXO + "admin", password: "errada" } })).status === 401);

  // ---- 2. CSRF -------------------------------------------------------------
  secao("2. CSRF");
  const semCsrf = await admin.req("/api/tags", { method: "POST", body: { name: PREFIXO + "tag" }, semCsrf: true });
  checar("POST sem header CSRF é bloqueado", semCsrf.status === 403, `(${semCsrf.status})`);
  checar("POST com header CSRF passa", (await admin.req("/api/tags", { method: "POST", body: { name: PREFIXO + "tag" } })).status === 201);
  checar("GET não exige CSRF", (await admin.req("/api/tags", { semCsrf: true })).status === 200);

  // ---- 3. Cargos -----------------------------------------------------------
  // src/lib/roles.ts já mantinha essas telas fora do alcance da secretária, mas
  // o backend só exigia "estar logado" — bloqueio de interface, não de permissão.
  secao("3. MATRIZ DE CARGO");
  for (const [rota, quem, sessao, esperado] of [
    ["/api/consultations", "secretária", secre, 403],
    ["/api/prontuarios", "secretária", secre, 403],
    ["/api/campaigns", "secretária", secre, 403],
    ["/api/consultations", "doutor", doutor, 200],
    ["/api/prontuarios", "doutor", doutor, 200],
    ["/api/campaigns", "doutor", doutor, 403],
    ["/api/consultations", "admin", admin, 200],
    ["/api/campaigns", "admin", admin, 200],
  ]) {
    const r = await sessao.req(rota);
    checar(`${rota} como ${quem} → ${esperado}`, r.status === esperado, `(recebeu ${r.status})`);
  }
  checar("secretária não extrai a base de telefones",
    (await secre.req("/api/campaigns/preview", { method: "POST", body: { limit: 5000 } })).status === 403);
  checar("secretária não usa a chave OpenAI da empresa",
    (await secre.req("/api/agents/test", { method: "POST", body: { userMessage: "oi" } })).status === 403);
  checar("secretária não apaga o rastro de consumo",
    (await secre.req("/api/agents/usage/x", { method: "DELETE" })).status === 403);

  // ---- 4. Instância --------------------------------------------------------
  secao("4. SEQUESTRO DE INSTÂNCIA");
  const insts = await admin.req("/api/instances");
  const inst = Array.isArray(insts.corpo) ? insts.corpo[0] : null;
  if (!inst) linhas.push("  --    nenhuma instância cadastrada");
  else {
    // Quem consegue o QR pareia o próprio celular na conta. Ver a instância
    // (para atender por ela) não pode dar esse direito.
    checar("quem só tem leitura não pega o QR",
      [403, 404].includes((await doutor.req(`/api/instances/${inst.id}/qr`)).status));
    checar("quem só tem leitura não pega o código de pareamento",
      [403, 404].includes((await doutor.req(`/api/instances/${inst.id}/pairing-code`)).status));
  }

  // ---- 5. Volume -----------------------------------------------------------
  secao("5. VOLUME E ROBUSTEZ");
  // "?limit=abc" virava NaN, chegava no Mongo e a exceção derrubava o PROCESSO.
  const limitRuim = await admin.req("/api/conversations?limit=abc");
  checar("?limit=abc não derruba o servidor", limitRuim.status === 200, `(${limitRuim.status})`);
  checar("servidor vivo depois", (await fetch(API + "/health").then(r => r.json())).ok === true);
  const limitAbsurdo = await admin.req("/api/conversations?limit=99999999");
  checar("?limit absurdo é limitado", limitAbsurdo.corpo.length <= 2000, `(${limitAbsurdo.corpo.length} itens)`);

  const p1 = await admin.req("/api/conversations?limit=5");
  const p2 = await admin.req("/api/conversations?limit=5&offset=5");
  checar("paginação respeita o limite", p1.corpo.length <= 5, `(${p1.corpo.length})`);
  checar("página 2 não repete a 1", !p1.corpo.some(a => p2.corpo.some(b => b.id === a.id)));

  const ativas = await admin.req("/api/conversations?limit=2000");
  const arquivadas = await admin.req("/api/conversations?archived=true&limit=2000");
  const idsAtivas = new Set(ativas.corpo.map(c => c.id));
  checar("arquivadas não vazam para a lista ativa", !arquivadas.corpo.some(c => idsAtivas.has(c.id)),
    `(${ativas.corpo.length} ativas / ${arquivadas.corpo.length} arquivadas)`);

  checar("endpoint de overlays de CRM responde", (await admin.req("/api/conversations/crm-overlays")).status === 200);

  // A busca virou consulta no banco; o termo do usuário precisa ser texto
  // literal, senão "(a+)+$" trava o MongoDB.
  const alvo = ativas.corpo.find(c => c.customer?.length > 3);
  if (alvo) {
    const termo = alvo.customer.slice(0, 4);
    const b = await admin.req(`/api/conversations?q=${encodeURIComponent(termo)}`);
    checar("busca no servidor encontra o contato", b.corpo.some(c => c.id === alvo.id), `termo="${termo}"`);
  }
  checar("busca com padrão catastrófico não trava (ReDoS)",
    (await admin.req(`/api/conversations?q=${encodeURIComponent("(a+)+$")}`)).status === 200);

  // paginação de mensagens (o "carregar mais" do histórico)
  const conv = ativas.corpo[0];
  if (conv) {
    const m1 = await admin.req(`/api/conversations/${encodeURIComponent(conv.id)}/messages?limit=10`);
    checar("mensagens vêm em ordem cronológica",
      m1.corpo.every((m, i) => i === 0 || m.timestamp >= m1.corpo[i - 1].timestamp));
    if (m1.corpo.length >= 2) {
      const ancora = m1.corpo[0];
      const m2 = await admin.req(`/api/conversations/${encodeURIComponent(conv.id)}/messages?limit=10&before=${ancora.timestamp}`);
      checar("página anterior via ?before é mais antiga",
        m2.corpo.every(m => m.timestamp < ancora.timestamp), `(${m2.corpo.length} msgs)`);
    }
    const teto = await admin.req(`/api/conversations/${encodeURIComponent(conv.id)}/messages?limit=99999`);
    checar("limite de mensagens é limitado ao teto", teto.corpo.length <= 200, `(${teto.corpo.length})`);
  }

  // ---- 6. Mídia ------------------------------------------------------------
  secao("6. MÍDIA");
  // Um contato mandava um anexo .html; ele era salvo com essa extensão e
  // servido como text/html por uma rota pública, na MESMA origem do cookie de
  // sessão. O atendente clicava e perdia a sessão.
  const perigoso = path.join(config.paths.mediaDir, PREFIXO + "xss.html");
  await fs.mkdir(config.paths.mediaDir, { recursive: true });
  await fs.writeFile(perigoso, "<script>fetch('/api/users')</script>");
  try {
    const r = await fetch(`${API}/api/media/${PREFIXO}xss.html`);
    checar("HTML não é servido como text/html", r.headers.get("content-type") === "application/octet-stream",
      `(${r.headers.get("content-type")})`);
    checar("HTML força download", (r.headers.get("content-disposition") || "").startsWith("attachment"));
    checar("mídia vai com nosniff", r.headers.get("x-content-type-options") === "nosniff");
    checar("mídia vai com CSP sandbox", (r.headers.get("content-security-policy") || "").includes("sandbox"));
  } finally {
    await fs.unlink(perigoso).catch(() => {});
  }
  checar("path traversal é recusado",
    [400, 404].includes((await fetch(API + "/api/media/..%2F..%2F..%2Fpackage.json")).status));

  // mídia legítima precisa continuar abrindo inline
  const avatar = ativas.corpo.find(c => c.avatarUrl)?.avatarUrl;
  if (avatar) {
    const r = await fetch(API + avatar);
    checar("imagem legítima continua inline",
      r.status === 200 && (r.headers.get("content-type") || "").startsWith("image/") && !r.headers.get("content-disposition"));
    const rr = await fetch(API + avatar, { headers: { Range: "bytes=0-99" } });
    checar("Range request (seek de áudio/vídeo) funciona", rr.status === 206);
    checar("Range malformado devolve 416, não crash",
      (await fetch(API + avatar, { headers: { Range: "bytes=xyz" } })).status === 416);
  }

  // ---- 7. IDOR -------------------------------------------------------------
  secao("7. IDOR");
  const deals = await admin.req("/api/deals");
  const deal = Array.isArray(deals.corpo) ? deals.corpo[0] : null;
  if (deal) {
    checar("doutor não edita card alheio",
      (await doutor.req(`/api/deals/${encodeURIComponent(deal.id)}`, { method: "PATCH", body: { customer: "invadido" } })).status === 403);
  }
  const ag = await admin.req("/api/appointments");
  const compromisso = Array.isArray(ag.corpo) ? ag.corpo[0] : null;
  if (compromisso) {
    // PATCH e DELETE de agenda não tinham checagem NENHUMA.
    checar("doutor não remarca compromisso alheio",
      (await doutor.req(`/api/appointments/${encodeURIComponent(compromisso.id)}`, { method: "PATCH", body: { date: "2030-01-01" } })).status === 403);
    checar("doutor não apaga compromisso alheio",
      (await doutor.req(`/api/appointments/${encodeURIComponent(compromisso.id)}`, { method: "DELETE" })).status === 403);
  }
  checar("doutor não limpa agenda de card que não enxerga",
    (await doutor.req("/api/appointments/by-deal/qualquer", { method: "DELETE" })).status === 403);

  // ---- 8. Exposição --------------------------------------------------------
  secao("8. EXPOSIÇÃO DE DADOS");
  const equipeSecre = await secre.req("/api/users");
  checar("secretária não recebe e-mail da equipe", !(equipeSecre.corpo || []).some(u => u.email));
  checar("secretária não recebe telefone da equipe", !(equipeSecre.corpo || []).some(u => u.phone));
  checar("admin continua recebendo o cadastro completo",
    (await admin.req("/api/users")).corpo.some(u => "email" in u));

  // ---- 9. Cabeçalhos -------------------------------------------------------
  secao("9. CABEÇALHOS");
  const h = (await fetch(API + "/health")).headers;
  checar("CSP presente", Boolean(h.get("content-security-policy")));
  checar("nosniff presente", h.get("x-content-type-options") === "nosniff");
  checar("frame-ancestors none", (h.get("content-security-policy") || "").includes("frame-ancestors 'none'"));
  checar("X-Powered-By removido", !h.get("x-powered-by"));
  const corsMau = await fetch(API + "/health", { headers: { Origin: "https://site-malicioso.com" } });
  checar("CORS não ecoa origem desconhecida",
    corsMau.headers.get("access-control-allow-origin") !== "https://site-malicioso.com");

  // ---- 10. Erros -----------------------------------------------------------
  secao("10. TRATAMENTO DE ERRO");
  const r404 = await admin.req("/api/rota-que-nao-existe");
  checar("rota inexistente devolve JSON", r404.status === 404 && r404.corpo.code === "ROTA_INEXISTENTE");
  const jsonRuim = await admin.req("/api/tags", { method: "POST", raw: "{ isso nao e json" });
  checar("JSON malformado devolve 400, não crash", jsonRuim.status === 400, `(${jsonRuim.status})`);

  // ---- 11. Socket ----------------------------------------------------------
  secao("11. SOCKET");
  let recusouAnonimo = false;
  try { (await abrirSocket(null)).close(); } catch { recusouAnonimo = true; }
  checar("socket sem cookie é recusado", recusouAnonimo);

  const sAdmin = await abrirSocket(admin.cookieHeader());
  const sDoutor = await abrirSocket(doutor.cookieHeader());
  checar("socket com sessão válida conecta", sAdmin.connected && sDoutor.connected);

  let doutorRecebeu = false, adminRecebeu = false;
  sDoutor.on("conversation:update", () => { doutorRecebeu = true; });
  sAdmin.on("conversation:update", () => { adminRecebeu = true; });
  if (inst) sDoutor.emit("join", inst.id); // tentativa de forçar entrada na sala
  await esperar(500);

  if (conv) {
    await admin.req(`/api/conversations/${encodeURIComponent(conv.id)}/crm`, { method: "PATCH", body: { notes: PREFIXO + "socket" } });
    await esperar(1200);
    checar("quem tem acesso RECEBE o evento", adminRecebeu);
    checar("quem não tem acesso NÃO recebe o evento", !doutorRecebeu);
    await admin.req(`/api/conversations/${encodeURIComponent(conv.id)}/crm`, { method: "PATCH", body: { notes: null } });
  }

  // A permissão era resolvida uma vez, no handshake: revogar acesso não tinha
  // efeito sobre o tráfego em tempo real até a pessoa recarregar a página.
  let doutorCaiu = false;
  sDoutor.on("disconnect", () => { doutorCaiu = true; });
  await admin.req(`/api/users/${PREFIXO}doutor`, { method: "PATCH", body: { active: false } });
  await esperar(1500);
  checar("socket de usuário desativado é derrubado", doutorCaiu);
  checar("sessão HTTP do desativado é rejeitada", (await doutor.req("/api/auth/me")).status === 401);

  sAdmin.close();
  sDoutor.close();

  // limpeza
  await admin.req(`/api/tags/${encodeURIComponent(PREFIXO + "tag")}`, { method: "DELETE" });

  console.log(linhas.join("\n"));
  console.log(`\n${"=".repeat(64)}`);
  console.log(falhou ? `RESULTADO: ${ok} ok, ${falhou} FALHA(S)` : `RESULTADO: ${ok} verificações, todas ok`);
  console.log("=".repeat(64));
  return falhou;
}

let saida = 2;
try {
  saida = await main();
} catch (err) {
  console.log(linhas.join("\n"));
  console.error("\nERRO NA BATERIA:", err.message);
  if (/ECONNREFUSED|fetch failed/.test(err.message)) {
    console.error("O backend está rodando? Suba com `npm start` antes.");
  }
} finally {
  await removerUsuarios();
}
process.exit(saida ? 1 : 0);
