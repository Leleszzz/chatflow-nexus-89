import { Router } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import mime from "mime-types";
import { resolveMediaPath } from "../storage/media-repo.js";

export const mediaRouter = Router();

mediaRouter.get("/:filename", async (req, res) => {
  const filePath = resolveMediaPath(req.params.filename);
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return res.status(404).end();
    const contentType = mime.lookup(filePath) || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", stat.size);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    if (err.code === "ENOENT") return res.status(404).end();
    res.status(500).json({ error: err.message });
  }
});
