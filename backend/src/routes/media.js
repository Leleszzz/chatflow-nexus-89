import { Router } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import mime from "mime-types";
import { resolveMediaPath } from "../storage/media-repo.js";

export const mediaRouter = Router();

// SEM requireAuth de propósito: a mídia é consumida por tags <img>/<audio>/<video>
// que não enviam header Authorization (e blob-fetch quebraria o seek via Range).
// A proteção é o nome de arquivo nanoid de 21 chars (URL-capability, ~126 bits)
// + resolveMediaPath com path.basename contra traversal. Não "corrigir" isso
// adicionando auth sem repensar o consumo no frontend.
mediaRouter.get("/:filename", async (req, res) => {
  const filePath = resolveMediaPath(req.params.filename);
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return res.status(404).end();
    const contentType = mime.lookup(filePath) || "application/octet-stream";
    const total = stat.size;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    // Permite que o browser faça seek em áudio/vídeo via requisições parciais.
    res.setHeader("Accept-Ranges", "bytes");

    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.setHeader("Content-Range", `bytes */${total}`);
        return res.status(416).end();
      }
      let start = match[1] === "" ? undefined : parseInt(match[1], 10);
      let end = match[2] === "" ? undefined : parseInt(match[2], 10);
      if (start === undefined && end === undefined) {
        res.setHeader("Content-Range", `bytes */${total}`);
        return res.status(416).end();
      }
      // bytes=-N => últimos N bytes
      if (start === undefined) {
        start = Math.max(0, total - end);
        end = total - 1;
      } else if (end === undefined) {
        end = total - 1;
      }
      if (start > end || start >= total) {
        res.setHeader("Content-Range", `bytes */${total}`);
        return res.status(416).end();
      }
      end = Math.min(end, total - 1);
      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", chunkSize);
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }

    res.setHeader("Content-Length", total);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    if (err.code === "ENOENT") return res.status(404).end();
    res.status(500).json({ error: err.message });
  }
});
