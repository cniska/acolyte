import { describe, expect, test } from "bun:test";
import { invariant } from "./assert";
import { createInMemoryTaskQueue } from "./task-queue";

describe("task queue", () => {
  test("serializes jobs for the same key", async () => {
    const queue = createInMemoryTaskQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue("sess_test0001", async () => {
      events.push("start-1");
      await firstGate;
      events.push("end-1");
    });
    const second = queue.enqueue("sess_test0001", async () => {
      events.push("start-2");
      events.push("end-2");
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["start-1"]);
    invariant(releaseFirst, "expected release function");
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  test("allows different keys to run independently", async () => {
    const queue = createInMemoryTaskQueue();
    const events: string[] = [];
    let releaseA: (() => void) | undefined;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const a = queue.enqueue("sess_a", async () => {
      events.push("start-a");
      await gateA;
      events.push("end-a");
    });
    const b = queue.enqueue("sess_b", async () => {
      events.push("start-b");
      events.push("end-b");
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toContain("start-a");
    expect(events).toContain("start-b");
    invariant(releaseA, "expected release function");
    releaseA();
    await Promise.all([a, b]);
    expect(events).toContain("end-a");
    expect(events).toContain("end-b");
  });
});
