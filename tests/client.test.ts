import { describe, it, expect, beforeEach } from "vitest";
import { getClient } from "../src/agent/client.js";

describe("getClient (LRU cache)", () => {
  it("returns an OpenAI client instance", () => {
    const client = getClient("http://localhost:3030/v1", "test-key");
    expect(client).toBeDefined();
    expect(typeof client.chat.completions.create).toBe("function");
  });

  it("returns the same instance for the same base_url + key", () => {
    const c1 = getClient("http://localhost:9999/v1", "key-a");
    const c2 = getClient("http://localhost:9999/v1", "key-a");
    expect(c1).toBe(c2);
  });

  it("returns different instances for different keys", () => {
    const c1 = getClient("http://localhost:9999/v1", "key-1");
    const c2 = getClient("http://localhost:9999/v1", "key-2");
    expect(c1).not.toBe(c2);
  });

  it("returns different instances for different base urls", () => {
    const c1 = getClient("http://a.com/v1", "same-key");
    const c2 = getClient("http://b.com/v1", "same-key");
    expect(c1).not.toBe(c2);
  });
});
