import { describe, it, expect } from "vitest";
import { parsePreset, renderPreset, type PresetMeta } from "../src/presets/presets.js";

describe("parsePreset", () => {
  it("parses frontmatter + heading + body", () => {
    const text = `---
description: A test preset
model: gpt-4
effort: high
---
# Test Preset

You are a test agent.`;

    const result = parsePreset(text);
    expect(result.name).toBe("Test Preset");
    expect(result.description).toBe("A test preset");
    expect(result.model).toBe("gpt-4");
    expect(result.effort).toBe("high");
    expect(result.system_prompt).toBe("You are a test agent.");
  });

  it("parses legacy format (heading + blockquote description)", () => {
    const text = `# My Agent
> Does cool things

System prompt here.`;

    const result = parsePreset(text);
    expect(result.name).toBe("My Agent");
    expect(result.description).toBe("Does cool things");
    expect(result.system_prompt).toBe("System prompt here.");
  });

  it("handles no frontmatter, no description", () => {
    const text = `# Simple
Just a prompt.`;

    const result = parsePreset(text);
    expect(result.name).toBe("Simple");
    expect(result.description).toBe("");
    expect(result.system_prompt).toBe("Just a prompt.");
  });

  it("handles empty text", () => {
    const result = parsePreset("");
    expect(result.name).toBe("");
    expect(result.system_prompt).toBe("");
  });

  it("parses all frontmatter fields", () => {
    const text = `---
description: desc
model: m
effort: low
inputs_required: query
inputs_optional: context
outputs: markdown
response_format: json
api_base: http://localhost
api_key_env: MY_KEY
---
# Full

Prompt body.`;

    const result = parsePreset(text);
    expect(result.inputs_required).toBe("query");
    expect(result.inputs_optional).toBe("context");
    expect(result.outputs).toBe("markdown");
    expect(result.response_format).toBe("json");
    expect(result.api_base).toBe("http://localhost");
    expect(result.api_key_env).toBe("MY_KEY");
  });
});

describe("renderPreset", () => {
  it("renders with frontmatter", () => {
    const preset: PresetMeta = {
      name: "Test",
      description: "A test",
      model: "gpt-4",
      effort: "high",
      system_prompt: "You are a test agent.",
    };

    const text = renderPreset(preset);
    expect(text).toContain("---");
    expect(text).toContain("description: A test");
    expect(text).toContain("model: gpt-4");
    expect(text).toContain("# Test");
    expect(text).toContain("You are a test agent.");
  });

  it("renders without frontmatter when no optional fields", () => {
    const preset: PresetMeta = {
      name: "Minimal",
      description: "",
      system_prompt: "Just a prompt.",
    };

    const text = renderPreset(preset);
    expect(text).not.toContain("---");
    expect(text).toContain("# Minimal");
    expect(text).toContain("Just a prompt.");
  });

  it("roundtrips: render then parse preserves data", () => {
    const original: PresetMeta = {
      name: "Roundtrip",
      description: "Test roundtrip",
      model: "claude-sonnet-4-6",
      effort: "medium",
      system_prompt: "You are helpful.",
    };

    const rendered = renderPreset(original);
    const parsed = parsePreset(rendered);

    expect(parsed.name).toBe(original.name);
    expect(parsed.description).toBe(original.description);
    expect(parsed.model).toBe(original.model);
    expect(parsed.effort).toBe(original.effort);
    expect(parsed.system_prompt).toBe(original.system_prompt);
  });
});
