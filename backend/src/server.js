import http from "node:http";
import fs from "node:fs/promises";
import express from "express";
import cors from "cors";
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
import { scheduledMessagesRouter } from "./routes/scheduled-messages.js";
import { dealsRouter } from "./routes/deals.js";
import { stagesRouter } from "./routes/stages.js";
import { customFieldsRouter } from "./routes/custom-fields.js";
import { leadsRouter } from "./routes/leads.js";
import { quickRepliesRouter } from "./routes/quick-replies.js";
import { internalChatRouter } from "./routes/internal-chat.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { bindSocketHandlers } from "./socket/events.js";
import { connectionManager } from "./whatsapp/ConnectionManager.js";
import { startScheduledSender, stopScheduledSender } from "./whatsapp/scheduled-sender.js";
import { startCampaignSender, stopCampaignSender } from "./whatsapp/campaign-sender.js";
import { connectMongo, closeMongo } from "./storage/mongo.js";
import { reconcileOrphanInstances } from "./storage/reconcile-instances.js";

async function ensureDirs() {
  await fs.mkdir(config.paths.dataDir, { recursive: true });
  await fs.mkdir(config.paths.mediaDir, { recursive: true });
  await fs.mkdir(config.paths.baileysAuthDir, { recursive: true });
}

async function main() {
  await ensureDirs();
  await connectMongo();
  await reconcileOrphanInstances();

  const app = express();
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: "5mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/agents", agentsRouter);
  app.use("/api/instances", instancesRouter);
  app.use("/api/instances", sendRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api/media", mediaRouter);
  app.use("/api/prontuarios", prontuariosRouter);
  app.use("/api/scheduled-messages", scheduledMessagesRouter);
  app.use("/api/deals", dealsRouter);
  app.use("/api/stages", stagesRouter);
  app.use("/api/custom-fields", customFieldsRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/quick-replies", quickRepliesRouter);
  app.use("/api/internal-chat", internalChatRouter);
  app.use("/api/campaigns", campaignsRouter);

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
  });

  const shutdown = async signal => {
    console.log(`[server] received ${signal}, shutting down...`);
    try {
      stopScheduledSender();
      stopCampaignSender();
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
}

main().catch(err => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
