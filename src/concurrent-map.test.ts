import { describe, expect, test } from "bun:test";
import { concurrentMap } from "./concurrent-map";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("concurrent map", () => {
  test("returns results in the input's order, not completion order", async () => {
    const results = await concurrentMap([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(results).toEqual([30, 10, 20]);
  });

  test("runs every item", async () => {
    const seen: number[] = [];
    await concurrentMap([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  test("keeps no more than the limit in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    await concurrentMap([...Array(20).keys()], 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
    });
    expect(peak).toBe(4);
  });

  test("runs concurrently rather than one at a time", async () => {
    const first = deferred();
    let secondStarted = false;
    const run = concurrentMap([0, 1], 2, async (n) => {
      if (n === 0) return first.promise;
      secondStarted = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    // The second item started while the first was still pending, which a serial loop cannot do.
    expect(secondStarted).toBe(true);
    first.resolve();
    await run;
  });

  test("rejects with the job's error", async () => {
    const boom = new Error("boom");
    await expect(
      concurrentMap([1, 2, 3], 2, async (n) => {
        if (n === 2) throw boom;
      }),
    ).rejects.toThrow("boom");
  });

  test("stops starting work once a job has failed", async () => {
    const started: number[] = [];
    await concurrentMap([...Array(50).keys()], 1, async (n) => {
      started.push(n);
      if (n === 2) throw new Error("boom");
    }).catch(() => {});
    expect(started).toEqual([0, 1, 2]);
  });

  test("waits for in-flight work to settle before rejecting", async () => {
    let slowFinished = false;
    const run = concurrentMap([0, 1], 2, async (n) => {
      if (n === 0) throw new Error("boom");
      await new Promise((r) => setTimeout(r, 10));
      slowFinished = true;
    });
    await expect(run).rejects.toThrow("boom");
    expect(slowFinished).toBe(true);
  });

  test("handles an empty input", async () => {
    expect(await concurrentMap([], 4, async () => 1)).toEqual([]);
  });
});
