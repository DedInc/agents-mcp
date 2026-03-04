import { describe, it, expect } from "vitest";
import { parseContextArg } from "../src/tools/schemas.js";

describe("parseContextArg", () => {
  it("returns undefined for undefined input", () => {
    expect(parseContextArg(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseContextArg("")).toBeUndefined();
  });

  it("parses valid JSON array of messages", () => {
    const input = JSON.stringify([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ]);
    const result = parseContextArg(input);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it('returns "error" for invalid JSON', () => {
    expect(parseContextArg("not json")).toBe("error");
  });

  it('returns "error" for malformed JSON', () => {
    expect(parseContextArg("{broken")).toBe("error");
  });
});
