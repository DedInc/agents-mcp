# @maehdakvan/agents-mcp

An MCP (Model Context Protocol) server for invoking AI agents via OpenAI-compatible APIs. It allows you to run agents with custom system prompts, models, and queries. Agent presets are stored locally as plain Markdown files.

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
| `AGENT_ALLOW_CUSTOM_BASE_URL` | `true` | Set to `false` to prevent callers from overriding the base URL. |
| `PRESETS_DIR` | `~/.agents-mcp/presets` | Directory where agent presets are stored. |

## Tools

- `run_agent`: Execute an agent inline by providing a `system_prompt` and `query`. Optional parameters: `model`, `base_url`, `effort`.
- `run_preset`: Execute a saved agent preset by `name` and provide a `query`. Optional overrides: `model`, `base_url`, `effort`.
- `save_preset`: Save a new agent preset. Requires `name` and `system_prompt`. Optional: `description`, `model`, `effort`, `inputs_required`, `inputs_optional`, `outputs`, `overwrite`.
- `list_presets`: Returns a list of all saved presets and their metadata.
- `delete_preset`: Delete a preset by `name`.

## Resources

- `agents://presets/{name}`: Read the raw markdown content of a saved preset.

## Presets

Presets are stored as Markdown files in the `PRESETS_DIR`. They support YAML frontmatter for metadata. On the first run, bundled presets are copied to this directory without overwriting existing files.

### Agents have no file access

Agents invoked via `run_agent` or `run_preset` are stateless LLM calls — they receive only what is passed in `system_prompt` and `query`. They cannot read files, browse the filesystem, or call tools.

This means **the calling client** (you, or the primary AI assistant orchestrating the call) is responsible for gathering the relevant context and including it in `query`. For example, before calling `oracle` for a code audit, read the files yourself and paste their contents into the query.

**Important:** Because models call these agents, the `description` field of each preset is primarily written for the calling LLM, not for humans. It should contain crucial instructions and notes that help the orchestrating agent understand exactly what context is expected and how to use the preset effectively.

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
