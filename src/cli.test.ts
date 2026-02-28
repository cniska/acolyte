import { describe, expect, test } from "bun:test";
import {
  extractVersionFromPackageJsonText,
  formatLocalServerReadyMessage,
  formatResumeCommand,
  resolveChatApiUrl,
  resolveCommandAlias,
  resolveLocalDaemonApiUrl,
  shouldAutoStartLocalServerForChat,
  suggestCommand,
  suggestCommands,
} from "./cli";

describe("cli", () => {
  test("extractVersionFromPackageJsonText parses version safely", () => {
    expect(extractVersionFromPackageJsonText('{"name":"acolyte","version":"0.1.0"}')).toBe("0.1.0");
    expect(extractVersionFromPackageJsonText('{"name":"acolyte"}')).toBeNull();
    expect(extractVersionFromPackageJsonText("{bad json}")).toBeNull();
  });

  test("formatResumeCommand returns prod-friendly command", () => {
    expect(formatResumeCommand("sess_abcdef1234567890")).toBe("acolyte resume sess_abcdef1234567890");
  });

  test("resolveCommandAlias maps short commands", () => {
    expect(resolveCommandAlias("?")).toBe("?");
    expect(resolveCommandAlias("/exit")).toBe("/exit");
    expect(resolveCommandAlias("/run")).toBe("/run");
  });

  test("suggestCommand supports canonical and alias prefixes", () => {
    expect(suggestCommand("/e")).toBe("/exit");
    expect(suggestCommand("/exi")).toBe("/exit");
    expect(suggestCommand("/ext")).toBe("/exit");
    expect(suggestCommand("?")).toBe("?");
    expect(suggestCommand("plain text")).toBeNull();
  });

  test("suggestCommands returns multiple ranked suggestions", () => {
    expect(suggestCommands("/", 3)).toEqual(["/exit"]);
    expect(suggestCommands("/exot", 3)).toContain("/exit");
    expect(suggestCommands("no slash", 3)).toEqual([]);
  });

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

  test("formatLocalServerReadyMessage maps started/managed/unmanaged states", () => {
    expect(formatLocalServerReadyMessage({ apiUrl: "http://127.0.0.1:6767", started: true, managed: true })).toBe(
      "Started local server at http://127.0.0.1:6767",
    );
    expect(formatLocalServerReadyMessage({ apiUrl: "http://127.0.0.1:6767", started: false, managed: true })).toBe(
      "Using local server at http://127.0.0.1:6767",
    );
    expect(formatLocalServerReadyMessage({ apiUrl: "http://127.0.0.1:6767", started: false, managed: false })).toBe(
      "Using unmanaged local server at http://127.0.0.1:6767 (started outside Acolyte).",
    );
  });
});
