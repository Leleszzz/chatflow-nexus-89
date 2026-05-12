import fs from "node:fs/promises";
import path from "node:path";

const locks = new Map();

async function withLock(filePath, fn) {
  const prev = locks.get(filePath) || Promise.resolve();
  let release;
  const next = new Promise(resolve => { release = resolve; });
  locks.set(filePath, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(filePath) === next) locks.delete(filePath);
  }
}

const TRANSIENT_CODES = new Set(["EPERM", "EBUSY", "EACCES", "EEXIST"]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function renameWithRetry(src, dst) {
  const delays = [25, 75, 200, 500, 1000];
  let lastErr;
  for (let i = 0; i <= delays.length; i++) {
    try {
      await fs.rename(src, dst);
      return;
    } catch (err) {
      lastErr = err;
      if (!TRANSIENT_CODES.has(err.code) || i === delays.length) break;
      await sleep(delays[i]);
    }
  }
  try {
    const buffer = await fs.readFile(src);
    await fs.writeFile(dst, buffer);
    await fs.unlink(src).catch(() => {});
    return;
  } catch {}
  throw lastErr;
}

export async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

export async function writeJson(filePath, value) {
  return withLock(filePath, async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await renameWithRetry(tmp, filePath);
  });
}

export async function updateJson(filePath, fallback, updater) {
  return withLock(filePath, async () => {
    let current;
    try {
      const raw = await fs.readFile(filePath, "utf8");
      current = JSON.parse(raw);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      current = fallback;
    }
    const next = await updater(current);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await renameWithRetry(tmp, filePath);
    return next;
  });
}
