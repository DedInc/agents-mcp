#!/usr/bin/env node
// REQUIRES a running OpenAI-compatible proxy pointed to by AGENT_API_BASE.

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_BASE_URL = process.env.AGENT_API_BASE ?? "http://127.0.0.1:3030/v1";
const DEFAULT_API_KEY  = process.env.AGENT_API_KEY  ?? "optional";
const DEFAULT_MODEL    = process.env.AGENT_MODEL    ?? "gpt-5.3-codex";
/** Set AGENT_ALLOW_CUSTOM_BASE_URL=false to block callers from pointing at arbitrary hosts (SSRF). */
const ALLOW_CUSTOM_URL = process.env.AGENT_ALLOW_CUSTOM_BASE_URL !== "false";
const REQUEST_TIMEOUT  = Number(process.env.AGENT_TIMEOUT_MS ?? 300_000);
const MAX_STR          = 128_000;

const PRESETS_DIR = process.env.PRESETS_DIR
  ? path.resolve(process.env.PRESETS_DIR)
  : path.join(os.homedir(), ".agents-mcp", "presets");

// Bundled presets ship alongside the source/dist files in ../presets/
const BUNDLED_PRESETS_DIR = path.join(__dirname, "..", "presets");

// ── OpenAI client cache (one instance per base_url) ──────────────────────────
const _clients = new Map<string, OpenAI>();
function getClient(base_url: string): OpenAI {
  if (!_clients.has(base_url)) {
    _clients.set(base_url, new OpenAI({ baseURL: base_url, apiKey: DEFAULT_API_KEY }));
  }
  return _clients.get(base_url)!;
}

// ── startup ───────────────────────────────────────────────────────────────────
await fs.mkdir(PRESETS_DIR, { recursive: true });

