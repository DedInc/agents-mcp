import db from "./db.js";
import { getClient } from "../agent/client.js";
import { DEFAULT_EMBEDDING_BASE, DEFAULT_EMBEDDING_KEY, DEFAULT_EMBEDDING_MODEL } from "../config.js";

const stmtInsert  = db.prepare("INSERT INTO semantic_memory (thread_id, content, embedding, created_at) VALUES (?, ?, ?, ?)");
const stmtFetch   = db.prepare("SELECT content, embedding FROM semantic_memory WHERE thread_id = ?");

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

async function embed(text: string): Promise<number[]> {
  const client = getClient(DEFAULT_EMBEDDING_BASE, DEFAULT_EMBEDDING_KEY);
  const resp = await client.embeddings.create({ model: DEFAULT_EMBEDDING_MODEL, input: text });
  return resp.data[0].embedding;
}

export async function storeSemanticMemory(threadId: string, content: string): Promise<void> {
  try {
    const vector = await embed(content);
    stmtInsert.run(threadId, content, JSON.stringify(vector), Date.now());
  } catch {
    // Silently skip — embedding endpoint may not support embeddings
  }
}

export async function retrieveSemanticContext(threadId: string, query: string, topK = 3): Promise<string[]> {
  try {
    const rows = stmtFetch.all(threadId) as Array<{ content: string; embedding: string }>;
    if (rows.length === 0) return [];
    const queryVec = await embed(query);
    return rows
      .map((r) => ({ content: r.content, score: cosineSimilarity(queryVec, JSON.parse(r.embedding) as number[]) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((r) => r.content);
  } catch {
    return [];
  }
}
