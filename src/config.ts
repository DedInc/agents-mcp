import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_BASE_URL = process.env.AGENT_API_BASE ?? "http://127.0.0.1:3030/v1";
export const DEFAULT_API_KEY  = process.env.AGENT_API_KEY  ?? "optional";
export const DEFAULT_MODEL    = process.env.AGENT_MODEL    ?? "gpt-5.3-codex";
/** Set AGENT_ALLOW_CUSTOM_BASE_URL=false to block callers from pointing at arbitrary hosts (SSRF). */
export const ALLOW_CUSTOM_URL = process.env.AGENT_ALLOW_CUSTOM_BASE_URL !== "false";
export const REQUEST_TIMEOUT  = Number(process.env.AGENT_TIMEOUT_MS ?? 300_000);
export const MAX_STR          = 128_000;
export const MAX_CLIENTS      = 32;
export const MAX_THREADS      = 64;
export const DEFAULT_CONTEXT_WINDOW = Number(process.env.AGENT_CONTEXT_WINDOW ?? 128_000);

export const PRESETS_DIR = process.env.PRESETS_DIR
  ? path.resolve(process.env.PRESETS_DIR)
  : path.join(os.homedir(), ".agents-mcp", "presets");

// Bundled presets ship alongside the source/dist files in ../presets/
export const BUNDLED_PRESETS_DIR = path.join(__dirname, "..", "presets");

export const DEFAULT_EMBEDDING_MODEL = process.env.AGENT_EMBEDDING_MODEL ?? "text-embedding-3-small";
export const DEFAULT_EMBEDDING_BASE  = process.env.AGENT_EMBEDDING_BASE  ?? "https://api.openai.com/v1";
export const DEFAULT_EMBEDDING_KEY   = process.env.AGENT_EMBEDDING_KEY   ?? process.env.AGENT_API_KEY ?? "optional";
