import { describe, expect, test } from "bun:test";
import {
  formatLocalServerReadyMessage,
  resolveChatApiUrl,
  resolveLocalDaemonApiUrl,
  shouldAutoStartLocalServerForChat,
} from "./cli-server";

describe("cli-server", () => {
  test("resolveChatApiUrl defaults to localhost:6767 when apiUrl is missing", () => {
    expect(resolveChatApiUrl(undefined)).toBe("http://127.0.0.1:6767");
    expect(resolveChatApiUrl("")).toBe("http://127.0.0.1:6767");
  });

  test("shouldAutoStartLocalServerForChat treats empty and loopback apiUrl as local mode", () => {
    expect(shouldAutoStartLocalServerForChat(undefined)).toBe(true);
    expect(shouldAutoStartLocalServerForChat("")).toBe(true);
    expect(shouldAutoStartLocalServerForChat("http://localhost:6767")).toBe(true);
    expect(shouldAutoStartLocalServerForChat("http://127.0.0.1:6767")).toBe(true);
    expect(shouldAutoStartLocalServerForChat("http://[::1]:6767")).toBe(true);
  });

  test("shouldAutoStartLocalServerForChat leaves remote/non-http apiUrl as external mode", () => {
    expect(shouldAutoStartLocalServerForChat("https://api.example.com")).toBe(false);
    expect(shouldAutoStartLocalServerForChat("https://localhost:6767")).toBe(false);
    expect(shouldAutoStartLocalServerForChat("ws://localhost:6767/v1/rpc")).toBe(false);
    expect(shouldAutoStartLocalServerForChat("not-a-url")).toBe(false);
  });

  test("resolveLocalDaemonApiUrl uses configured loopback apiUrl and ignores remote apiUrl", () => {
    expect(resolveLocalDaemonApiUrl(undefined, 6767)).toBe("http://127.0.0.1:6767");
    expect(resolveLocalDaemonApiUrl("http://localhost:7777", 6767)).toBe("http://localhost:7777");
    expect(resolveLocalDaemonApiUrl("http://127.0.0.1:8888", 6767)).toBe("http://127.0.0.1:8888");
    expect(resolveLocalDaemonApiUrl("https://api.example.com", 6767)).toBe("http://127.0.0.1:6767");
  });

  test("formatLocalServerReadyMessage maps started/managed/external states", () => {
    expect(formatLocalServerReadyMessage({ apiUrl: "http://127.0.0.1:6767", started: true, managed: true })).toBe(
      "Started local server at http://127.0.0.1:6767",
    );
    expect(formatLocalServerReadyMessage({ apiUrl: "http://127.0.0.1:6767", started: false, managed: true })).toBe(
      "Using local server at http://127.0.0.1:6767",
    );
    expect(formatLocalServerReadyMessage({ apiUrl: "http://127.0.0.1:6767", started: false, managed: false })).toBe(
      "Using external local server at http://127.0.0.1:6767 (started outside this client).",
    );
  });
});
