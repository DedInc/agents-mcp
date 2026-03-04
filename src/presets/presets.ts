import YAML from "yaml";
import fs from "fs/promises";
import path from "path";
import { PRESETS_DIR, BUNDLED_PRESETS_DIR } from "../config.js";
import { fileExists, safeFilename, atomicWrite } from "../helpers.js";

export interface PresetMeta {
  name: string;
  description: string;
  model?: string;
  effort?: string;
  inputs_required?: string;
  inputs_optional?: string;
  outputs?: string;
  response_format?: string;
  api_base?: string;
  api_key_env?: string;
  system_prompt: string;
}

type FrontmatterKey = keyof Omit<PresetMeta, "name" | "system_prompt">;

function parseFrontmatter(text: string): { meta: Partial<PresetMeta>; rest: string } {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return { meta: {}, rest: text };
  const normalized = text.replace(/\r\n/g, "\n");
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return { meta: {}, rest: text };

  const fmBlock = normalized.slice(4, end);
  const rest    = normalized.slice(end + 5);
  try {
    const parsed = YAML.parse(fmBlock) as Record<string, unknown>;
    const meta: Partial<PresetMeta> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (val != null) (meta as Record<string, string>)[key as FrontmatterKey] = String(val);
    }
    return { meta, rest };
  } catch {
    return { meta: {}, rest: text };
  }
}

export function parsePreset(text: string): PresetMeta {
  const { meta, rest } = parseFrontmatter(text);
  const lines = rest.split("\n");
  const name  = (lines[0] ?? "").replace(/^#\s*/, "").trim();
  let description = meta.description ?? "";
  let bodyStart   = 1;
  if (!description && lines[1]?.startsWith(">")) {
    description = lines[1].replace(/^>\s*/, "").trim();
    bodyStart   = 2;
  }
  const system_prompt = lines.slice(bodyStart).join("\n").trim();
  return { ...meta, name, description, system_prompt };
}

export function renderPreset(p: PresetMeta): string {
  const fmObj: Record<string, string> = {};
  if (p.description)     fmObj.description = p.description;
  if (p.model)           fmObj.model = p.model;
  if (p.effort)          fmObj.effort = p.effort;
  if (p.inputs_required) fmObj.inputs_required = p.inputs_required;
  if (p.inputs_optional) fmObj.inputs_optional = p.inputs_optional;
  if (p.outputs)         fmObj.outputs = p.outputs;
  if (p.response_format) fmObj.response_format = p.response_format;
  if (p.api_base)        fmObj.api_base = p.api_base;
  if (p.api_key_env)     fmObj.api_key_env = p.api_key_env;
  const hasFields = Object.keys(fmObj).length > 0;
  const fm = hasFields ? `---\n${YAML.stringify(fmObj).trimEnd()}\n---\n` : "";
  return `${fm}# ${p.name}\n\n${p.system_prompt.trim()}\n`;
}

export async function seedBundledPresets(): Promise<void> {
  await fs.mkdir(PRESETS_DIR, { recursive: true });
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
}

export async function loadPresetFile(preset: string): Promise<string> {
  const file = path.join(PRESETS_DIR, safeFilename(preset) + ".md");
  return fs.readFile(file, "utf-8");
}

export async function savePresetFile(name: string, content: string, overwrite?: boolean): Promise<{ file: string; existed: boolean }> {
  const filename = safeFilename(name);
  const file     = path.join(PRESETS_DIR, filename + ".md");
  const existed  = await fileExists(file);
  if (existed && !overwrite)
    throw new Error(`Preset '${filename}' already exists. Pass overwrite=true to update it.`);
  await atomicWrite(file, content);
  return { file, existed };
}

export async function deletePresetFile(name: string): Promise<void> {
  const file = path.join(PRESETS_DIR, safeFilename(name) + ".md");
  await fs.unlink(file);
}

export async function listPresetFiles(): Promise<string[]> {
  return (await fs.readdir(PRESETS_DIR)).filter((f) => f.endsWith(".md")).sort();
}

export async function readPresetContent(name: string): Promise<string | null> {
  const file = path.join(PRESETS_DIR, safeFilename(name) + ".md");
  if (!(await fileExists(file))) return null;
  return fs.readFile(file, "utf-8");
}
