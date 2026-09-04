import { afterEach, describe, expect, test } from "bun:test";
import { loginMode, logoutMode } from "./cli-login";
import { CloudApiError } from "./cloud-client";
import { CodedError } from "./coded-error";
import { LOGIN_ERROR_CODES } from "./error-contract";
import { userResourceIdForSubject } from "./resource-id";

const SUBJECT = "012627e3-1df9-476a-919d-f208a6bb9830";
const ACCOUNT_KEY = userResourceIdForSubject(SUBJECT);

/** A token in the shape the cloud mints, so login can read the account out of it. */
function tokenFor(sub: string | undefined): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "EdDSA" })}.${part(sub ? { sub, scope: "user" } : { scope: "user" })}.c2ln`;
}

const TOKEN = tokenFor(SUBJECT);
const REFRESH_TOKEN = "refresh-token";

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
    writeCredential: async (key) => {
      calls.push(`writeCredential:${key}`);
    },
    removeCredential: async (key) => {
      calls.push(`removeCredential:${key}`);
    },
    checkCloudCredential: async () => {
      calls.push("checkCloudCredential");
    },
    commandError: (name) => {
      calls.push(`commandError:${name}`);
    },
    commandHelp: (name) => {
      calls.push(`commandHelp:${name}`);
    },
    createId: () => "test_state",
    createVerifier: () => "test_verifier",
    exchangeAuthCode: async () => {
      calls.push("exchangeAuthCode");
      return { token: TOKEN, refresh: REFRESH_TOKEN, email: "test@example.com" };
    },
    startCallbackServer: async () => ({
      port: 9999,
      result: Promise.resolve({ code: "code_1" }),
    }),
    openBrowser: () => {
      calls.push("openBrowser");
    },
    migrateToCloud: async () => {
      calls.push("migrateToCloud");
      return { memories: 0, sessions: 0, failures: 0, embeddingFailures: 0 };
    },
    mergeUserScope: async () => {
      calls.push("mergeUserScope");
      return { merged: 0, duplicates: 0, failures: 0, embeddingFailures: 0 };
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
    removeCredential: async (key) => {
      calls.push(`removeCredential:${key}`);
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
    const flags: Record<string, string> = { "--token": TOKEN, "--url": "https://cloud.example.com" };
    const { deps, calls, output } = createLoginDeps({ parseFlag: (_args, flag) => flags[flag] });
    await loginMode(["--token", TOKEN, "--url", "https://cloud.example.com"], deps);
    expect(calls).toContain("writeCredential:cloudToken");
    expect(calls).toContain("writeCredential:cloudUrl");
    expect(calls).not.toContain("openBrowser");
    expect(output()).toContain("Logged in");
  });

  test("default url triggers oauth flow", async () => {
    const { deps, calls, output } = createLoginDeps({
      prompt: () => "",
    });
    await loginMode([], deps);
    expect(calls).toContain("openBrowser");
    expect(calls).toContain("writeCredential:cloudToken");
    expect(calls).toContain("writeCredential:cloudUrl");
    expect(output()).toContain("test@example.com");
  });

  test("the oauth handoff stores the refresh token the browser returned", async () => {
    const { deps, calls } = createLoginDeps({ prompt: () => "" });

    await loginMode([], deps);

    expect(calls).toContain("writeCredential:cloudRefreshToken");
    expect(calls).not.toContain("removeCredential:cloudRefreshToken");
  });

  test("a hand-pasted token drops the refresh token of the account it replaces", async () => {
    const { deps, calls } = createLoginDeps({
      prompt: () => "https://custom.example.com",
      promptHidden: async () => TOKEN,
    });

    await loginMode([], deps);

    expect(calls).toContain("removeCredential:cloudRefreshToken");
    expect(calls).not.toContain("writeCredential:cloudRefreshToken");
  });

  test("custom url falls back to manual token", async () => {
    const { deps, calls, output } = createLoginDeps({
      prompt: () => "https://custom.example.com",
      promptHidden: async () => TOKEN,
    });
    await loginMode([], deps);
    expect(calls).not.toContain("openBrowser");
    expect(calls).toContain("writeCredential:cloudToken");
    expect(calls).toContain("writeCredential:cloudUrl");
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

  test("a cloud too old for the code handoff says so instead of timing out", async () => {
    const { deps, calls, output } = createLoginDeps({
      prompt: () => "",
      startCallbackServer: async () => ({
        port: 9999,
        result: Promise.reject(new CodedError(LOGIN_ERROR_CODES.codeMissing, "no code")),
      }),
    });

    await loginMode([], deps);

    expect(output()).toContain("predates the current sign-in");
    expect(output()).not.toContain("timed out");
    expect(calls.some((call) => call.startsWith("writeCredential"))).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  test("a cloud with no exchange route says so", async () => {
    const { deps, output } = createLoginDeps({
      prompt: () => "",
      exchangeAuthCode: async () => {
        throw new CodedError(LOGIN_ERROR_CODES.exchangeUnsupported, "no exchange");
      },
    });

    await loginMode([], deps);

    expect(output()).toContain("predates the current sign-in");
    expect(process.exitCode).toBe(1);
  });

  test("an exchange the cloud turns down is reported as a refusal, not a timeout", async () => {
    const { deps, calls, output } = createLoginDeps({
      prompt: () => "",
      exchangeAuthCode: async () => {
        throw new CodedError(LOGIN_ERROR_CODES.exchangeRefused, "refused");
      },
    });

    await loginMode([], deps);

    expect(output()).toContain("refused this sign-in");
    expect(calls.some((call) => call.startsWith("writeCredential"))).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  test("the handoff carries a challenge, and the verifier never leaves the process", async () => {
    let authUrl = "";
    const { deps } = createLoginDeps({
      prompt: () => "",
      openBrowser: (url: string) => {
        authUrl = url;
      },
    });

    await loginMode([], deps);

    expect(authUrl).toContain("challenge=");
    expect(authUrl).not.toContain("test_verifier");
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

  test("refuses a plaintext cloud url before storing anything", async () => {
    const { deps, calls, output } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? TOKEN : "http://cloud.example.com"),
    });

    await loginMode([], deps);

    expect(calls.some((call) => call.startsWith("writeCredential"))).toBe(false);
    expect(calls).not.toContain("migrateToCloud");
    expect(process.exitCode).toBe(1);
    expect(output()).toContain("must use HTTPS");
  });

  test("allows a plaintext cloud url on localhost", async () => {
    const { deps, calls } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? TOKEN : "http://localhost:3000"),
    });

    await loginMode([], deps);

    expect(calls).toContain("writeCredential:cloudToken");
    expect(calls).toContain("writeCredential:cloudUrl");
    expect(process.exitCode).toBe(0);
  });

  test("refuses a token that names no account, before storing anything", async () => {
    const { deps, calls, output } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? tokenFor(undefined) : "https://custom.example.com"),
    });

    await loginMode([], deps);

    expect(calls.some((call) => call.startsWith("writeCredential"))).toBe(false);
    expect(calls).not.toContain("migrateToCloud");
    expect(calls).not.toContain("mergeUserScope");
    expect(process.exitCode).toBe(1);
    expect(output()).toContain("does not name an account");
  });

  test("refuses a token the cloud rejects, before storing anything", async () => {
    const { deps, calls, output } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? TOKEN : "https://custom.example.com"),
      checkCloudCredential: async () => {
        throw new CloudApiError(401, "unauthorized");
      },
    });

    await loginMode([], deps);

    expect(calls.some((call) => call.startsWith("writeCredential"))).toBe(false);
    expect(calls).not.toContain("migrateToCloud");
    expect(calls).not.toContain("mergeUserScope");
    expect(process.exitCode).toBe(1);
    expect(output()).toContain("refused that token");
  });

  test("stores nothing when the token cannot be checked", async () => {
    const { deps, calls, output } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? TOKEN : "https://custom.example.com"),
      checkCloudCredential: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });

    await loginMode([], deps);

    expect(calls.some((call) => call.startsWith("writeCredential"))).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(output()).toContain("ECONNREFUSED");
  });

  test("checks the token before it is stored", async () => {
    const { deps, calls } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? TOKEN : "https://custom.example.com"),
    });

    await loginMode([], deps);

    expect(calls.indexOf("checkCloudCredential")).toBeLessThan(calls.indexOf("writeCredential:cloudToken"));
  });

  test("merges the local user scope into the account after the copy", async () => {
    const order: string[] = [];
    const targets: string[] = [];
    const { deps, output } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? TOKEN : "https://custom.example.com"),
      migrateToCloud: async () => {
        order.push("copy");
        return { memories: 1, sessions: 0, failures: 0, embeddingFailures: 0 };
      },
      mergeUserScope: async (url, token, accountKey) => {
        order.push("merge");
        targets.push(`${url} ${token} ${accountKey}`);
        return { merged: 7, duplicates: 2, failures: 0, embeddingFailures: 0 };
      },
    });

    await loginMode([], deps);

    expect(order).toEqual(["copy", "merge"]);
    expect(targets).toEqual([`https://custom.example.com ${TOKEN} ${ACCOUNT_KEY}`]);
    expect(output()).toContain("Merged 7 local memories into your account.");
    expect(output()).toContain("2 were already in your account.");
  });

  test("reports the merge even when it moved nothing", async () => {
    const { deps, output } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? TOKEN : "https://custom.example.com"),
    });

    await loginMode([], deps);

    expect(output()).toContain("Merged 0 local memories into your account.");
  });

  test("reports a refused credential when the merge is the call that hits it", async () => {
    const { deps, output } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? TOKEN : "https://custom.example.com"),
      mergeUserScope: async () => {
        throw new CloudApiError(401, "unauthorized");
      },
    });

    await loginMode([], deps);

    expect(process.exitCode).toBe(1);
    expect(output()).toContain("rejected the token");
  });

  test("copies local data with the credentials the login obtained", async () => {
    const targets: string[] = [];
    const { deps } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? TOKEN : "https://custom.example.com"),
      migrateToCloud: async (url, token) => {
        targets.push(`${url} ${token}`);
        return { memories: 3, sessions: 2, failures: 0, embeddingFailures: 0 };
      },
    });

    await loginMode([], deps);

    expect(targets).toEqual([`https://custom.example.com ${TOKEN}`]);
  });

  test("reports what the copy moved", async () => {
    const { deps, output } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? TOKEN : "https://custom.example.com"),
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
      parseFlag: (_args, flag) => (flag === "--token" ? TOKEN : "https://custom.example.com"),
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
      parseFlag: (_args, flag) => (flag === "--token" ? TOKEN : "https://custom.example.com"),
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
      parseFlag: (_args, flag) => (flag === "--token" ? TOKEN : "https://custom.example.com"),
      migrateToCloud: async () => {
        throw new Error("cloud unreachable");
      },
    });

    await loginMode([], deps);

    expect(calls).toContain("writeCredential:cloudToken");
    expect(calls).toContain("writeCredential:cloudUrl");
    expect(process.exitCode).toBe(1);
    expect(output()).toContain("cloud unreachable");
  });

  test("names a rejected token instead of reporting a clean login", async () => {
    const { deps, output } = createLoginDeps({
      parseFlag: (_args, flag) => (flag === "--token" ? TOKEN : "https://custom.example.com"),
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

  test("removes every stored cloud credential and confirms", async () => {
    const { deps, calls, output } = createLogoutDeps();
    await logoutMode([], deps);
    expect(calls).toEqual([
      "removeCredential:cloudToken",
      "removeCredential:cloudRefreshToken",
      "removeCredential:cloudUrl",
    ]);
    expect(output()).toContain("Logged out");
  });
});
