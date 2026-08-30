import { afterEach, describe, expect, test } from "bun:test";
import { loginMode, logoutMode } from "./cli-login";
import { CloudApiError } from "./cloud-client";

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
    migrateToCloud: async () => {
      calls.push("migrateToCloud");
      return { memories: 0, sessions: 0, failures: 0, embeddingFailures: 0 };
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

  test("copies local data with the credentials the login obtained", async () => {
    const targets: string[] = [];
    const { deps } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? "tok_flag" : "https://custom.example.com"),
      migrateToCloud: async (url, token) => {
        targets.push(`${url} ${token}`);
        return { memories: 3, sessions: 2, failures: 0, embeddingFailures: 0 };
      },
    });

    await loginMode([], deps);

    expect(targets).toEqual(["https://custom.example.com tok_flag"]);
  });

  test("reports what the copy moved", async () => {
    const { deps, output } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? "tok_flag" : "https://custom.example.com"),
      migrateToCloud: async () => ({
        memories: 3,
        sessions: 2,
        failures: 0,
        embeddingFailures: 0,
      }),
    });

    await loginMode([], deps);

    expect(output()).toContain("Copied 3 memories and 2 sessions");
  });

  test("names the records a copy left behind", async () => {
    const { deps, output } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? "tok_flag" : "https://custom.example.com"),
      migrateToCloud: async () => ({
        memories: 1,
        sessions: 0,
        failures: 4,
        embeddingFailures: 0,
      }),
    });

    await loginMode([], deps);

    expect(output()).toContain("4 records did not copy");
  });

  test("names the memories that arrived without an embedding", async () => {
    const { deps, output } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? "tok_flag" : "https://custom.example.com"),
      migrateToCloud: async () => ({
        memories: 5,
        sessions: 0,
        failures: 0,
        embeddingFailures: 2,
      }),
    });

    await loginMode([], deps);

    expect(output()).toContain("2 memories arrived without their embedding");
  });

  test("keeps the credentials and fails when the copy fails", async () => {
    const { deps, calls, output } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? "tok_flag" : "https://custom.example.com"),
      migrateToCloud: async () => {
        throw new Error("cloud unreachable");
      },
    });

    await loginMode([], deps);

    expect(calls.filter((call) => call === "writeCredential")).toHaveLength(2);
    expect(process.exitCode).toBe(1);
    expect(output()).toContain("cloud unreachable");
  });

  test("names a rejected token instead of reporting a clean login", async () => {
    const { deps, output } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? "tok_stale" : "https://custom.example.com"),
      migrateToCloud: async () => {
        throw new CloudApiError(401, "unauthorized");
      },
    });

    await loginMode([], deps);

    expect(process.exitCode).toBe(1);
    expect(output()).toContain("rejected the token");
    expect(output()).not.toContain("unauthorized");
  });

  test("copies after an oauth login too", async () => {
    const { deps, calls } = createLoginDeps({ prompt: () => "" });

    await loginMode([], deps);

    expect(calls).toContain("migrateToCloud");
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
