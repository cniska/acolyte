import { describe, expect, test } from "bun:test";
import { configDir, dataDir, resolveHomeDir, stateDir } from "./paths";

describe("resolveHomeDir", () => {
  test("returns HOME when set", () => {
    expect(resolveHomeDir({ HOME: "/tmp/test-home" })).toBe("/tmp/test-home");
  });

  test("falls back to os.homedir when HOME is empty", () => {
    const result = resolveHomeDir({ HOME: "" });
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("macOS paths", () => {
  // These tests only verify behavior on the current platform.
  // On macOS, all dirs collapse to ~/.acolyte.
  test.skipIf(process.platform === "linux")("configDir uses .acolyte", () => {
    expect(configDir({ HOME: "/Users/me" })).toBe("/Users/me/.acolyte");
  });

  test.skipIf(process.platform === "linux")("dataDir uses .acolyte", () => {
    expect(dataDir({ HOME: "/Users/me" })).toBe("/Users/me/.acolyte");
  });

  test.skipIf(process.platform === "linux")("stateDir uses .acolyte", () => {
    expect(stateDir({ HOME: "/Users/me" })).toBe("/Users/me/.acolyte");
  });
});

describe("Linux paths", () => {
  test.skipIf(process.platform !== "linux")("configDir respects XDG_CONFIG_HOME", () => {
    expect(configDir({ HOME: "/home/me", XDG_CONFIG_HOME: "/custom/config" })).toBe("/custom/config/acolyte");
  });

  test.skipIf(process.platform !== "linux")("configDir defaults to ~/.config/acolyte", () => {
    expect(configDir({ HOME: "/home/me" })).toBe("/home/me/.config/acolyte");
  });

  test.skipIf(process.platform !== "linux")("dataDir respects XDG_DATA_HOME", () => {
    expect(dataDir({ HOME: "/home/me", XDG_DATA_HOME: "/custom/data" })).toBe("/custom/data/acolyte");
  });

  test.skipIf(process.platform !== "linux")("dataDir defaults to ~/.local/share/acolyte", () => {
    expect(dataDir({ HOME: "/home/me" })).toBe("/home/me/.local/share/acolyte");
  });

  test.skipIf(process.platform !== "linux")("stateDir respects XDG_STATE_HOME", () => {
    expect(stateDir({ HOME: "/home/me", XDG_STATE_HOME: "/custom/state" })).toBe("/custom/state/acolyte");
  });

  test.skipIf(process.platform !== "linux")("stateDir defaults to ~/.local/state/acolyte", () => {
    expect(stateDir({ HOME: "/home/me" })).toBe("/home/me/.local/state/acolyte");
  });
});
