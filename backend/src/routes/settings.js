import { Router } from "express";
import { getOpenaiSettings, setOpenaiSettings, clearOpenaiKey } from "../storage/settings-repo.js";
import { requireAuth } from "../middleware/require-auth.js";

export const settingsRouter = Router();

settingsRouter.get("/openai", requireAuth(), async (_req, res) => {
  const openai = await getOpenaiSettings();
  res.json({
    configured: Boolean(openai.apiKey),
    defaultModel: openai.defaultModel || "",
  });
});

settingsRouter.put("/openai", requireAuth({ admin: true }), async (req, res) => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey) return res.status(400).json({ error: "apiKey é obrigatório" });
  const patch = { apiKey };
  if (typeof req.body?.defaultModel === "string") patch.defaultModel = req.body.defaultModel.trim();
  await setOpenaiSettings(patch);
  res.json({ configured: true, defaultModel: patch.defaultModel || "" });
});

settingsRouter.delete("/openai", requireAuth({ admin: true }), async (_req, res) => {
  await clearOpenaiKey();
  res.json({ configured: false });
});
