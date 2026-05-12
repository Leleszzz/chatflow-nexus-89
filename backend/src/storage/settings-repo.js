import { config } from "../config.js";
import { readJson, updateJson } from "./json-store.js";

const FILE = config.paths.settingsFile;
const DEFAULTS = {
  openai: {
    apiKey: "",
    defaultModel: "",
  },
};

export async function getSettings() {
  const stored = await readJson(FILE, {});
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
  return updateJson(FILE, {}, current => {
    const next = { ...current };
    next.openai = { ...DEFAULTS.openai, ...(current.openai || {}), ...patch };
    return next;
  });
}

export async function clearOpenaiKey() {
  return updateJson(FILE, {}, current => {
    const next = { ...current };
    next.openai = { ...DEFAULTS.openai, ...(current.openai || {}), apiKey: "" };
    return next;
  });
}
