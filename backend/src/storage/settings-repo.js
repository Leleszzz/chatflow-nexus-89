import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.settings);
const DOC_ID = "app";
const DEFAULTS = {
  openai: {
    apiKey: "",
    defaultModel: "",
  },
};

export async function getSettings() {
  const stored = (await col().findOne({ _id: DOC_ID }, { projection: { _id: 0 } })) || {};
  return {
    ...DEFAULTS,
    ...stored,
    openai: { ...DEFAULTS.openai, ...(stored.openai || {}) },
  };
}

export async function getOpenaiSettings() {
  const settings = await getSettings();
  return settings.openai;
}

export async function setOpenaiSettings(patch) {
  const current = await getSettings();
  const openai = { ...DEFAULTS.openai, ...(current.openai || {}), ...patch };
  await col().updateOne({ _id: DOC_ID }, { $set: { openai } }, { upsert: true });
  return { ...current, openai };
}

export async function clearOpenaiKey() {
  return setOpenaiSettings({ apiKey: "" });
}
