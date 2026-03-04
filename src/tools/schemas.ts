import { z } from "zod";
import { MAX_STR } from "../config.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

export const effortEnum   = z.enum(["low", "medium", "high", "xhigh"]).optional();
export const querySchema  = z.string().min(1).max(MAX_STR).describe("The user's request / task.");
export const promptSchema = z.string().min(1).max(MAX_STR).describe("Full system prompt defining the agent's identity and rules.");

export function parseContextArg(context?: string): ChatCompletionMessageParam[] | undefined | "error" {
  if (!context) return undefined;
  try { return JSON.parse(context); } catch { return "error"; }
}
