# @maehdakvan/agents-mcp

An MCP (Model Context Protocol) server for invoking AI agents via OpenAI-compatible APIs. It allows you to run agents with custom system prompts, models, and queries. Agent presets are stored locally as plain Markdown files. Conversations and memory persist in SQLite so agents can maintain context across sessions.

## Why use this?

This server allows your primary AI assistant (e.g., Claude in Cursor or Claude Desktop) to delegate specific tasks to other specialized models. It helps bypass single-model chat restrictions and context limits. For example, you can use Claude for general chat, but ask it to run a deep code audit using `gpt-5.3-codex` with `xhigh` effort, or query Gemini for specific knowledge.

It works with any OpenAI-compatible API, meaning you can connect it to local servers (LM Studio, Ollama, vLLM, Kiro, Antigravity) or cloud providers and API bridges (OpenAI, Groq, Together AI, Copilot API Bridge).

## Configuration

Add the server to your MCP client configuration (e.g., Claude Desktop, Cursor, VS Code):

```json
{
  "mcpServers": {
    "agents-mcp": {
      "command": "npx",
      "args": ["-y", "@maehdakvan/agents-mcp"],
      "env": {
        "AGENT_API_BASE": "http://127.0.0.1:3030/v1",
        "AGENT_API_KEY": "optional",
        "AGENT_MODEL": "gpt-5.3-codex"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AGENT_API_BASE` | `http://127.0.0.1:3030/v1` | Base URL for the OpenAI-compatible API. |
| `AGENT_API_KEY` | `optional` | API key for the endpoint. |
| `AGENT_MODEL` | `gpt-5.3-codex` | Default model to use if not specified in the request. |
| `AGENT_TIMEOUT_MS` | `300000` | Request timeout in milliseconds. |
| `AGENT_ALLOW_CUSTOM_BASE_URL` | `true` | Set to `false` to prevent callers from overriding the base URL (SSRF guard). |
| `AGENT_CONTEXT_WINDOW` | `128000` | Token budget for context window management. |
| `AGENT_MAX_CONCURRENT` | `10` | Maximum number of concurrent in-flight API requests. |
| `PRESETS_DIR` | `~/.agents-mcp/presets` | Directory where agent presets are stored. |
| `AGENT_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model for semantic vector memory. |
| `AGENT_EMBEDDING_BASE` | `https://api.openai.com/v1` | Base URL for the embedding endpoint (independent from `AGENT_API_BASE`). |
| `AGENT_EMBEDDING_KEY` | Falls back to `AGENT_API_KEY` | API key for the embedding endpoint. |
| `AGENTS_MCP_DATA_DIR` | `~/.agents-mcp` | Directory for the SQLite database (`agents-mcp.db`). |

## Tools

### `run_agent`

Invoke any AI agent fully inline — no preset needed. Provide a `system_prompt` defining the agent and a `query` for it to answer.

| Parameter | Required | Description |
|---|---|---|
| `query` | ✅ | The user's request / task. |
| `system_prompt` | ✅ | Full system prompt defining the agent's identity and rules. |
| `model` | | Model name. Defaults to `AGENT_MODEL` env var. |
| `base_url` | | API base URL. Defaults to `AGENT_API_BASE` env var. |
| `effort` | | Reasoning effort level: `low`, `medium`, `high`, `xhigh`. |
| `response_format` | | `"json"` for JSON mode, or a JSON Schema string for structured output. |
| `thread_id` | | Thread ID for multi-turn conversation. |
| `context` | | JSON array of previous messages `[{role, content}]`. |

### `run_preset`

Invoke a saved agent preset by name.

| Parameter | Required | Description |
|---|---|---|
| `query` | ✅ | The user's request / task. |
| `preset` | ✅ | Preset name (filename without `.md`). |
| `model` | | Model override. |
| `base_url` | | API base URL override. |
| `effort` | | Reasoning effort override: `low`, `medium`, `high`, `xhigh`. |
| `response_format` | | Override response format. |
| `thread_id` | | Thread ID for multi-turn conversation. |
| `context` | | JSON array of previous messages. |
| `vars` | | JSON object of template variables for `{{var}}` placeholders in the system prompt. |

### `run_pipeline`

Run a sequential chain of presets where the output of each step is automatically passed as the `query` to the next. Useful for multi-stage workflows (e.g., research → draft → review).

| Parameter | Required | Description |
|---|---|---|
| `presets` | ✅ | JSON array of preset names to run in order, e.g. `["researcher", "writer", "reviewer"]`. |
| `query` | ✅ | The initial input fed into the first preset. |
| `thread_id` | | Shared thread ID passed to every step in the chain. |
| `vars` | | JSON object of template variables applied to all presets in the chain. |

If any step returns a JSON object with `{ "status": "failed" }`, the pipeline halts immediately and surfaces an error. Otherwise, output is a markdown document with each step's result under a `## Step N: preset_name` heading.

