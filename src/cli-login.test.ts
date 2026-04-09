import { afterEach, describe, expect, test } from "bun:test";
import { loginMode, logoutMode } from "./cli-login";

afterEach(() => {
  process.exitCode = 0;
});

type LoginDeps = Parameters<typeof loginMode>[1];
type LogoutDeps = Parameters<typeof logoutMode>[1];

function createLoginDeps(overrides?: Partial<LoginDeps>): { deps: LoginDeps; output: () => string; calls: string[] } {
  const lines: string[] = [];
  const calls: string[] = [];
  const deps: LoginDeps = {
    hasHelpFlag: () => false,
    parseFlag: () => undefined,
    prompt: () => null,
    printDim: (message) => lines.push(message),
    printError: (message) => lines.push(message),
    promptHidden: async () => undefined,
    writeCredential: async () => {
      calls.push("writeCredential");
    },
    commandError: (name) => {
      calls.push(`commandError:${name}`);
    },
    commandHelp: (name) => {
      calls.push(`commandHelp:${name}`);
    },
    createId: () => "test_state",
    startCallbackServer: async () => ({
      port: 9999,
      result: Promise.resolve({ token: "tok_oauth", email: "test@example.com" }),
    }),
    openBrowser: () => {
      calls.push("openBrowser");
    },
    ...overrides,
  };
  return { deps, output: () => lines.join("\n"), calls };
}

function createLogoutDeps(overrides?: Partial<LogoutDeps>): {
  deps: LogoutDeps;
  output: () => string;
  calls: string[];
} {
  const lines: string[] = [];
  const calls: string[] = [];
  const deps: LogoutDeps = {
    hasHelpFlag: () => false,
    printDim: (message) => lines.push(message),
    removeCredential: async () => {
      calls.push("removeCredential");
    },
    commandError: (name) => {
      calls.push(`commandError:${name}`);
    },
    commandHelp: (name) => {
      calls.push(`commandHelp:${name}`);
    },
    ...overrides,
  };
  return { deps, output: () => lines.join("\n"), calls };
}

describe("loginMode", () => {
  test("help flag calls commandHelp", async () => {
    const { deps, calls } = createLoginDeps({ hasHelpFlag: () => true });
    await loginMode(["--help"], deps);
    expect(calls).toEqual(["commandHelp:login"]);
  });

  test("flags bypass oauth and store directly", async () => {
    const flags: Record<string, string> = { "--token": "tok_flag", "--url": "https://cloud.example.com" };
    const { deps, calls, output } = createLoginDeps({ parseFlag: (_args, flag) => flags[flag] });
    await loginMode(["--token", "tok_flag", "--url", "https://cloud.example.com"], deps);
    expect(calls.filter((c) => c === "writeCredential")).toHaveLength(2);
    expect(calls).not.toContain("openBrowser");
    expect(output()).toContain("Logged in");
  });

  test("default url triggers oauth flow", async () => {
    const { deps, calls, output } = createLoginDeps({
      prompt: () => "",
    });
    await loginMode([], deps);
    expect(calls).toContain("openBrowser");
    expect(calls.filter((c) => c === "writeCredential")).toHaveLength(2);
    expect(output()).toContain("test@example.com");
  });

  test("custom url falls back to manual token", async () => {
    const { deps, calls, output } = createLoginDeps({
      prompt: () => "https://custom.example.com",
      promptHidden: async () => "tok_manual",
    });
    await loginMode([], deps);
    expect(calls).not.toContain("openBrowser");
    expect(calls.filter((c) => c === "writeCredential")).toHaveLength(2);
    expect(output()).toContain("Logged in");
  });

  test("custom url with empty token sets exit code", async () => {
    const { deps, output } = createLoginDeps({
      prompt: () => "https://custom.example.com",
      promptHidden: async () => undefined,
    });
    await loginMode([], deps);
    expect(process.exitCode).toBe(1);
    expect(output()).toContain("empty");
  });

  test("oauth timeout sets exit code", async () => {
    const { deps, output } = createLoginDeps({
      prompt: () => "",
      startCallbackServer: async () => ({
        port: 9999,
        result: Promise.reject(new Error("timeout")),
      }),
    });
    await loginMode([], deps);
    expect(process.exitCode).toBe(1);
    expect(output()).toContain("timed out");
  });
});

describe("logoutMode", () => {
  test("help flag calls commandHelp", async () => {
    const { deps, calls } = createLogoutDeps({ hasHelpFlag: () => true });
    await logoutMode(["--help"], deps);
    expect(calls).toEqual(["commandHelp:logout"]);
  });

  test("extra args calls commandError", async () => {
    const { deps, calls } = createLogoutDeps();
    await logoutMode(["extra"], deps);
    expect(calls).toEqual(["commandError:logout"]);
  });

  test("removes both credentials and confirms", async () => {
    const { deps, calls, output } = createLogoutDeps();
    await logoutMode([], deps);
    expect(calls.filter((c) => c === "removeCredential")).toHaveLength(2);
    expect(output()).toContain("Logged out");
  });
});