// Seed bundled presets into PRESETS_DIR on first use (never overwrites user edits)
try {
  const bundled = await fs.readdir(BUNDLED_PRESETS_DIR);
  await Promise.all(
    bundled
      .filter((f) => f.endsWith(".md"))
      .map(async (f) => {
        const dest = path.join(PRESETS_DIR, f);
        if (!(await fileExists(dest)))
          await fs.copyFile(path.join(BUNDLED_PRESETS_DIR, f), dest);
      }),
  );
} catch (err) {
  console.error(
    "agents-mcp: could not seed bundled presets —",
    err instanceof Error ? err.message : err,
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────
function safeFilename(name: string): string {
  return name.trim().toLowerCase().replace(/[^\w-]/g, "_");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Atomic write: write to temp file then rename to avoid partial writes / TOCTOU. */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp.${process.pid}`;
  try {
    await fs.writeFile(tmp, content, "utf-8");
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Validate URL scheme and format; throws on anything other than http/https. */
function validateBaseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("base_url is not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new Error("base_url must use http or https");
  return raw;
}

// ── preset format ─────────────────────────────────────────────────────────────
// Supports optional YAML-lite frontmatter before the system-prompt body:
//
//   ---
//   description: One-line description
//   model: gpt-5.3-codex
//   effort: xhigh
//   inputs_required: query
//   inputs_optional: model, effort, base_url
//   outputs: Short description of what the agent returns
//   ---
//   # name
//   <system_prompt>
//
// Legacy format (no frontmatter) is still parsed correctly via # / > lines.

interface PresetMeta {
  name: string;
  description: string;
  model?: string;
  effort?: string;
  /** Comma-separated required input parameter names, e.g. "query" */
  inputs_required?: string;
  /** Comma-separated optional input parameter names, e.g. "model, effort, base_url" */
  inputs_optional?: string;
  /** Short description of what the preset returns */
  outputs?: string;
  system_prompt: string;
}

type FrontmatterKey = keyof Omit<PresetMeta, "name" | "system_prompt">;

function parseFrontmatter(text: string): { meta: Partial<PresetMeta>; rest: string } {
  if (!text.startsWith("---\n")) return { meta: {}, rest: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { meta: {}, rest: text };
  const fm   = text.slice(4, end);
  const rest = text.slice(end + 5);
  const meta: Partial<PresetMeta> = {};
  for (const line of fm.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim() as FrontmatterKey;
    const val = line.slice(idx + 1).trim();
    if (val) (meta as Record<string, string>)[key] = val;
  }
  return { meta, rest };
}

function parsePreset(text: string): PresetMeta {
  const { meta, rest } = parseFrontmatter(text.replace(/\r\n/g, "\n"));
  const lines = rest.split("\n");
  const name  = (lines[0] ?? "").replace(/^#\s*/, "").trim();
  let description = meta.description ?? "";
  let bodyStart   = 1;
  // Legacy fallback: > description line
  if (!description && lines[1]?.startsWith(">")) {
    description = lines[1].replace(/^>\s*/, "").trim();
    bodyStart   = 2;
  }
  const system_prompt = lines.slice(bodyStart).join("\n").trim();
  return { ...meta, name, description, system_prompt };
}

function renderPreset(p: PresetMeta): string {
  const { name, description, model, effort, inputs_required, inputs_optional, outputs, system_prompt } = p;
  const fmLines: string[] = [];
  if (description)     fmLines.push(`description: ${description}`);
  if (model)           fmLines.push(`model: ${model}`);
  if (effort)          fmLines.push(`effort: ${effort}`);
  if (inputs_required) fmLines.push(`inputs_required: ${inputs_required}`);
  if (inputs_optional) fmLines.push(`inputs_optional: ${inputs_optional}`);
  if (outputs)         fmLines.push(`outputs: ${outputs}`);
  const fm = fmLines.length ? `---\n${fmLines.join("\n")}\n---\n` : "";
  return `${fm}# ${name}\n\n${system_prompt.trim()}\n`;
}

// ── agent call ────────────────────────────────────────────────────────────────
async function callAgent(
  system_prompt: string,
  query: string,
  model: string,
  base_url: string,
  effort?: string,
): Promise<string> {
  if (!ALLOW_CUSTOM_URL && base_url && base_url !== DEFAULT_BASE_URL)
    throw new Error("Custom base_url is disabled. Set AGENT_ALLOW_CUSTOM_BASE_URL=true to enable.");

  const resolvedUrl = base_url ? validateBaseUrl(base_url) : DEFAULT_BASE_URL;
  const client = getClient(resolvedUrl);

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await client.chat.completions.create(
      {
        model: model || DEFAULT_MODEL,
        messages: [
          { role: "system", content: system_prompt },
          { role: "user",   content: query },
        ],
        stream: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(effort ? { reasoning_effort: effort as any } : {}),
      },
      { signal: ctrl.signal },
    );
    return resp.choices[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

function errResp(message: string) {
  return { content: [{ type: "text" as const, text: `ERROR: ${message}` }] };
}

// ── MCP server ────────────────────────────────────────────────────────────────
const server = new McpServer({ name: "agents-mcp", version: "1.0.0" });

const effortEnum   = z.enum(["low", "medium", "high", "xhigh"]).optional();
const querySchema  = z.string().min(1).max(MAX_STR).describe("The user's request / task.");
const promptSchema = z.string().min(1).max(MAX_STR).describe("Full system prompt defining the agent's identity and rules.");

// ── run_agent ─────────────────────────────────────────────────────────────────
server.registerTool(
  "run_agent",
  {
    description:
      "Invoke any AI agent fully inline — no preset needed. " +
      "Provide a system_prompt defining the agent and a query for it to answer.",
    inputSchema: {
      query:         querySchema,
      system_prompt: promptSchema,
      model:    z.string().max(256).optional().describe("Model name. Defaults to AGENT_MODEL env var."),
      base_url: z.string().url().optional().describe("API base URL. Defaults to AGENT_API_BASE env var."),
      effort:   effortEnum.describe("Reasoning effort level. Leave empty for model default."),
    },
  },
  async ({ query, system_prompt, model, base_url, effort }) => {
    try {
      const result = await callAgent(system_prompt, query, model ?? "", base_url ?? "", effort);
      return { content: [{ type: "text" as const, text: result }] };
    } catch (err) {
      return errResp(err instanceof Error ? err.message : String(err));
    }
  },
);

// ── run_preset ────────────────────────────────────────────────────────────────
server.registerTool(
  "run_preset",
  {
    description:
      "Invoke a saved agent preset by name. Use list_presets to see available presets, " +
      "their required/optional inputs, and recommended model/effort.",
    inputSchema: {
      query:    querySchema,
      preset:   z.string().min(1).max(256).describe("Preset name (filename without .md). Use list_presets to browse."),
      model:    z.string().max(256).optional().describe("Model override. Falls back to the preset's recommended model."),
      base_url: z.string().url().optional().describe("API base URL override."),
      effort:   effortEnum.describe("Reasoning effort override. Falls back to the preset's recommended effort."),
    },
  },
  async ({ query, preset, model, base_url, effort }) => {
    try {
      const file = path.join(PRESETS_DIR, safeFilename(preset) + ".md");
      let text: string;
      try {
        text = await fs.readFile(file, "utf-8");
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          const files     = await fs.readdir(PRESETS_DIR);
          const available = files.filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", ""));
          const hint      = available.length
            ? `Available: ${available.join(", ")}`
            : "No presets yet — use save_preset to create one.";
          return errResp(`Preset '${preset}' not found. ${hint}`);
        }
        throw err;
      }
      const parsed = parsePreset(text);
      // Caller args take precedence → preset recommendations → env defaults
      const resolvedModel  = model  ?? parsed.model  ?? "";
      const resolvedEffort = effort ?? parsed.effort;
      const result = await callAgent(parsed.system_prompt, query, resolvedModel, base_url ?? "", resolvedEffort);
      return { content: [{ type: "text" as const, text: result }] };
    } catch (err) {
      return errResp(err instanceof Error ? err.message : String(err));
    }
  },
);

// ── save_preset ───────────────────────────────────────────────────────────────
server.registerTool(
  "save_preset",
  {
    description:
      "Save or update an agent preset as a .md file. " +
      "The preset can later be invoked by name with run_preset.",
    inputSchema: {
      name:            z.string().min(1).max(256).describe('Preset name, e.g. "oracle" or "code-reviewer".'),
      system_prompt:   promptSchema,
      description:     z.string().max(512).optional().describe("Short one-line description of the agent."),
      model:           z.string().max(256).optional().describe("Recommended model for this preset, e.g. gpt-5.3-codex."),
      effort:          effortEnum.describe("Recommended reasoning effort (low/medium/high/xhigh)."),
      inputs_required: z.string().max(1024).optional().describe('Comma-separated required input names, e.g. "query".'),
      inputs_optional: z.string().max(1024).optional().describe('Comma-separated optional input names, e.g. "model, effort".'),
      outputs:         z.string().max(512).optional().describe("Short description of the preset's output format."),
      overwrite:       z.boolean().optional().describe("Set true to overwrite an existing preset."),
    },
  },
  async ({ name, system_prompt, description, model, effort, inputs_required, inputs_optional, outputs, overwrite }) => {
    try {
      const filename = safeFilename(name);
      const file     = path.join(PRESETS_DIR, filename + ".md");
      const exists   = await fileExists(file);
      if (exists && !overwrite)
        return errResp(`Preset '${filename}' already exists. Pass overwrite=true to update it.`);
      const content = renderPreset({
        name, description: description ?? "", model, effort,
        inputs_required, inputs_optional, outputs, system_prompt,
      });
      await atomicWrite(file, content);
      return {
        content: [{ type: "text" as const, text: `${exists ? "Updated" : "Saved"} preset '${filename}' → ${file}` }],
      };
    } catch (err) {
      return errResp(err instanceof Error ? err.message : String(err));
    }
  },
);

// ── list_presets ──────────────────────────────────────────────────────────────
server.registerTool(
  "list_presets",
  {
    description:
      "List all saved agent presets. Returns name, description, recommended model/effort, " +
      "and input/output schema for each preset.",
    inputSchema: {},
  },
  async () => {
    try {
      const files  = (await fs.readdir(PRESETS_DIR)).filter((f) => f.endsWith(".md")).sort();
      const result = await Promise.all(
        files.map(async (f) => {
          const text = await fs.readFile(path.join(PRESETS_DIR, f), "utf-8");
          const { name, description, model, effort, inputs_required, inputs_optional, outputs } = parsePreset(text);
          return {
            name:         f.replace(".md", ""),
            display_name: name,
            description,
            ...(model           && { model }),
            ...(effort          && { effort }),
            ...(inputs_required && { inputs_required }),
            ...(inputs_optional && { inputs_optional }),
            ...(outputs         && { outputs }),
          };
        }),
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return errResp(err instanceof Error ? err.message : String(err));
    }
  },
);

// ── delete_preset ─────────────────────────────────────────────────────────────
server.registerTool(
  "delete_preset",
  {
    description: "Delete a saved preset by name.",
    inputSchema: {
      name: z.string().min(1).max(256).describe("Preset name (without .md extension)."),
    },
  },
  async ({ name }) => {
    try {
      const file = path.join(PRESETS_DIR, safeFilename(name) + ".md");
      try {
        await fs.unlink(file);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT")
          return errResp(`Preset '${name}' not found.`);
        throw err;
      }
      return { content: [{ type: "text" as const, text: `Deleted preset '${name}'.` }] };
    } catch (err) {
      return errResp(err instanceof Error ? err.message : String(err));
    }
  },
);

// ── preset-content resource ───────────────────────────────────────────────────
server.registerResource(
  "preset-content",
  new ResourceTemplate("agents://presets/{name}", { list: undefined }),
  { description: "Returns the full content of a saved agent preset file." },
  async (uri, { name }) => {
    const safe = safeFilename(String(name));
    const file = path.join(PRESETS_DIR, safe + ".md");
    if (!(await fileExists(file))) {
      return {
        contents: [{ uri: uri.href, mimeType: "text/plain", text: `Preset '${name}' not found.` }],
      };
    }
    const content = await fs.readFile(file, "utf-8");
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }] };
  },
);

// ── start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("agents-mcp started on stdio | presets:", PRESETS_DIR);
