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
import { metricsRouter } from "./routes/metrics.js";
import { dealsRouter } from "./routes/deals.js";
import { stagesRouter } from "./routes/stages.js";
import { leadsRouter } from "./routes/leads.js";
import { quickRepliesRouter } from "./routes/quick-replies.js";
import { bindSocketHandlers } from "./socket/events.js";
import { restoreAllInstances, setIO, shutdownAll } from "./whatsapp/instance-manager.js";
import { startScheduledSender } from "./whatsapp/scheduled-sender.js";
import { connectMongo, closeMongo } from "./storage/mongo.js";
import { migrateJsonToMongo } from "./storage/migrate-to-mongo.js";

async function ensureDirs() {
  await fs.mkdir(config.paths.dataDir, { recursive: true });
  await fs.mkdir(config.paths.mediaDir, { recursive: true });
  await fs.mkdir(config.paths.baileysAuthDir, { recursive: true });
}

async function main() {
  await ensureDirs();
  await connectMongo();
  await migrateJsonToMongo();

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
  app.use("/api/metrics", metricsRouter);
  app.use("/api/deals", dealsRouter);
  app.use("/api/stages", stagesRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/quick-replies", quickRepliesRouter);

  const httpServer = http.createServer(app);
  const io = new SocketServer(httpServer, {
    cors: { origin: config.corsOrigin, credentials: true },
  });
  app.set("io", io);
  bindSocketHandlers(io);
  setIO(io);

  httpServer.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
    restoreAllInstances().catch(err => console.error("[server] restoreAllInstances failed:", err));
    startScheduledSender(io);
  });

  const shutdown = async signal => {
    console.log(`[server] received ${signal}, shutting down...`);
    try {
      await shutdownAll();
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
