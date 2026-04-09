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
  const env = { HOME: "/Users/me" };

  test("configDir uses .acolyte", () => {
    expect(configDir(env, "darwin")).toBe("/Users/me/.acolyte");
  });

  test("dataDir uses .acolyte", () => {
    expect(dataDir(env, "darwin")).toBe("/Users/me/.acolyte");
  });

  test("stateDir uses .acolyte", () => {
    expect(stateDir(env, "darwin")).toBe("/Users/me/.acolyte");
  });
});

describe("Linux paths", () => {
  test("configDir respects XDG_CONFIG_HOME", () => {
    expect(configDir({ HOME: "/home/me", XDG_CONFIG_HOME: "/custom/config" }, "linux")).toBe("/custom/config/acolyte");
  });

  test("configDir defaults to ~/.config/acolyte", () => {
    expect(configDir({ HOME: "/home/me" }, "linux")).toBe("/home/me/.config/acolyte");
  });

  test("dataDir respects XDG_DATA_HOME", () => {
    expect(dataDir({ HOME: "/home/me", XDG_DATA_HOME: "/custom/data" }, "linux")).toBe("/custom/data/acolyte");
  });

  test("dataDir defaults to ~/.local/share/acolyte", () => {
    expect(dataDir({ HOME: "/home/me" }, "linux")).toBe("/home/me/.local/share/acolyte");
  });

  test("stateDir respects XDG_STATE_HOME", () => {
    expect(stateDir({ HOME: "/home/me", XDG_STATE_HOME: "/custom/state" }, "linux")).toBe("/custom/state/acolyte");
  });

  test("stateDir defaults to ~/.local/state/acolyte", () => {
    expect(stateDir({ HOME: "/home/me" }, "linux")).toBe("/home/me/.local/state/acolyte");
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
