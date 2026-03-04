import { describe, it, expect } from "vitest";
import { estimateTokens, createBudget, trimMessages, type TrimmedMessage } from "../src/agent/tokens.js";

describe("estimateTokens", () => {
  it("returns a positive number for non-empty text", () => {
    const tokens = estimateTokens("Hello, world!");
    expect(tokens).toBeGreaterThan(0);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("longer text has more tokens", () => {
    const short = estimateTokens("hi");
    const long = estimateTokens("This is a much longer sentence with many words in it.");
    expect(long).toBeGreaterThan(short);
  });

  it("handles unicode text", () => {
    const tokens = estimateTokens("こんにちは世界");
    expect(tokens).toBeGreaterThan(0);
  });
});

describe("createBudget", () => {
  it("allocates correct percentages", () => {
    const budget = createBudget(100_000);
    expect(budget.total).toBe(100_000);
    expect(budget.system).toBe(20_000);
    expect(budget.context).toBe(20_000);
    expect(budget.history).toBe(50_000);
    expect(budget.reserve).toBe(10_000);
  });

  it("floors fractional values", () => {
    const budget = createBudget(7);
    expect(budget.system).toBe(1);
    expect(budget.context).toBe(1);
    expect(budget.history).toBe(3);
    expect(budget.reserve).toBe(0);
  });

  it("handles zero", () => {
    const budget = createBudget(0);
    expect(budget.total).toBe(0);
    expect(budget.system).toBe(0);
  });
});

describe("trimMessages", () => {
  const makeMsg = (content: string, tokens: number): TrimmedMessage => ({
    role: "user",
    content,
    tokens,
  });

  it("returns all messages when within budget", () => {
    const msgs = [makeMsg("a", 10), makeMsg("b", 10)];
    const result = trimMessages(msgs, 100);
    expect(result).toHaveLength(2);
  });

  it("trims from the front (keeps most recent)", () => {
    const msgs = [makeMsg("old", 50), makeMsg("mid", 50), makeMsg("new", 50)];
    const result = trimMessages(msgs, 60);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("new");
  });

  it("returns empty when budget is 0", () => {
    const msgs = [makeMsg("a", 10)];
    const result = trimMessages(msgs, 0);
    expect(result).toHaveLength(0);
  });

  it("handles empty message array", () => {
    expect(trimMessages([], 100)).toEqual([]);
  });

  it("trims to fit exactly at budget boundary", () => {
    const msgs = [makeMsg("a", 30), makeMsg("b", 30), makeMsg("c", 30)];
    const result = trimMessages(msgs, 60);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("b");
    expect(result[1].content).toBe("c");
  });
});
