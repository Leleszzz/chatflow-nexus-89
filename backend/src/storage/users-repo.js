import fs from "node:fs/promises";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { getCol, collections } from "./mongo.js";
import { hashPassword } from "../lib/password.js";

const col = () => getCol(collections.users);
const SEED_FILE = config.paths.usersSeedFile;
const PROJ = { projection: { _id: 0 } };

let seedPromise = null;

// Semeia a coleção a partir do arquivo seed apenas se ela estiver vazia
// (a migração one-time do boot já pode tê-la preenchido a partir de users.json).
async function ensureSeed() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const count = await col().countDocuments();
    if (count > 0) return;
    try {
      const raw = await fs.readFile(SEED_FILE, "utf8");
      const seed = JSON.parse(raw);
      if (Array.isArray(seed) && seed.length) {
        await col().insertMany(seed.map(u => ({ _id: u.id, ...u })), { ordered: false });
        console.log(`[users-repo] seeded users from ${SEED_FILE}`);
      }
    } catch (err) {
      console.warn(`[users-repo] seed failed (${err.message}); starting with empty users`);
    }
  })();
  return seedPromise;
}

function sanitize(user) {
  if (!user) return user;
  const { passwordHash, passwordSalt, password, _id, ...rest } = user;
  return rest;
}

export async function listUsers() {
  await ensureSeed();
  const users = await col().find({}, PROJ).toArray();
  return users.map(sanitize);
}

async function listUsersRaw() {
  await ensureSeed();
  return col().find({}, PROJ).toArray();
}

export async function getUser(id) {
  await ensureSeed();
  return col().findOne({ _id: id }, PROJ);
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

  try {
    await col().insertOne({ _id: id, ...withCreds });
  } catch (err) {
    if (err?.code === 11000) throw new Error(`Já existe usuário com id ${id}`);
    throw err;
  }
  return sanitize(withCreds);
}

export async function updateUser(id, patch) {
  await ensureSeed();
  const credsPatch = await withPasswordPatch(patch);
  const res = await col().findOneAndUpdate(
    { _id: id },
    { $set: credsPatch },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  const updated = res?.value ?? res;
  return updated ? sanitize(updated) : null;
}

export async function setPassword(id, passwordHash, passwordSalt) {
  await col().updateOne({ _id: id }, { $set: { passwordHash, passwordSalt } });
}

export async function deleteUser(id) {
  await col().deleteOne({ _id: id });
}

export { sanitize as sanitizeUser };
