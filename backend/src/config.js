import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(BACKEND_ROOT, process.env.DATA_DIR || "./data");

const isProduction = process.env.NODE_ENV === "production";

// Falhar no boot é melhor que subir inseguro: um servidor fora do ar é um
// incidente visível, um servidor que aceita token forjado não é.
function abortar(mensagem, comoResolver) {
  console.error("\n[config] ERRO DE CONFIGURAÇÃO — o servidor não vai subir.\n");
  console.error(`  ${mensagem}\n`);
  if (comoResolver) console.error(`  Como resolver: ${comoResolver}\n`);
  process.exit(1);
}

// Segredo de assinatura da sessão. Sem padrão, de propósito — o antigo fallback
// ("queijo") estava no .env commitado, o que tornava qualquer sessão forjável.
const SEGREDO_MINIMO = 32;
const SEGREDOS_PROIBIDOS = new Set(["queijo", "secret", "changeme", "troque-me", "dev", "test"]);

function lerJwtSecret() {
  const raw = String(process.env.JWT_SECRET || "").trim();
  const sugestao = `defina JWT_SECRET no backend/.env. Gere um valor novo com:\n     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;

  if (!raw) abortar("JWT_SECRET não está definido.", sugestao);
  if (SEGREDOS_PROIBIDOS.has(raw.toLowerCase())) {
    abortar(`JWT_SECRET está com um valor conhecido/publicado ("${raw}").`, sugestao);
  }
  if (raw.length < SEGREDO_MINIMO) {
    abortar(`JWT_SECRET tem ${raw.length} caracteres; o mínimo é ${SEGREDO_MINIMO}.`, sugestao);
  }
  return raw;
}

const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:8080";
const cookieSecure = process.env.COOKIE_SECURE === "true";

if (isProduction) {
  if (/localhost|127\.0\.0\.1/.test(corsOrigin)) {
    abortar(
      `NODE_ENV=production com CORS_ORIGIN apontando para localhost ("${corsOrigin}").`,
      "defina CORS_ORIGIN com a origem pública real (ex.: https://crm.suaclinica.com.br).",
    );
  }
  if (!cookieSecure) {
    abortar(
      "NODE_ENV=production sem COOKIE_SECURE=true — o cookie de sessão trafegaria sem exigir HTTPS.",
      "defina COOKIE_SECURE=true no backend/.env.",
    );
  }
}

// Chave de cifragem em repouso das credenciais de terceiros (OpenAI/Groq/
// AssemblyAI). Opcional: sem ela as chaves seguem em texto puro no Mongo e o
// aviso abaixo aparece no boot.
function lerEncryptionKey() {
  const raw = String(process.env.SECRETS_KEY || "").trim();
  if (!raw) {
    console.warn(
      "[config] AVISO: SECRETS_KEY não definida — as chaves de API de terceiros ficam em texto puro no MongoDB.\n" +
      '          Gere uma com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
    return null;
  }
  try {
    const buf = Buffer.from(raw, "hex");
    if (buf.length !== 32) throw new Error("tamanho inválido");
    return buf;
  } catch {
    abortar(
      "SECRETS_KEY precisa ser exatamente 32 bytes em hexadecimal (64 caracteres).",
      'gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
    return null;
  }
}

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27018";
if (isProduction && !/@/.test(mongoUri)) {
  console.warn(
    "[config] AVISO: MONGODB_URI sem credenciais em produção. O banco guarda hash de senha,\n" +
    "          transcrição clínica e CPF — habilite autenticação no MongoDB.",
  );
}

export const config = {
  isProduction,
  port: Number(process.env.PORT) || 3030,
  corsOrigin,
  cookieSecure,
  jwtSecret: lerJwtSecret(),
  secretsKey: lerEncryptionKey(),
  mongo: {
    uri: mongoUri,
    db: process.env.MONGODB_DB || "chatflow",
  },
  paths: {
    dataDir: DATA_DIR,
    // Semente inicial. Morava na árvore do FRONTEND por herança do scaffold, o
    // que fazia o backend não subir se empacotado sozinho. Agora vive em
    // backend/seed; só é lida quando a coleção está vazia.
    usersSeedFile: path.resolve(BACKEND_ROOT, "seed", "users.json"),
    agentsSeedFile: path.resolve(BACKEND_ROOT, "seed", "agents.json"),
    mediaDir: path.join(DATA_DIR, "media"),
    uploadsDir: path.join(DATA_DIR, "uploads"),
    baileysAuthDir: path.join(DATA_DIR, ".baileys_auth"),
  },
};

