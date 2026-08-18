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
  mongo: {
    uri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27018",
    db: process.env.MONGODB_DB || "chatflow",
  },
  paths: {
    dataDir: DATA_DIR,
    // Semente inicial de usuários. Mora na árvore do frontend por herança do
    // scaffold — só é lida quando a coleção `users` está vazia.
    usersSeedFile: path.resolve(BACKEND_ROOT, "..", "src", "banco-de-dados", "users.json"),
    mediaDir: path.join(DATA_DIR, "media"),
    baileysAuthDir: path.join(DATA_DIR, ".baileys_auth"),
  },
};
