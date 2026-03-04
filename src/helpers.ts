import fs from "fs/promises";

export function safeFilename(name: string): string {
  return name.trim().toLowerCase().replace(/[^\w-]/g, "_");
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Atomic write: write to temp file then rename to avoid partial writes / TOCTOU. */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
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
export function validateBaseUrl(raw: string): string {
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

/** Simple template engine: replaces {{var}} placeholders with values. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return key in vars ? vars[key] : match;
  });
}

export function errResp(message: string) {
  return { content: [{ type: "text" as const, text: `ERROR: ${message}` }] };
}
