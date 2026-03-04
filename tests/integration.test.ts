/**
 * Integration tests for agents-mcp against a live OpenAI-compatible API.
 * Uses claude-sonnet-4.6 model ONLY at http://127.0.0.1:3030/v1.
 *
 * Run with: npx vitest run tests/integration.test.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { callAgent, formatResult } from "../src/agent/agent.js";
import { savePresetFile, loadPresetFile, parsePreset, deletePresetFile, listPresetFiles, renderPreset, seedBundledPresets } from "../src/presets/presets.js";
import { handleRunPreset } from "../src/tools/agent-tools.js";
import { ensureDefaultBlocks, coreMemoryAppend, coreMemoryReplace, getCoreMemoryBlocks, formatCoreMemoryForPrompt } from "../src/storage/core-memory.js";
import { getThread, saveThread } from "../src/storage/threads.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

const MODEL = "claude-sonnet-4.6";
const BASE_URL = "http://127.0.0.1:3030/v1";
const TEST_PRESET = `test-preset-${Date.now()}`;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function safeCallAgent(opts: Parameters<typeof callAgent>[0], retries = 5): Promise<Awaited<ReturnType<typeof callAgent>>> {
  for (let i = 0; i < retries; i++) {
    try {
      return await callAgent(opts);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 429 && i < retries - 1) {
        await delay(5000 * (i + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// -- callAgent basics --

it("callAgent: sends a simple query and gets a response", async () => {
  await delay(3000);
  const result = await safeCallAgent({
    system_prompt: "You are a helpful assistant. Reply concisely.",
    query: "What is 2 + 2? Reply with just the number.",
    model: MODEL,
    base_url: BASE_URL,
  });

  expect(result.text).toBeDefined();
  expect(result.text.length).toBeGreaterThan(0);
  expect(result.text).toContain("4");
  expect(result.usage).toBeDefined();
  expect(result.usage!.total_tokens).toBeGreaterThan(0);
});

it("callAgent: formats result with token stats", async () => {
  await delay(3000);
  const result = await safeCallAgent({
    system_prompt: "You are concise.",
    query: "Say hello.",
    model: MODEL,
    base_url: BASE_URL,
  });

  const formatted = formatResult(result);
  expect(formatted.content).toHaveLength(1);
  expect(formatted.content[0].type).toBe("text");
  expect(formatted.content[0].text).toContain("Tokens:");
});

it("callAgent: respects JSON response format", async () => {
  await delay(3000);
  const result = await safeCallAgent({
    system_prompt: "You always respond with valid JSON objects. Never respond with anything else.",
    query: 'Return a JSON object with key "answer" and value 42. Output ONLY the JSON, nothing else.',
    model: MODEL,
    base_url: BASE_URL,
    response_format: "json",
  });

  // Model may wrap in ```json fences; strip them
  const cleaned = result.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const parsed = JSON.parse(cleaned);
  expect(parsed.answer).toBe(42);
});

it("callAgent: respects JSON Schema response format", async () => {
  await delay(3000);
  const schema = JSON.stringify({
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number" },
    },
    required: ["name", "age"],
    additionalProperties: false,
  });

  const result = await safeCallAgent({
    system_prompt: "Return info about a fictional person. Follow the schema exactly.",
    query: 'Create a person named "Alice" who is 30 years old.',
    model: MODEL,
    base_url: BASE_URL,
    response_format: schema,
  });

  const cleaned = result.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const parsed = JSON.parse(cleaned);
  expect(parsed.name).toBe("Alice");
  expect(parsed.age).toBe(30);
});

it("callAgent: handles context messages", async () => {
  await delay(3000);
  const context: ChatCompletionMessageParam[] = [
    { role: "user", content: "My name is TestUser." },
    { role: "assistant", content: "Nice to meet you, TestUser!" },
  ];

  const result = await safeCallAgent({
    system_prompt: "You remember previous context. When asked a question, answer based on the conversation history.",
    query: "What is my name? Reply with just the name, nothing else.",
    model: MODEL,
    base_url: BASE_URL,
    context,
  });

  expect(result.text.toLowerCase()).toContain("testuser");
});

// -- Thread persistence --

const threadId = `thread-persist-${Date.now()}`;

it("thread: maintains conversation across calls", async () => {
  // Seed thread in DB first to avoid FK constraint on ensureDefaultBlocks
  saveThread(threadId, []);

  await delay(3000);
  const r1 = await safeCallAgent({
    system_prompt: "You are a helpful assistant. Remember everything the user tells you. Always respond with text, do not use any tools.",
    query: "My favorite color is indigo. Just say OK.",
    model: MODEL,
    base_url: BASE_URL,
    thread_id: threadId,
  });
  // r1 may be empty if model used internal tools; that's OK

  await delay(3000);
  const r2 = await safeCallAgent({
    system_prompt: "You are a helpful assistant. Remember everything the user tells you. Always respond with text, do not use any tools.",
    query: "What is my favorite color? Reply with ONLY the color name, nothing else.",
    model: MODEL,
    base_url: BASE_URL,
    thread_id: threadId,
  });
  // Check thread has messages stored
  const msgs = getThread(threadId);
  expect(msgs.length).toBeGreaterThanOrEqual(2);
  // The model should recall indigo from thread history
  expect(r2.text.toLowerCase()).toContain("indigo");
});

it("thread: messages stored in SQLite", () => {
  const msgs = getThread(threadId);
  expect(msgs.length).toBeGreaterThanOrEqual(2);
});

// -- Core memory (needs a thread entry first) --

const memThreadId = `mem-test-${Date.now()}`;

it("memory: creates default blocks", () => {
  // Create the thread in the DB first (FK constraint)
  saveThread(memThreadId, [
    { role: "user", content: "init" },
    { role: "assistant", content: "ok" },
  ]);
  ensureDefaultBlocks(memThreadId);
  const blocks = getCoreMemoryBlocks(memThreadId);
  const names = blocks.map((b) => b.block_name);
  expect(names).toContain("user_profile");
  expect(names).toContain("project_context");
  expect(names).toContain("scratchpad");
});

it("memory: appends to block", () => {
  coreMemoryAppend(memThreadId, "user_profile", "Name: TestUser");
  const blocks = getCoreMemoryBlocks(memThreadId);
  const profile = blocks.find((b) => b.block_name === "user_profile");
  expect(profile!.content).toContain("Name: TestUser");
});

it("memory: second append adds newline", () => {
  coreMemoryAppend(memThreadId, "user_profile", "Role: Tester");
  const blocks = getCoreMemoryBlocks(memThreadId);
  const profile = blocks.find((b) => b.block_name === "user_profile");
  expect(profile!.content).toContain("Name: TestUser");
  expect(profile!.content).toContain("Role: Tester");
});

it("memory: replaces in block", () => {
  coreMemoryReplace(memThreadId, "user_profile", "Role: Tester", "Role: Senior Tester");
  const blocks = getCoreMemoryBlocks(memThreadId);
  const profile = blocks.find((b) => b.block_name === "user_profile");
  expect(profile!.content).toContain("Senior Tester");
});

it("memory: formats as XML for prompt injection", () => {
  const formatted = formatCoreMemoryForPrompt(memThreadId);
  expect(formatted).toContain("<core_memory>");
  expect(formatted).toContain("<user_profile>");
  expect(formatted).toContain("Name: TestUser");
});

it("memory: agent reads core memory in system prompt", async () => {
  await delay(3000);
  coreMemoryAppend(memThreadId, "scratchpad", "FAVORITE_FRUIT=mango");

  const result = await safeCallAgent({
    system_prompt: "You have access to core memory blocks injected above. The scratchpad contains the user's preferences. When asked, read the value from the scratchpad and tell the user.",
    query: "What is my favorite fruit according to the scratchpad? Reply with just the fruit name.",
    model: MODEL,
    base_url: BASE_URL,
    thread_id: memThreadId,
  });

  expect(result.text.toLowerCase()).toContain("mango");
});

// -- Presets --

it("presets: seeds bundled", async () => {
  await seedBundledPresets();
  const files = await listPresetFiles();
  expect(files.length).toBeGreaterThanOrEqual(1);
});

it("presets: saves and loads custom", async () => {
  const content = renderPreset({
    name: TEST_PRESET,
    description: "Test preset for integration tests",
    model: MODEL,
    effort: "low",
    system_prompt: "You are a test bot. When the user says anything, reply with exactly the word PONG and nothing else.",
  });

  await savePresetFile(TEST_PRESET, content, true);
  const loaded = await loadPresetFile(TEST_PRESET);
  const parsed = parsePreset(loaded);
  expect(parsed.name).toBe(TEST_PRESET);
  expect(parsed.model).toBe(MODEL);
});

it("presets: runs via handleRunPreset", async () => {
  await delay(3000);
  const result = await handleRunPreset({
    preset: TEST_PRESET,
    query: "Ping!",
    base_url: BASE_URL,
  });

  expect(result.content[0].text.toUpperCase()).toContain("PONG");
});

it("presets: template variables", async () => {
  await delay(3000);
  const varPresetName = `var-preset-${Date.now()}`;
  const content = renderPreset({
    name: varPresetName,
    description: "Variable test",
    model: MODEL,
    system_prompt: 'Your name is {{role}}. When asked to greet, respond with exactly: "Hello from {{role}}!" and nothing else.',
  });
  await savePresetFile(varPresetName, content, true);

  const result = await handleRunPreset({
    preset: varPresetName,
    query: "Greet me now.",
    base_url: BASE_URL,
    vars: JSON.stringify({ role: "AlphaBot" }),
  });

  expect(result.content[0].text).toContain("AlphaBot");
  await deletePresetFile(varPresetName);
});

// -- Error handling --

it("error: invalid base_url scheme", async () => {
  await expect(
    callAgent({
      system_prompt: "test",
      query: "test",
      model: MODEL,
      base_url: "ftp://invalid.com",
    }),
  ).rejects.toThrow("base_url must use http or https");
});

it("error: non-existent preset", async () => {
  const result = await handleRunPreset({
    preset: "nonexistent-preset-" + Date.now(),
    query: "test",
  });
  expect(result.content[0].text).toContain("ERROR:");
  expect(result.content[0].text).toContain("not found");
});

it("error: invalid context JSON", async () => {
  const result = await handleRunPreset({
    preset: TEST_PRESET,
    query: "test",
    context: "invalid json{",
  });
  expect(result.content[0].text).toContain("ERROR:");
});

it("error: invalid vars JSON", async () => {
  const content = renderPreset({
    name: TEST_PRESET,
    description: "Test",
    model: MODEL,
    system_prompt: "Test {{var}}",
  });
  await savePresetFile(TEST_PRESET, content, true);

  const result = await handleRunPreset({
    preset: TEST_PRESET,
    query: "test",
    vars: "not json",
  });
  expect(result.content[0].text).toContain("ERROR:");
});

// -- Sequential calls --

it("stress: handles sequential calls", async () => {
  const results = [];
  for (let i = 0; i < 3; i++) {
    await delay(3000);
    const r = await safeCallAgent({
      system_prompt: "You echo numbers. When given a number, reply with ONLY that same number and nothing else.",
      query: `${i + 1}`,
      model: MODEL,
      base_url: BASE_URL,
    });
    results.push(r.text.trim());
  }
  expect(results).toHaveLength(3);
  results.forEach((r) => expect(r.length).toBeGreaterThan(0));
});

// -- Effort levels --

it("effort: works with effort=low", async () => {
  await delay(3000);
  const result = await safeCallAgent({
    system_prompt: "Be brief.",
    query: "Say hi.",
    model: MODEL,
    base_url: BASE_URL,
    effort: "low",
  });
  expect(result.text.length).toBeGreaterThan(0);
});

it("effort: works with effort=high", async () => {
  await delay(3000);
  const result = await safeCallAgent({
    system_prompt: "You are a math expert. Reply with just the number, nothing else.",
    query: "What is the square root of 144?",
    model: MODEL,
    base_url: BASE_URL,
    effort: "high",
  });
  expect(result.text).toContain("12");
});

// Cleanup
afterAll(async () => {
  try { await deletePresetFile(TEST_PRESET); } catch {}
});
