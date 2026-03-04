import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MAX_STR } from "../config.js";
import { errResp } from "../helpers.js";
import { coreMemoryAppend, coreMemoryReplace, getCoreMemoryBlocks } from "../storage/core-memory.js";

export function registerMemoryTools(server: McpServer): void {
  server.registerTool(
    "core_memory_append",
    {
      description:
        "Append content to an agent's core memory block. " +
        "Core memory persists across sessions and is injected into the system prompt.",
      inputSchema: {
        thread_id:  z.string().min(1).max(256).describe("Thread ID whose memory to modify."),
        block_name: z.string().min(1).max(64).describe("Memory block name (e.g. user_profile, project_context, scratchpad)."),
        content:    z.string().min(1).max(MAX_STR).describe("Content to append to the block."),
      },
    },
    async ({ thread_id, block_name, content }) => {
      try {
        coreMemoryAppend(thread_id, block_name, content);
        return { content: [{ type: "text" as const, text: `Appended to ${block_name} in thread ${thread_id}.` }] };
      } catch (err) {
        return errResp(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "core_memory_replace",
    {
      description:
        "Replace content in an agent's core memory block. " +
        "Finds old_text and replaces it with new_text.",
      inputSchema: {
        thread_id:  z.string().min(1).max(256).describe("Thread ID whose memory to modify."),
        block_name: z.string().min(1).max(64).describe("Memory block name."),
        old_text:   z.string().min(1).max(MAX_STR).describe("Text to find and replace."),
        new_text:   z.string().max(MAX_STR).describe("Replacement text."),
      },
    },
    async ({ thread_id, block_name, old_text, new_text }) => {
      try {
        coreMemoryReplace(thread_id, block_name, old_text, new_text);
        return { content: [{ type: "text" as const, text: `Replaced in ${block_name} in thread ${thread_id}.` }] };
      } catch (err) {
        return errResp(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "core_memory_read",
    {
      description: "Read all core memory blocks for a thread.",
      inputSchema: {
        thread_id: z.string().min(1).max(256).describe("Thread ID to read memory from."),
      },
    },
    async ({ thread_id }) => {
      try {
        const blocks = getCoreMemoryBlocks(thread_id);
        const result = blocks.reduce(
          (acc, b) => ({ ...acc, [b.block_name]: b.content }),
          {} as Record<string, string>,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errResp(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
