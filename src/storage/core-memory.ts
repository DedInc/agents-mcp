import db from "./db.js";

export interface CoreMemoryBlock {
  block_name: string;
  content: string;
}

const DEFAULT_BLOCKS = ["user_profile", "project_context", "scratchpad"];

const stmtGet = db.prepare(
  "SELECT block_name, content FROM core_memory_blocks WHERE thread_id = ?",
);

const stmtUpsert = db.prepare(`
  INSERT INTO core_memory_blocks (thread_id, block_name, content, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(thread_id, block_name) DO UPDATE SET
    content = excluded.content,
    updated_at = excluded.updated_at
`);

const stmtAppend = db.prepare(`
  INSERT INTO core_memory_blocks (thread_id, block_name, content, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(thread_id, block_name) DO UPDATE SET
    content = core_memory_blocks.content || char(10) || excluded.content,
    updated_at = excluded.updated_at
`);

export function ensureDefaultBlocks(threadId: string): void {
  const existing = stmtGet.all(threadId) as CoreMemoryBlock[];
  const existingNames = new Set(existing.map((b) => b.block_name));
  const now = Date.now();
  for (const name of DEFAULT_BLOCKS) {
    if (!existingNames.has(name)) {
      stmtUpsert.run(threadId, name, "", now);
    }
  }
}

export function getCoreMemoryBlocks(threadId: string): CoreMemoryBlock[] {
  return stmtGet.all(threadId) as CoreMemoryBlock[];
}

export function coreMemoryAppend(
  threadId: string,
  blockName: string,
  content: string,
): void {
  stmtAppend.run(threadId, blockName, content, Date.now());
}

export function coreMemoryReplace(
  threadId: string,
  blockName: string,
  oldText: string,
  newText: string,
): void {
  const blocks = stmtGet.all(threadId) as CoreMemoryBlock[];
  const block = blocks.find((b) => b.block_name === blockName);
  if (!block) {
    stmtUpsert.run(threadId, blockName, newText, Date.now());
    return;
  }
  const updated = block.content.replace(oldText, newText);
  stmtUpsert.run(threadId, blockName, updated, Date.now());
}

export function formatCoreMemoryForPrompt(threadId: string): string {
  const blocks = getCoreMemoryBlocks(threadId);
  if (blocks.length === 0) return "";

  const sections = blocks
    .filter((b) => b.content.trim().length > 0)
    .map((b) => `<${b.block_name}>\n${b.content}\n</${b.block_name}>`)
    .join("\n");

  if (!sections) return "";
  return `\n<core_memory>\n${sections}\n</core_memory>\n`;
}
