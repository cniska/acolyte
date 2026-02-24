import { describe, expect, it } from "bun:test";
import {
  assertCheckOutput,
  hasFallbackEditSignal,
  isProviderReadyFromStatusOutput,
  parseArgs,
  stripAnsi,
} from "./dogfood-smoke";

describe("dogfood-smoke helpers", () => {
  it("strips ANSI color sequences", () => {
    const input = "\x1b[31merror\x1b[0m and \x1b[1;34mok\x1b[0m";
    expect(stripAnsi(input)).toBe("error and ok");
  });

  it("returns null when all expected patterns match", () => {
    const err = assertCheckOutput({ name: "x", cmd: [], expect: [/hello/, /world/] }, "hello world");
    expect(err).toBeNull();
  });

  it("returns missing pattern message when a pattern does not match", () => {
    const err = assertCheckOutput({ name: "x", cmd: [], expect: [/hello/, /world/] }, "hello");
    expect(err).toContain("missing expected pattern");
    expect(err).toContain("/world/");
  });

  it("detects provider not ready from status output", () => {
    const output = ["provider: openai", "provider_ready:", "  status: false"].join("\n");
    expect(isProviderReadyFromStatusOutput(output)).toBe(false);
  });

  it("assumes provider ready when no false readiness row is present", () => {
    const output = ["provider: openai", "model: gpt-5-mini"].join("\n");
    expect(isProviderReadyFromStatusOutput(output)).toBe(true);
  });

  it("detects fallback edit signals in output", () => {
    expect(hasFallbackEditSignal("Applied direct edit fallback in /tmp/x.txt.")).toBe(true);
    expect(hasFallbackEditSignal("Edit request failed: no edit-file call was executed")).toBe(true);
    expect(hasFallbackEditSignal("Edited file successfully.")).toBe(false);
  });

  it("parseArgs defaults to optional provider readiness", () => {
    expect(parseArgs([])).toEqual({ requireProviderReady: false });
  });

  it("parseArgs enables required provider readiness", () => {
    expect(parseArgs(["--require-provider-ready"])).toEqual({ requireProviderReady: true });
  });

  it("parseArgs rejects unknown flags", () => {
    expect(() => parseArgs(["--unknown"])).toThrow("Unknown argument: --unknown");
  });
});
