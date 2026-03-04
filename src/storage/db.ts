import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

const DB_DIR = process.env.AGENTS_MCP_DATA_DIR
  ? path.resolve(process.env.AGENTS_MCP_DATA_DIR)
  : path.join(os.homedir(), ".agents-mcp");

fs.mkdirSync(DB_DIR, { recursive: true });

const DB_PATH = path.join(DB_DIR, "agents-mcp.db");

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS threads (
    id            TEXT PRIMARY KEY,
    metadata      TEXT DEFAULT '{}',
    last_access   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id     TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    role          TEXT NOT NULL,
    content       TEXT NOT NULL DEFAULT '',
    tokens_count  INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, id);

  CREATE TABLE IF NOT EXISTS core_memory_blocks (
    thread_id     TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    block_name    TEXT NOT NULL,
    content       TEXT NOT NULL DEFAULT '',
    updated_at    INTEGER NOT NULL,
    PRIMARY KEY (thread_id, block_name)
  );

  CREATE TABLE IF NOT EXISTS semantic_memory (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id     TEXT NOT NULL,
    content       TEXT NOT NULL,
    embedding     TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_semantic_thread ON semantic_memory(thread_id);
`);

export default db;
export { DB_PATH };
