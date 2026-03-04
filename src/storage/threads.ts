import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { MAX_THREADS } from "../config.js";
import db from "./db.js";
import { estimateTokens } from "../agent/tokens.js";

const stmtGetThread = db.prepare("SELECT id FROM threads WHERE id = ?");
const stmtUpsertThread = db.prepare(`
  INSERT INTO threads (id, metadata, last_access)
  VALUES (?, '{}', ?)
  ON CONFLICT(id) DO UPDATE SET last_access = excluded.last_access
`);
const stmtGetMessages = db.prepare(
  "SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id ASC",
);
const stmtInsertMessage = db.prepare(
  "INSERT INTO messages (thread_id, role, content, tokens_count, created_at) VALUES (?, ?, ?, ?, ?)",
);
const stmtCountThreads = db.prepare("SELECT COUNT(*) as cnt FROM threads");
const stmtOldestThread = db.prepare("SELECT id FROM threads ORDER BY last_access ASC LIMIT 1");
const stmtDeleteThread = db.prepare("DELETE FROM threads WHERE id = ?");

export function getThread(threadId: string): ChatCompletionMessageParam[] {
  const row = stmtGetThread.get(threadId) as { id: string } | undefined;
  if (!row) return [];

  stmtUpsertThread.run(threadId, Date.now());

  const rows = stmtGetMessages.all(threadId) as Array<{ role: string; content: string }>;
  return rows.map((r) => ({
    role: r.role as "user" | "assistant" | "system",
    content: r.content,
  }));
}

function evictOldest(): void {
  const { cnt } = stmtCountThreads.get() as { cnt: number };
  if (cnt >= MAX_THREADS) {
    const oldest = stmtOldestThread.get() as { id: string } | undefined;
    if (oldest) stmtDeleteThread.run(oldest.id);
  }
}

const saveTransact = db.transaction(
  (threadId: string, messages: ChatCompletionMessageParam[]) => {
    evictOldest();
    const now = Date.now();
    stmtUpsertThread.run(threadId, now);

    const existing = stmtGetMessages.all(threadId) as Array<{ role: string; content: string }>;
    const newMessages = messages.slice(existing.length);

    for (const m of newMessages) {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      const tokens = estimateTokens(content);
      stmtInsertMessage.run(threadId, m.role, content, tokens, now);
    }
  },
);

export function saveThread(
  threadId: string,
  messages: ChatCompletionMessageParam[],
): void {
  saveTransact(threadId, messages);
}
