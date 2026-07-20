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

describe("XDG paths", () => {
  test("macOS and Linux share the same default configDir", () => {
    const env = { HOME: "/Users/me" };
    expect(configDir(env, "darwin")).toBe("/Users/me/.config/acolyte");
    expect(configDir(env, "linux")).toBe("/Users/me/.config/acolyte");
  });

  test("macOS and Linux share the same default dataDir", () => {
    const env = { HOME: "/Users/me" };
    expect(dataDir(env, "darwin")).toBe("/Users/me/.local/share/acolyte");
    expect(dataDir(env, "linux")).toBe("/Users/me/.local/share/acolyte");
  });

  test("macOS and Linux share the same default stateDir", () => {
    const env = { HOME: "/Users/me" };
    expect(stateDir(env, "darwin")).toBe("/Users/me/.local/state/acolyte");
    expect(stateDir(env, "linux")).toBe("/Users/me/.local/state/acolyte");
  });

  test("configDir respects XDG_CONFIG_HOME", () => {
    expect(configDir({ HOME: "/home/me", XDG_CONFIG_HOME: "/custom/config" }, "darwin")).toBe("/custom/config/acolyte");
  });

  test("dataDir respects XDG_DATA_HOME", () => {
    expect(dataDir({ HOME: "/home/me", XDG_DATA_HOME: "/custom/data" }, "darwin")).toBe("/custom/data/acolyte");
  });

  test("stateDir respects XDG_STATE_HOME", () => {
    expect(stateDir({ HOME: "/home/me", XDG_STATE_HOME: "/custom/state" }, "darwin")).toBe("/custom/state/acolyte");
  });

  test("ignores relative XDG_CONFIG_HOME per spec", () => {
    expect(configDir({ HOME: "/home/me", XDG_CONFIG_HOME: "relative/path" }, "linux")).toBe("/home/me/.config/acolyte");
  });

  test("ignores relative XDG_DATA_HOME per spec", () => {
    expect(dataDir({ HOME: "/home/me", XDG_DATA_HOME: "relative/path" }, "linux")).toBe(
      "/home/me/.local/share/acolyte",
    );
  });

  test("ignores relative XDG_STATE_HOME per spec", () => {
    expect(stateDir({ HOME: "/home/me", XDG_STATE_HOME: "relative/path" }, "linux")).toBe(
      "/home/me/.local/state/acolyte",
    );
  });
});
