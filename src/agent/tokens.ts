import { getEncoding, type Tiktoken } from "js-tiktoken";

let _enc: Tiktoken | null = null;
function getEnc(): Tiktoken | null {
  if (_enc) return _enc;
  try { _enc = getEncoding("o200k_base"); return _enc; } catch { return null; }
}

export function estimateTokens(text: string): number {
  const enc = getEnc();
  return enc ? enc.encode(text).length : Math.ceil(text.length / 4);
}

export interface TokenBudget {
  total: number;
  system: number;
  context: number;
  history: number;
  reserve: number;
}

export function createBudget(totalTokens: number): TokenBudget {
  return {
    total:   totalTokens,
    system:  Math.floor(totalTokens * 0.2),
    context: Math.floor(totalTokens * 0.2),
    history: Math.floor(totalTokens * 0.5),
    reserve: Math.floor(totalTokens * 0.1),
  };
}

export interface TrimmedMessage {
  role: string;
  content: string;
  tokens: number;
}

export function trimMessages(messages: TrimmedMessage[], budgetTokens: number): TrimmedMessage[] {
  let totalTokens = 0;
  for (const m of messages) totalTokens += m.tokens;
  if (totalTokens <= budgetTokens) return messages;

  const trimmed: TrimmedMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (used + m.tokens > budgetTokens) break;
    trimmed.unshift(m);
    used += m.tokens;
  }
  return trimmed;
}
