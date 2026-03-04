import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions.js";
import type OpenAI from "openai";
import { ALLOW_CUSTOM_URL, DEFAULT_BASE_URL, DEFAULT_MODEL, REQUEST_TIMEOUT, DEFAULT_CONTEXT_WINDOW } from "../config.js";
import { validateBaseUrl } from "../helpers.js";
import { getClient } from "./client.js";
import { getThread, saveThread } from "../storage/threads.js";
import { estimateTokens, createBudget, trimMessages, type TrimmedMessage } from "./tokens.js";
import { ensureDefaultBlocks, formatCoreMemoryForPrompt, coreMemoryAppend, coreMemoryReplace } from "../storage/core-memory.js";
import { retrieveSemanticContext, storeSemanticMemory } from "../storage/semantic-memory.js";
import { requestPool, withRetry } from "./request-pool.js";

export interface CallAgentOptions {
  system_prompt: string;
  query: string;
  model: string;
  base_url: string;
  effort?: string;
  response_format?: string;
  api_key?: string;
  context?: ChatCompletionMessageParam[];
  thread_id?: string;
  max_context_tokens?: number;
}

export interface CallAgentResult {
  text: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const INTERNAL_MEMORY_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "core_memory_append",
      description: "Append vital information about the user or project to persistent core memory.",
      parameters: {
        type: "object",
        properties: {
          block_name: { type: "string", description: "Memory block name (e.g. user_profile, project_context)." },
          content:    { type: "string", description: "Information to append." },
        },
        required: ["block_name", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "core_memory_replace",
      description: "Replace a substring in a core memory block.",
      parameters: {
        type: "object",
        properties: {
          block_name: { type: "string" },
          old_text:   { type: "string", description: "Exact text to find." },
          new_text:   { type: "string", description: "Replacement text." },
        },
        required: ["block_name", "old_text", "new_text"],
      },
    },
  },
];

function buildMessages(opts: CallAgentOptions, semanticCtx?: string[]): ChatCompletionMessageParam[] {
  const budget = createBudget(opts.max_context_tokens ?? DEFAULT_CONTEXT_WINDOW);
  let systemContent = opts.system_prompt;

  if (opts.thread_id) {
    ensureDefaultBlocks(opts.thread_id);
    const mem = formatCoreMemoryForPrompt(opts.thread_id);
    if (mem) systemContent += "\n" + mem;
  }

  if (semanticCtx?.length) {
    systemContent += `\n<semantic_memory>\n${semanticCtx.join("\n---\n")}\n</semantic_memory>`;
  }

  const systemTokens = estimateTokens(systemContent);
  const trimmedSystem = systemTokens > budget.system ? systemContent.slice(0, budget.system * 4) : systemContent;
  const messages: ChatCompletionMessageParam[] = [{ role: "system", content: trimmedSystem }];
  let usedTokens = Math.min(systemTokens, budget.system);

  const toTrimmed = (m: ChatCompletionMessageParam): TrimmedMessage => {
    const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return { role: m.role, content: c, tokens: estimateTokens(c) };
  };

  if (opts.context?.length) {
    for (const m of trimMessages(opts.context.map(toTrimmed), budget.context)) {
      messages.push({ role: m.role as "user" | "assistant" | "system", content: m.content });
      usedTokens += m.tokens;
    }
  }

  if (opts.thread_id) {
    for (const m of trimMessages(getThread(opts.thread_id).map(toTrimmed), budget.history)) {
      messages.push({ role: m.role as "user" | "assistant" | "system", content: m.content });
      usedTokens += m.tokens;
    }
  }

  const qTokens = estimateTokens(opts.query);
  const remaining = budget.total - usedTokens - budget.reserve;
  messages.push({ role: "user", content: qTokens > remaining && remaining > 0 ? opts.query.slice(0, remaining * 4) : opts.query });
  return messages;
}