### `run_swarm`

Run a non-linear agent swarm using the Supervisor pattern. A Supervisor preset dynamically routes tasks to Worker presets until it decides the goal is complete (`FINISH`). Use `run_pipeline` for simple sequential chains; use `run_swarm` for adaptive multi-agent workflows where the execution path is not known in advance.

| Parameter | Required | Description |
|---|---|---|
| `query` | ✅ | Initial goal or task for the swarm. |
| `supervisor_preset` | ✅ | Preset name for the Supervisor agent (must return JSON with `next_agent` and `task_for_agent`). |
| `worker_presets` | ✅ | JSON array of worker preset names, e.g. `["researcher", "coder"]`. |
| `max_turns` | | Max routing turns before forced stop (default 10, max 20). |
| `thread_id` | | Shared thread ID for all agents in the swarm. |

The Supervisor receives the current state and available worker names, and must return `{"next_agent": "<name or FINISH>", "task_for_agent": "..."}`. When `next_agent` is `"FINISH"`, the swarm stops and returns the final result along with an execution log of all turns.

### `save_preset`

Save or update an agent preset as a `.md` file.

| Parameter | Required | Description |
|---|---|---|
| `name` | ✅ | Preset name, e.g. `"oracle"`. |
| `system_prompt` | ✅ | Full system prompt defining the agent. |
| `description` | | Short one-line description. |
| `model` | | Recommended model. |
| `effort` | | Recommended reasoning effort: `low`, `medium`, `high`, `xhigh`. |
| `inputs_required` | | Comma-separated required inputs. |
| `inputs_optional` | | Comma-separated optional inputs. |
| `outputs` | | Output format description. |
| `response_format` | | Response format setting. |
| `api_base` | | API base URL for this preset. |
| `api_key_env` | | Environment variable name for the API key. |
| `overwrite` | | Set `true` to overwrite an existing preset. |

### `list_presets`

Returns a list of all saved presets and their metadata.

### `delete_preset`

Delete a preset by `name`.

### `core_memory_append`

Append text to a named memory block for a thread. Memory blocks persist to SQLite and are automatically injected into the system prompt on every subsequent call for that thread.

| Parameter | Required | Description |
|---|---|---|
| `thread_id` | ✅ | The thread these memories belong to. |
| `block_name` | ✅ | Name of the memory block (e.g. `user_profile`, `project_context`, `scratchpad`). |
| `content` | ✅ | Text to append. |

### `core_memory_replace`

Find and replace text within a named memory block for a thread.

| Parameter | Required | Description |
|---|---|---|
| `thread_id` | ✅ | The thread these memories belong to. |
| `block_name` | ✅ | Name of the memory block to edit. |
| `old_text` | ✅ | The exact text to find. |
| `new_text` | ✅ | The replacement text. |

### `core_memory_read`

Read all memory blocks for a thread. Returns a JSON object `{ block_name: content }`.

| Parameter | Required | Description |
|---|---|---|
| `thread_id` | ✅ | The thread to read memory for. |

## Resources

- `agents://presets/{name}`: Read the raw markdown content of a saved preset.

## Presets

Presets are stored as Markdown files in the `PRESETS_DIR`. They support YAML frontmatter for metadata. On the first run, bundled presets are copied to this directory without overwriting existing files.

### Agents have no file access

Agents invoked via `run_agent` or `run_preset` are stateless LLM calls — they receive only what is passed in `system_prompt` and `query`. They cannot read files, browse the filesystem, or call tools.

This means **the calling client** (you, or the primary AI assistant orchestrating the call) is responsible for gathering the relevant context and including it in `query`. For example, before calling `oracle` for a code audit, read the files yourself and paste their contents into the query.

**Important:** Because models call these agents, the `description` field of each preset is primarily written for the calling LLM, not for humans. It should contain crucial instructions and notes that help the orchestrating agent understand exactly what context is expected and how to use the preset effectively.

### Autonomous Memory (Letta Pattern)

When a `thread_id` is provided, agents can autonomously manage their own memory without explicit calls from the MCP client. Internally, `callAgent` runs a ReAct loop (max 3 iterations) where the LLM is given two internal tools: `core_memory_append` and `core_memory_replace`. If the model decides that information is worth remembering, it emits a tool call, the server executes it against SQLite, and the loop continues until the model produces a final text response. The client only sees the final answer — intermediate tool turns are invisible.

### Semantic Vector Memory

Each stateful response is automatically embedded and stored in a `semantic_memory` SQLite table. On subsequent calls, the user's query is embedded and compared against stored memories using cosine similarity (computed in pure JS — no native vector DB dependencies). The top-3 most relevant memories are injected into the system prompt inside `<semantic_memory>` tags, giving the agent long-term recall beyond the sliding context window.

