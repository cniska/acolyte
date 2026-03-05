import { afterEach, describe, expect, test } from "bun:test";
import type { DistillRecord } from "./memory-contract";
import { createFileDistillStore } from "./memory-distill-store";
import { tempDir } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

describe("createFileDistillStore", () => {
  test("list returns empty for nonexistent session", async () => {
    const home = createDir("acolyte-distill-");
    const store = createFileDistillStore(home);
    const records = await store.list("sess_nonexistent");
    expect(records).toEqual([]);
  });

  test("write + list round-trips a record", async () => {
    const home = createDir("acolyte-distill-");
    const store = createFileDistillStore(home);
    const record: DistillRecord = {
      id: "dst_test001",
      sessionId: "sess_abc123",
      tier: "observation",
      content: "project uses Bun, not Node",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 7,
    };
    await store.write(record);
    const records = await store.list("sess_abc123");
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(record);
  });

  test("list returns records sorted chronologically", async () => {
    const home = createDir("acolyte-distill-");
    const store = createFileDistillStore(home);
    const older: DistillRecord = {
      id: "dst_older001",
      sessionId: "sess_abc123",
      tier: "observation",
      content: "first observation",
      createdAt: "2026-03-04T10:00:00.000Z",
      tokenEstimate: 3,
    };
    const newer: DistillRecord = {
      id: "dst_newer001",
      sessionId: "sess_abc123",
      tier: "observation",
      content: "second observation",
      createdAt: "2026-03-04T11:00:00.000Z",
      tokenEstimate: 3,
    };
    await store.write(newer);
    await store.write(older);
    const records = await store.list("sess_abc123");
    expect(records[0]?.content).toBe("first observation");
    expect(records[1]?.content).toBe("second observation");
  });

  test("list isolates sessions", async () => {
    const home = createDir("acolyte-distill-");
    const store = createFileDistillStore(home);
    const record1: DistillRecord = {
      id: "dst_sess1rec",
      sessionId: "sess_session1",
      tier: "observation",
      content: "session 1 fact",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 4,
    };
    const record2: DistillRecord = {
      id: "dst_sess2rec",
      sessionId: "sess_session2",
      tier: "observation",
      content: "session 2 fact",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 4,
    };
    await store.write(record1);
    await store.write(record2);
    const s1 = await store.list("sess_session1");
    const s2 = await store.list("sess_session2");
    expect(s1).toHaveLength(1);
    expect(s1[0]?.content).toBe("session 1 fact");
    expect(s2).toHaveLength(1);
    expect(s2[0]?.content).toBe("session 2 fact");
  });

  test("ignores invalid JSON files", async () => {
    const home = createDir("acolyte-distill-");
    const store = createFileDistillStore(home);
    const record: DistillRecord = {
      id: "dst_valid001",
      sessionId: "sess_abc123",
      tier: "observation",
      content: "valid record",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 3,
    };
    await store.write(record);

    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(home, ".acolyte", "distill", "sess_abc123");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "dst_broken.json"), "not valid json", "utf8");

    const records = await store.list("sess_abc123");
    expect(records).toHaveLength(1);
    expect(records[0]?.content).toBe("valid record");
  });

  test("ignores unsafe session ids", async () => {
    const home = createDir("acolyte-distill-");
    const store = createFileDistillStore(home);
    const records = await store.list("../escape");
    expect(records).toEqual([]);

    const invalidSessionRecord: DistillRecord = {
      id: "dst_invalid01",
      sessionId: "../escape",
      tier: "observation",
      content: "should not be written",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 3,
    };
    await store.write(invalidSessionRecord);
    const stillEmpty = await store.list("../escape");
    expect(stillEmpty).toEqual([]);
  });

  test("write does not leave temp files behind", async () => {
    const home = createDir("acolyte-distill-");
    const store = createFileDistillStore(home);
    const record: DistillRecord = {
      id: "dst_temp001",
      sessionId: "sess_abc123",
      tier: "observation",
      content: "temp test",
      createdAt: "2026-03-04T12:00:00.000Z",
      tokenEstimate: 2,
    };
    await store.write(record);
    const { readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(home, ".acolyte", "distill", "sess_abc123");
    const names = readdirSync(dir);
    expect(names.some((name) => name.includes(".tmp-"))).toBe(false);
  });
});
