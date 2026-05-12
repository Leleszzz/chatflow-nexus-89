import { Router } from "express";
import { recordFrontendStats } from "../monitor/resource-monitor.js";

export const metricsRouter = Router();

metricsRouter.post("/frontend", (req, res) => {
  const b = req.body || {};
  const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
  recordFrontendStats(
    {
      cpu: num(b.cpu),
      jsHeapUsed: num(b.jsHeapUsed),
      jsHeapTotal: num(b.jsHeapTotal),
      jsHeapLimit: num(b.jsHeapLimit),
      storageUsage: num(b.storageUsage),
      storageQuota: num(b.storageQuota),
    },
    typeof b.clientId === "string" ? b.clientId : undefined
  );
  res.json({ ok: true });
});
