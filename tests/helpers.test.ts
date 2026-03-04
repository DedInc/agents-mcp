import { describe, it, expect } from "vitest";
import { safeFilename, validateBaseUrl, renderTemplate, errResp } from "../src/helpers.js";

describe("safeFilename", () => {
  it("lowercases and replaces special chars with underscores", () => {
    expect(safeFilename("My Preset!")).toBe("my_preset_");
  });

  it("keeps valid chars (alphanumeric, underscore, hyphen)", () => {
    expect(safeFilename("valid-name_123")).toBe("valid-name_123");
  });

  it("trims whitespace", () => {
    expect(safeFilename("  hello  ")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(safeFilename("")).toBe("");
  });

  it("replaces dots and slashes", () => {
    expect(safeFilename("../../etc/passwd")).toBe("______etc_passwd");
  });
});

describe("validateBaseUrl", () => {
  it("accepts http URLs", () => {
    expect(validateBaseUrl("http://localhost:3030/v1")).toBe("http://localhost:3030/v1");
  });

  it("accepts https URLs", () => {
    expect(validateBaseUrl("https://api.openai.com/v1")).toBe("https://api.openai.com/v1");
  });

  it("rejects ftp URLs", () => {
    expect(() => validateBaseUrl("ftp://example.com")).toThrow("base_url must use http or https");
  });

  it("rejects invalid URLs", () => {
    expect(() => validateBaseUrl("not-a-url")).toThrow("base_url is not a valid URL");
  });

  it("rejects empty string", () => {
    expect(() => validateBaseUrl("")).toThrow("base_url is not a valid URL");
  });

  it("rejects file:// scheme", () => {
    expect(() => validateBaseUrl("file:///etc/passwd")).toThrow("base_url must use http or https");
  });
});

describe("renderTemplate", () => {
  it("replaces {{var}} placeholders", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("replaces multiple placeholders", () => {
    const result = renderTemplate("{{a}} + {{b}} = {{c}}", { a: "1", b: "2", c: "3" });
    expect(result).toBe("1 + 2 = 3");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(renderTemplate("Hello {{unknown}}!", {})).toBe("Hello {{unknown}}!");
  });

  it("handles empty template", () => {
    expect(renderTemplate("", { x: "y" })).toBe("");
  });

  it("handles empty vars", () => {
    expect(renderTemplate("no vars here", {})).toBe("no vars here");
  });

  it("replaces same placeholder multiple times", () => {
    expect(renderTemplate("{{x}} and {{x}}", { x: "A" })).toBe("A and A");
  });
});

describe("errResp", () => {
  it("returns MCP error format", () => {
    const resp = errResp("something broke");
    expect(resp).toEqual({
      content: [{ type: "text", text: "ERROR: something broke" }],
    });
  });
});
