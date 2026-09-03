import http from "node:http";
import fs from "node:fs/promises";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Server as SocketServer } from "socket.io";
import { config } from "./config.js";
import { instancesRouter } from "./routes/instances.js";
import { conversationsRouter } from "./routes/conversations.js";
import { sendRouter } from "./routes/send.js";
import { mediaRouter } from "./routes/media.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { settingsRouter } from "./routes/settings.js";
import { agentsRouter } from "./routes/agents.js";
import { prontuariosRouter } from "./routes/prontuarios.js";
import { consultationsRouter } from "./routes/consultations.js";
import { scheduledMessagesRouter } from "./routes/scheduled-messages.js";
import { dealsRouter } from "./routes/deals.js";
import { stagesRouter } from "./routes/stages.js";
import { tagsRouter } from "./routes/tags.js";
import { appointmentsRouter } from "./routes/appointments.js";
import { tasksRouter } from "./routes/tasks.js";
import { dealOutcomesRouter } from "./routes/deal-outcomes.js";
import { customFieldsRouter } from "./routes/custom-fields.js";
import { leadsRouter } from "./routes/leads.js";
import { quickRepliesRouter } from "./routes/quick-replies.js";
import { internalChatRouter } from "./routes/internal-chat.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { assistantRouter } from "./routes/assistant.js";
import { bindSocketHandlers } from "./socket/events.js";
import { connectionManager } from "./whatsapp/ConnectionManager.js";
import { startScheduledSender, stopScheduledSender } from "./whatsapp/scheduled-sender.js";
import { startCampaignSender, stopCampaignSender } from "./whatsapp/campaign-sender.js";
import { startMediaRetention, stopMediaRetention } from "./storage/media-retention.js";
import { pararAutoReply } from "./whatsapp/agent-auto-reply.js";
import { connectMongo, closeMongo } from "./storage/mongo.js";
import { reconcileOrphanInstances } from "./storage/reconcile-instances.js";
import { migrarCargos } from "./storage/migrar-cargos.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { apiLimiter } from "./middleware/rate-limit.js";
import { csrfProtection } from "./middleware/csrf.js";

async function ensureDirs() {
  await fs.mkdir(config.paths.dataDir, { recursive: true });
  await fs.mkdir(config.paths.mediaDir, { recursive: true });
  await fs.mkdir(config.paths.baileysAuthDir, { recursive: true });
  // Temporários do multer. Antes as rotas usavam o caminho relativo
  // "data/uploads", que depende do diretório de onde o processo foi iniciado.
  await fs.mkdir(config.paths.uploadsDir, { recursive: true });
}

async function main() {
  await ensureDirs();
  await connectMongo();
  await reconcileOrphanInstances();
  await migrarCargos();

  const app = express();

  // Atrás de proxy reverso (nginx/Caddy), sem isto req.ip vira o IP do proxy e
  // todo o rate limit passa a compartilhar um único balde.
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.disable("x-powered-by");

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    // O frontend roda em outra origem (Vite em :8080) e precisa carregar as
    // mídias de /api/media em <img>/<audio>/<video>. A política padrão
    // (same-origin) quebraria toda a exibição de anexo.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
  }));

  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  // 5mb era generoso demais para JSON: os uploads grandes têm rota própria com
  // multer, então o corpo JSON não precisa passar de algumas centenas de KB.
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api", apiLimiter);
  // Depois do rate limit (uma enxurrada de CSRF invalido tambem deve ser
  // contida) e antes de qualquer rota que mude estado.
  app.use("/api", csrfProtection);
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/agents", agentsRouter);
  app.use("/api/instances", instancesRouter);
  app.use("/api/instances", sendRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api/media", mediaRouter);
  app.use("/api/prontuarios", prontuariosRouter);
  app.use("/api/consultations", consultationsRouter);
  app.use("/api/scheduled-messages", scheduledMessagesRouter);
  app.use("/api/deals", dealsRouter);
  app.use("/api/stages", stagesRouter);
  app.use("/api/tags", tagsRouter);
  app.use("/api/appointments", appointmentsRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/deal-outcomes", dealOutcomesRouter);
  app.use("/api/custom-fields", customFieldsRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/quick-replies", quickRepliesRouter);
  app.use("/api/internal-chat", internalChatRouter);
  app.use("/api/campaigns", campaignsRouter);
  app.use("/api/assistant", assistantRouter);

  // Precisam vir DEPOIS de todas as rotas.
  app.use("/api", notFoundHandler);
  app.use(errorHandler);

  const httpServer = http.createServer(app);
  const io = new SocketServer(httpServer, {
    cors: { origin: config.corsOrigin, credentials: true },
  });
  app.set("io", io);
  bindSocketHandlers(io);
  connectionManager.setIO(io);

  httpServer.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
    connectionManager.restoreAll().catch(err => console.error("[server] restoreAllInstances failed:", err));
    startScheduledSender(io);
    startCampaignSender(io);
    // Faxina de midia orfa: data/media so crescia, sem nada apagar nunca.
    startMediaRetention();
  });

  const shutdown = async signal => {
    console.log(`[server] received ${signal}, shutting down...`);
    try {
      stopScheduledSender();
      stopCampaignSender();
      stopMediaRetention();
      pararAutoReply();
      await connectionManager.shutdownAll();
      await closeMongo();
    } catch (err) {
      console.error("[server] shutdown error:", err);
    }
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Rede de última instância. O lib/safe-router.js já encaminha a rejeição de
  // qualquer rota para o errorHandler; isto cobre o que nasce fora do ciclo de
  // requisição (timers, listeners do Baileys, workers de envio). Loga em vez de
  // morrer calado — e o processo deve rodar sob supervisor (systemd/pm2) para
  // ser reerguido se o estado ficar irrecuperável.
  process.on("unhandledRejection", motivo => {
    console.error("[server] promise rejeitada sem tratamento:", motivo);
  });
  process.on("uncaughtException", err => {
    console.error("[server] exceção não capturada:", err);
  });
}

main().catch(err => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
