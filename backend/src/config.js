import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(BACKEND_ROOT, process.env.DATA_DIR || "./data");

export const config = {
  port: Number(process.env.PORT) || 3001,
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:8080",
  paths: {
    backendRoot: BACKEND_ROOT,
    dataDir: DATA_DIR,
    instancesFile: path.join(DATA_DIR, "instances.json"),
    conversationsFile: path.join(DATA_DIR, "conversations.json"),
    settingsFile: path.join(DATA_DIR, "settings.json"),
    usersFile: path.join(DATA_DIR, "users.json"),
    prontuariosFile: path.join(DATA_DIR, "prontuarios.json"),
    agentUsageFile: path.join(DATA_DIR, "agent-usage.json"),
    usersSeedFile: path.resolve(BACKEND_ROOT, "..", "src", "banco-de-dados", "users.json"),
    messagesDir: path.join(DATA_DIR, "messages"),
    mediaDir: path.join(DATA_DIR, "media"),
    baileysAuthDir: path.join(DATA_DIR, ".baileys_auth"),
  },
  sync: {
    messagesPerChat: 1000,
    progressEveryNChats: 5,
  },
};
