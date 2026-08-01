import { describe, expect, test } from "bun:test";
import { compareSemver, resolveAssetName, stopServersForUpdate } from "./cli-update";

describe("compareSemver", () => {
  test("returns true when latest is newer (patch)", () => {
    expect(compareSemver("0.12.0", "0.12.1")).toBe(true);
  });

  test("returns true when latest is newer (minor)", () => {
    expect(compareSemver("0.12.0", "0.13.0")).toBe(true);
  });

  test("returns true when latest is newer (major)", () => {
    expect(compareSemver("0.12.0", "1.0.0")).toBe(true);
  });

  test("returns false when versions are equal", () => {
    expect(compareSemver("0.12.0", "0.12.0")).toBe(false);
  });

  test("returns false when current is newer", () => {
    expect(compareSemver("0.13.0", "0.12.0")).toBe(false);
  });

  test("handles v prefix on latest", () => {
    expect(compareSemver("0.12.0", "v0.13.0")).toBe(true);
  });

  test("handles v prefix on current", () => {
    expect(compareSemver("v0.12.0", "0.13.0")).toBe(true);
  });
});

describe("resolveAssetName", () => {
  test("returns a valid asset name", () => {
    const name = resolveAssetName();
    expect(name).toMatch(/^acolyte-(darwin|linux)-(arm64|x64)\.tar\.gz$/);
  });
});

describe("stopServersForUpdate", () => {
  test("never forces, so an update cannot abandon another client's turn", async () => {
    const calls: Array<{ force?: boolean } | undefined> = [];

    await stopServersForUpdate({
      stop: async (input) => {
        calls.push(input);
        return [];
      },
      notify: () => {},
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.force ?? false).toBe(false);
  });

  test("reports the daemon it left running rather than passing over it silently", async () => {
    const notices: string[] = [];

    await stopServersForUpdate({
      stop: async () => [{ port: 6767, result: { kind: "refused", tasks: [{ taskId: "task_abc", sessionId: null }] } }],
      notify: (message) => notices.push(message),
    });

    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("acolyte restart");
  });

  // Regression: a daemon that would not die was invisible here, so an update re-execed while the
  // old server was still running and said nothing.
  test("reports a daemon that would not stop", async () => {
    const notices: string[] = [];

    await stopServersForUpdate({
      stop: async () => [{ port: 6767, result: { kind: "unresponsive" } }],
      notify: (message) => notices.push(message),
    });

    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("acolyte ps");
  });

  test("stays quiet when every daemon stopped", async () => {
    const notices: string[] = [];

    await stopServersForUpdate({
      stop: async () => [{ port: 6767, result: { kind: "stopped", pid: 1234 } }],
      notify: (message) => notices.push(message),
    });

    expect(notices).toEqual([]);
  });
});
