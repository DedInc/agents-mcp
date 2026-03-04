import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MAX_STR } from "../config.js";
import { errResp } from "../helpers.js";
import { handleRunPreset } from "./agent-tools.js";

const MAX_SWARM_TURNS = 20;

function extractText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? "";
}

function isError(text: string): boolean {
  return text.startsWith("ERROR:");
}

async function runSupervisorTurn(
  supervisorPreset: string,
  workers: string[],
  state: string,
): Promise<{ next_agent: string; task_for_agent: string } | null> {
  const prompt =
    `Available workers: ${workers.join(", ")}.\n` +
    `Current state:\n${state}\n\n` +
    `Return ONLY valid JSON: {"next_agent":"<name or FINISH>","task_for_agent":"<instruction>"}`;

  const res = await handleRunPreset({ preset: supervisorPreset, query: prompt, response_format: "json" });
  const text = extractText(res);
  if (isError(text)) return null;
  try { return JSON.parse(text) as { next_agent: string; task_for_agent: string }; } catch { return null; }
}

export function registerSwarmTools(server: McpServer): void {
  server.registerTool(
    "run_swarm",
    {
      description:
        "Run a non-linear agent swarm. A Supervisor preset dynamically routes tasks to Worker presets " +
        "until it decides the goal is complete (returns FINISH). " +
        "Use run_pipeline for simple sequential chains; use run_swarm for adaptive multi-agent workflows.",
      inputSchema: {
        query:             z.string().min(1).max(MAX_STR).describe("Initial goal or task for the swarm."),
        supervisor_preset: z.string().min(1).max(256).describe("Preset name for the Supervisor agent."),
        worker_presets:    z.string().min(1).max(MAX_STR).describe('JSON array of worker preset names, e.g. ["researcher","coder"].'),
        max_turns:         z.number().int().min(1).max(MAX_SWARM_TURNS).default(10).describe("Max routing turns before forced stop."),
        thread_id:         z.string().max(256).optional().describe("Shared thread ID for all agents in the swarm."),
      },
    },
    async ({ query, supervisor_preset, worker_presets, max_turns, thread_id }) => {
      try {
        let workers: string[];
        try {
          workers = JSON.parse(worker_presets) as string[];
          if (!Array.isArray(workers) || workers.some((w) => typeof w !== "string"))
            return errResp("worker_presets must be a JSON array of strings.");
        } catch { return errResp("worker_presets must be valid JSON."); }

        let state = query;
        const history: string[] = [];
        const limit = Math.min(max_turns, MAX_SWARM_TURNS);

        for (let turn = 1; turn <= limit; turn++) {
          const decision = await runSupervisorTurn(supervisor_preset, workers, state);
          if (!decision) return errResp(`Swarm halted: Supervisor returned invalid JSON at turn ${turn}.`);

          if (decision.next_agent === "FINISH") {
            const summary = history.length
              ? `## Swarm Complete\n\n${decision.task_for_agent}\n\n---\n### Execution Log\n${history.join("\n")}`
              : decision.task_for_agent;
            return { content: [{ type: "text" as const, text: summary }] };
          }

          if (!workers.includes(decision.next_agent))
            return errResp(`Supervisor chose unknown worker '${decision.next_agent}'. Valid: ${workers.join(", ")}`);

          const workerRes = await handleRunPreset({ preset: decision.next_agent, query: decision.task_for_agent, thread_id });
          const output = extractText(workerRes);
          history.push(`**Turn ${turn} — ${decision.next_agent}**\nTask: ${decision.task_for_agent}\nResult: ${output}`);
          state = `[Turn ${turn}] ${decision.next_agent} result:\n${output}`;
        }

        return errResp(`Swarm exceeded ${limit} turns without finishing.`);
      } catch (err) {
        return errResp(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
