import fs from "node:fs/promises";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { readJson, updateJson, writeJson } from "./json-store.js";
import { hashPassword } from "../lib/password.js";

const FILE = config.paths.usersFile;
const SEED_FILE = config.paths.usersSeedFile;

let seedPromise = null;

async function ensureSeed() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    try {
      await fs.access(FILE);
      return;
    } catch {}
    try {
      const raw = await fs.readFile(SEED_FILE, "utf8");
      const seed = JSON.parse(raw);
      await writeJson(FILE, Array.isArray(seed) ? seed : []);
      console.log(`[users-repo] seeded ${FILE} from ${SEED_FILE}`);
    } catch (err) {
      console.warn(`[users-repo] seed failed (${err.message}); starting with empty users.json`);
      await writeJson(FILE, []);
    }
  })();
  return seedPromise;
}

function sanitize(user) {
  if (!user) return user;
  const { passwordHash, passwordSalt, password, ...rest } = user;
  return rest;
}

export async function listUsers() {
  await ensureSeed();
  const users = await readJson(FILE, []);
  return users.map(sanitize);
}

export async function listUsersRaw() {
  await ensureSeed();
  return readJson(FILE, []);
}

export async function getUser(id) {
  const all = await listUsersRaw();
  return all.find(u => u.id === id) || null;
}

export async function getSanitizedUser(id) {
  const user = await getUser(id);
  return sanitize(user);
}

export async function findByIdentifier(identifier) {
  const normalized = String(identifier || "").trim().toLowerCase();
  if (!normalized) return null;
  const all = await listUsersRaw();
  return all.find(user => user.active && [user.username, user.email, user.name]
    .filter(Boolean)
    .some(value => value.toLowerCase() === normalized)) || null;
}

async function withPasswordPatch(patch) {
  const { password, ...rest } = patch;
  if (!password) return rest;
  const { passwordHash, passwordSalt } = await hashPassword(password);
  return { ...rest, passwordHash, passwordSalt };
}

export async function createUser(input) {
  await ensureSeed();
  const id = input.id || `u${nanoid(8)}`;
  const base = {
    id,
    name: input.name || "",
    username: input.username || (input.email ? input.email.split("@")[0] : id),
    email: input.email || "",
    phone: input.phone || "",
    role: input.role || "Vendedora",
    avatar: input.avatar || "",
    photoUrl: input.photoUrl,
    active: input.active !== false,
    allowedTags: input.allowedTags || [],
    allowedConversationIds: input.allowedConversationIds || [],
    allowedInstanceIds: input.allowedInstanceIds || [],
    receivesNewLeads: input.receivesNewLeads ?? (input.role === "Vendedora"),
  };
  const withCreds = { ...base, ...(await withPasswordPatch({ password: input.password })) };

  await updateJson(FILE, [], current => {
    if (current.some(u => u.id === withCreds.id)) {
      throw new Error(`Já existe usuário com id ${withCreds.id}`);
    }
    return [...current, withCreds];
  });
  return sanitize(withCreds);
}

export async function updateUser(id, patch) {
  await ensureSeed();
  const credsPatch = await withPasswordPatch(patch);
  let updated;
  await updateJson(FILE, [], current => {
    const idx = current.findIndex(u => u.id === id);
    if (idx === -1) return current;
    const next = current.slice();
    next[idx] = { ...next[idx], ...credsPatch };
    updated = next[idx];
    return next;
  });
  return updated ? sanitize(updated) : null;
}

export async function setPassword(id, passwordHash, passwordSalt) {
  await updateJson(FILE, [], current => {
    const idx = current.findIndex(u => u.id === id);
    if (idx === -1) return current;
    const next = current.slice();
    next[idx] = { ...next[idx], passwordHash, passwordSalt };
    return next;
  });
}

export async function deleteUser(id) {
  await updateJson(FILE, [], current => current.filter(u => u.id !== id));
}

export { sanitize as sanitizeUser };
