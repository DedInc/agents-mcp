import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MAX_STR } from "../config.js";
import { errResp, renderTemplate } from "../helpers.js";
import { callAgent, formatResult } from "../agent/agent.js";
import { loadPresetFile, parsePreset, listPresetFiles } from "../presets/presets.js";
import { effortEnum, querySchema, promptSchema, parseContextArg } from "./schemas.js";

export async function handleRunPreset(args: {
  query: string; preset: string; model?: string; base_url?: string;
  effort?: string; response_format?: string; thread_id?: string;
  context?: string; vars?: string;
}) {
  const { query, preset, model, base_url, effort, response_format, thread_id, context, vars } = args;

  let text: string;
  try {
    text = await loadPresetFile(preset);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const available = (await listPresetFiles()).map((f) => f.replace(".md", ""));
      const hint = available.length
        ? `Available: ${available.join(", ")}`
        : "No presets yet — use save_preset to create one.";
      return errResp(`Preset '${preset}' not found. ${hint}`);
    }
    throw err;
  }

  const parsed = parsePreset(text);
  let systemPrompt = parsed.system_prompt;
  if (vars) {
    try {
      systemPrompt = renderTemplate(systemPrompt, JSON.parse(vars) as Record<string, string>);
    } catch { return errResp("vars must be a valid JSON object."); }
  }

  const parsedContext = parseContextArg(context);
  if (parsedContext === "error") return errResp("context must be a valid JSON array of messages.");

  const result = await callAgent({
    system_prompt: systemPrompt, query,
    model:           model  ?? parsed.model  ?? "",
    effort:          effort ?? parsed.effort,
    response_format: response_format ?? parsed.response_format,
    base_url:        base_url ?? parsed.api_base ?? "",
    api_key:         parsed.api_key_env ? process.env[parsed.api_key_env] : undefined,
    thread_id, context: parsedContext,
  });
  return formatResult(result);
}

export function registerAgentTools(server: McpServer): void {
  server.registerTool(
    "run_agent",
    {
      description:
        "Invoke any AI agent fully inline — no preset needed. " +
        "Provide a system_prompt defining the agent and a query for it to answer.",
      inputSchema: {
        query:           querySchema,
        system_prompt:   promptSchema,
        model:           z.string().max(256).optional().describe("Model name. Defaults to AGENT_MODEL env var."),
        base_url:        z.string().url().optional().describe("API base URL. Defaults to AGENT_API_BASE env var."),
        effort:          effortEnum.describe("Reasoning effort level. Leave empty for model default."),
        response_format: z.string().max(65536).optional().describe('"json" for JSON mode, or a JSON Schema string for structured output.'),
        thread_id:       z.string().max(256).optional().describe("Thread ID for multi-turn conversation."),
        context:         z.string().max(MAX_STR).optional().describe("JSON array of previous messages [{role, content}]."),
      },
    },
    async ({ query, system_prompt, model, base_url, effort, response_format, thread_id, context }) => {
      try {
        const parsedContext = parseContextArg(context);
        if (parsedContext === "error") return errResp("context must be a valid JSON array of messages.");
        const result = await callAgent({
          system_prompt, query, model: model ?? "", base_url: base_url ?? "",
          effort, response_format, thread_id, context: parsedContext,
        });
        return formatResult(result);
      } catch (err) {
        return errResp(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "run_preset",
    {
      description:
        "Invoke a saved agent preset by name. Use list_presets to see available presets.",
      inputSchema: {
        query:           querySchema,
        preset:          z.string().min(1).max(256).describe("Preset name (filename without .md)."),
        model:           z.string().max(256).optional().describe("Model override."),
        base_url:        z.string().url().optional().describe("API base URL override."),
        effort:          effortEnum.describe("Reasoning effort override."),
        response_format: z.string().max(65536).optional().describe("Override response format."),
        thread_id:       z.string().max(256).optional().describe("Thread ID for multi-turn conversation."),
        context:         z.string().max(MAX_STR).optional().describe("JSON array of previous messages."),
        vars:            z.string().max(MAX_STR).optional().describe('JSON object of template variables for {{var}} placeholders.'),
      },
    },
    async (args) => {
      try { return await handleRunPreset(args); }
      catch (err) { return errResp(err instanceof Error ? err.message : String(err)); }
    },
  );

  server.registerTool(
    "run_pipeline",
    {
      description:
        "Run a sequential pipeline of agent presets. " +
        "The output of each agent becomes context for the next. " +
        "If any agent returns JSON with status:\"failed\", the pipeline stops.",
      inputSchema: {
        presets:   z.string().min(1).max(MAX_STR).describe("JSON array of preset names, e.g. [\"researcher\", \"coder\", \"reviewer\"]."),
        query:     querySchema,
        thread_id: z.string().max(256).optional().describe("Thread ID for the pipeline."),
        vars:      z.string().max(MAX_STR).optional().describe("JSON object of template variables."),
      },
    },
    async ({ presets, query, thread_id, vars }) => {
      try {
        let presetNames: string[];
        try {
          presetNames = JSON.parse(presets);
          if (!Array.isArray(presetNames)) throw new Error("not an array");
        } catch {
          return errResp("presets must be a valid JSON array of preset names.");
        }

        let currentOutput = query;
        const pipelineResults: Array<{ preset: string; output: string }> = [];

        for (const presetName of presetNames) {
          let text: string;
          try {
            text = await loadPresetFile(presetName);
          } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
              return errResp(`Pipeline halted: preset '${presetName}' not found.`);
            }
            throw err;
          }

          const parsed = parsePreset(text);
          let systemPrompt = parsed.system_prompt;
          if (vars) {
            try {
              systemPrompt = renderTemplate(systemPrompt, JSON.parse(vars) as Record<string, string>);
            } catch { /* ignore template errors in pipeline */ }
          }

          const result = await callAgent({
            system_prompt: systemPrompt,
            query: currentOutput,
            model: parsed.model ?? "",
            effort: parsed.effort,
            response_format: parsed.response_format,
            base_url: parsed.api_base ?? "",
            api_key: parsed.api_key_env ? process.env[parsed.api_key_env] : undefined,
            thread_id,
          });

          pipelineResults.push({ preset: presetName, output: result.text });

          try {
            const jsonOut = JSON.parse(result.text);
            if (jsonOut.status === "failed") {
              return errResp(
                `Pipeline halted at '${presetName}': ${jsonOut.message ?? "agent reported failure."}`,
              );
            }
          } catch {
            /* not json, continue */
          }

          currentOutput = result.text;
        }

        const summary = pipelineResults
          .map((r, i) => `## Step ${i + 1}: ${r.preset}\n\n${r.output}`)
          .join("\n\n---\n\n");

        return { content: [{ type: "text" as const, text: summary }] };
      } catch (err) {
        return errResp(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