This feature requires the `AGENT_EMBEDDING_BASE` endpoint to support the `/embeddings` route. If it doesn't, embedding silently fails and agents continue without semantic recall.

### Multi-turn Conversations

Agents support multi-turn conversations via the `thread_id` parameter. When you pass a `thread_id`, the server persists the full message history in SQLite and automatically includes it in subsequent calls. Up to 64 threads are retained (LRU eviction). You can also pass a `context` parameter with an explicit JSON array of messages `[{role, content}]` for manual history injection.

### Persistent Core Memory

Each thread has three default named memory blocks — `user_profile`, `project_context`, and `scratchpad` — that survive across sessions. On every agent call with a `thread_id`, non-empty blocks are rendered as structured XML and injected into the system prompt automatically:

```xml
<core_memory>
  <user_profile>...</user_profile>
  <project_context>...</project_context>
  <scratchpad>...</scratchpad>
</core_memory>
```

Use `core_memory_append` and `core_memory_replace` to keep these blocks current. Read them back at any time with `core_memory_read`. You can create additional named blocks beyond the three defaults.

### Token Budget Management

The server automatically manages context window usage to stay within the configured `AGENT_CONTEXT_WINDOW` limit (default 128K tokens). Budget is allocated across message categories:

| Category | Allocation |
|---|---|
| System prompt | 20% |
| Injected context | 20% |
| Thread history | 50% |
| Reserve | 10% |

When a request would exceed the budget, the oldest messages are trimmed first (recency-first). Token counts use BPE tokenization via `js-tiktoken` (`o200k_base` encoding) for accuracy, with a `ceil(chars / 4)` fallback if the encoder is unavailable.

### Concurrency & Retry

Outgoing API requests go through a shared request pool with a configurable concurrency cap (`AGENT_MAX_CONCURRENT`, default 10). Requests beyond the limit are queued. Failed requests are automatically retried up to 3 times on HTTP 429 (rate limit) and 5xx errors, with exponential backoff and 50% random jitter.

### Template Variables

Preset system prompts can contain `{{var}}` placeholders. When calling `run_preset` or `run_pipeline`, pass a `vars` JSON object to substitute them at runtime. Unmatched placeholders are left as-is.

### Bundled Presets

The server comes with a few built-in presets to get you started:
- `oracle`: Deep code audits, architecture planning, root-cause debugging. Paste the relevant source files and error messages into `query`.
- `readme-writer`: Rewrites README files to sound like a real human developer. Paste the existing README and a short project description into `query`.

### Frontmatter Configuration

You can flexibly configure each preset by defining parameters in the YAML frontmatter. These parameters act as both execution defaults and metadata for the LLM client.

| Parameter | Description |
|---|---|
| `description` | A short description of the agent. **Crucial:** This is read by the calling LLM. Include important notes on how/when to use the agent and what context it needs. |
| `model` | The specific model to use for this preset (e.g., `gpt-4o`, `o3-mini`). Overrides the `AGENT_MODEL` environment variable. |
| `effort` | Reasoning effort level (`low`, `medium`, `high`, `xhigh`). Directly translates to `reasoning_effort` for models that support it (e.g., `o1`, `o3-mini`, `gpt-5.3-codex`). |
| `inputs_required` | Comma-separated list of required input parameters (e.g., `query`). Acts as documentation for the calling LLM. |
| `inputs_optional` | Comma-separated list of optional input parameters (e.g., `model, effort, base_url`). |
| `outputs` | A short description of what the agent returns (e.g., `JSON array of vulnerabilities`). Helps the calling LLM understand the expected response format. |
| `response_format` | `"json"` for JSON mode, or a JSON Schema string for structured output. |
| `api_base` | API base URL for this preset. Overrides `AGENT_API_BASE`. |
| `api_key_env` | Name of an environment variable containing the API key for this preset (e.g., `OPENAI_API_KEY`). |

**Parameter Resolution Order:**
When invoking a preset via `run_preset`, execution parameters (`model`, `effort`) are resolved in the following order of precedence:
1. Explicit arguments passed to the `run_preset` tool.
2. Frontmatter values defined in the preset's `.md` file.
3. Environment variable defaults (e.g., `AGENT_MODEL`).

Example `~/.agents-mcp/presets/code-reviewer.md`:

```markdown
---
description: Strict TypeScript code reviewer. NOTE: agent has no file access — paste all relevant code, configs, and error messages directly into query.
model: gpt-4o
effort: high
inputs_required: query
---
# code-reviewer

You are a strict TypeScript reviewer. Focus on type safety, edge cases, and security.
```

Legacy format (without frontmatter) is also supported, where the first line is `# name` and the second line is `> description`.

## Development

```bash
npm install
npm run dev     # Run with tsx
npm run build   # Compile to dist/
npm run lint    # Run ESLint
```
