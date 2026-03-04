import { describe, it, expect, vi, beforeEach } from "vitest";
import { RequestPool, withRetry } from "../src/agent/request-pool.js";

describe("RequestPool", () => {
  it("executes tasks up to concurrency limit", async () => {
    const pool = new RequestPool(2);
    const order: number[] = [];

    const makeTask = (id: number, delay: number) =>
      pool.enqueue(
        () =>
          new Promise<number>((resolve) => {
            order.push(id);
            setTimeout(() => resolve(id), delay);
          }),
      );

    const results = await Promise.all([makeTask(1, 50), makeTask(2, 50), makeTask(3, 10)]);
    expect(results).toEqual([1, 2, 3]);
  });

  it("reports pending and active correctly", async () => {
    const pool = new RequestPool(1);
    let resolveFirst!: () => void;
    const firstDone = new Promise<void>((r) => {
      resolveFirst = r;
    });

    const p1 = pool.enqueue(() => firstDone);
    pool.enqueue(() => Promise.resolve("b"));

    expect(pool.active).toBe(1);
    expect(pool.pending).toBe(1);

    resolveFirst();
    await p1;
    // Allow microtasks to flush so drain() decrements active
    await new Promise((r) => setTimeout(r, 50));

    expect(pool.active).toBe(0);
    expect(pool.pending).toBe(0);
  });

  it("propagates errors", async () => {
    const pool = new RequestPool(1);
    await expect(pool.enqueue(() => Promise.reject(new Error("fail")))).rejects.toThrow("fail");
  });

  it("continues processing after error", async () => {
    const pool = new RequestPool(1);
    const p1 = pool.enqueue(() => Promise.reject(new Error("err"))).catch(() => "caught");
    const p2 = pool.enqueue(() => Promise.resolve("ok"));
    expect(await p1).toBe("caught");
    expect(await p2).toBe("ok");
  });
});

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const result = await withRetry(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("retries on 429 and eventually succeeds", async () => {
    let attempt = 0;
    const result = await withRetry(async () => {
      attempt++;
      if (attempt < 2) {
        const err = new Error("rate limit") as Error & { status: number };
        err.status = 429;
        throw err;
      }
      return "success";
    }, 3);
    expect(result).toBe("success");
    expect(attempt).toBe(2);
  });

  it("retries on 500 errors", async () => {
    let attempt = 0;
    const result = await withRetry(async () => {
      attempt++;
      if (attempt < 2) {
        const err = new Error("server error") as Error & { status: number };
        err.status = 500;
        throw err;
      }
      return "ok";
    }, 3);
    expect(result).toBe("ok");
  });

  it("does NOT retry on 400 errors", async () => {
    let attempt = 0;
    await expect(
      withRetry(async () => {
        attempt++;
        const err = new Error("bad request") as Error & { status: number };
        err.status = 400;
        throw err;
      }, 3),
    ).rejects.toThrow("bad request");
    expect(attempt).toBe(1);
  });

  it("throws after max retries exhausted", async () => {
    let attempt = 0;
    await expect(
      withRetry(async () => {
        attempt++;
        const err = new Error("overloaded") as Error & { status: number };
        err.status = 503;
        throw err;
      }, 2),
    ).rejects.toThrow("overloaded");
    expect(attempt).toBe(3); // initial + 2 retries
  });
});