function buildRequestBody(
  model: string, messages: ChatCompletionMessageParam[], effort?: string, response_format?: string,
): OpenAI.ChatCompletionCreateParamsNonStreaming {
  const body: OpenAI.ChatCompletionCreateParamsNonStreaming = {
    model: model || DEFAULT_MODEL,
    messages,
    stream: false,
    ...(effort ? { reasoning_effort: effort as never } : {}),
  };
  if (response_format === "json") {
    body.response_format = { type: "json_object" };
  } else if (response_format && response_format !== "text") {
    try {
      body.response_format = { type: "json_schema", json_schema: { name: "response", schema: JSON.parse(response_format), strict: true } } as never;
    } catch { body.response_format = { type: "json_object" }; }
  }
  return body;
}

function dispatchToolCall(threadId: string, name: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson) as Record<string, string>;
    if (name === "core_memory_append") {
      coreMemoryAppend(threadId, args["block_name"] ?? "", args["content"] ?? "");
      return "Memory appended.";
    }
    if (name === "core_memory_replace") {
      coreMemoryReplace(threadId, args["block_name"] ?? "", args["old_text"] ?? "", args["new_text"] ?? "");
      return "Memory updated.";
    }
    return "Unknown tool.";
  } catch { return "Tool error."; }
}

export async function callAgent(opts: CallAgentOptions): Promise<CallAgentResult> {
  const { model, base_url, effort, response_format, api_key, query, thread_id } = opts;

  if (!ALLOW_CUSTOM_URL && base_url && base_url !== DEFAULT_BASE_URL)
    throw new Error("Custom base_url is disabled. Set AGENT_ALLOW_CUSTOM_BASE_URL=true to enable.");

  const resolvedUrl = base_url ? validateBaseUrl(base_url) : DEFAULT_BASE_URL;
  const client = getClient(resolvedUrl, api_key);

  const semanticCtx = thread_id ? await retrieveSemanticContext(thread_id, query) : [];
  const messages = buildMessages(opts, semanticCtx);
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  const MAX_STEPS = thread_id ? 3 : 1;
  let finalText = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const body = buildRequestBody(model, messages, effort, response_format);
    if (thread_id) body.tools = INTERNAL_MEMORY_TOOLS;

    const resp = await requestPool.enqueue(() =>
      withRetry(() => client.chat.completions.create(body, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) })),
    );

    if (resp.usage) {
      usage.prompt_tokens     += resp.usage.prompt_tokens;
      usage.completion_tokens += resp.usage.completion_tokens;
    }

    const msg = resp.choices[0]?.message;
    if (!msg) break;

    if (msg.tool_calls?.length && thread_id) {
      messages.push(msg as ChatCompletionMessageParam);
      for (const tc of msg.tool_calls) {
        const result = dispatchToolCall(thread_id, tc.function.name, tc.function.arguments);
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
      continue;
    }

    finalText = msg.content ?? "";
    break;
  }

  // If the loop exhausted all steps on tool calls without producing text,
  // make one final request without tools to force a text response.
  if (!finalText && thread_id) {
    const body = buildRequestBody(model, messages, effort, response_format);
    const resp = await requestPool.enqueue(() =>
      withRetry(() => client.chat.completions.create(body, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) })),
    );
    if (resp.usage) {
      usage.prompt_tokens     += resp.usage.prompt_tokens;
      usage.completion_tokens += resp.usage.completion_tokens;
    }
    const msg = resp.choices[0]?.message;
    if (msg?.content) finalText = msg.content;
  }

  usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
  console.error(`agents-mcp [${model || DEFAULT_MODEL}]: ${usage.prompt_tokens}→${usage.completion_tokens} tokens`);

  if (thread_id) {
    const history = [...getThread(thread_id)];
    history.push({ role: "user", content: query }, { role: "assistant", content: finalText });
    saveThread(thread_id, history);
    void storeSemanticMemory(thread_id, `Q: ${query}\nA: ${finalText}`);
  }

  return { text: finalText, usage };
}

export function formatResult(result: CallAgentResult): { content: Array<{ type: "text"; text: string }> } {
  let text = result.text;
  if (result.usage) {
    text += `\n\n---\n_Tokens: ${result.usage.prompt_tokens} prompt + ${result.usage.completion_tokens} completion = ${result.usage.total_tokens} total_`;
  }
  return { content: [{ type: "text" as const, text }] };
}
