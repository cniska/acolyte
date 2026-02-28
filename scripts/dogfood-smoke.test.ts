import { describe, expect, it } from "bun:test";
import {
  assertCheckOutput,
  hasAdvisoryFileWriteSignal,
  hasEditClaimSignal,
  hasToolDiffPreviewSignal,
  hasToolOutcomeSignal,
  hasUnwantedVerificationChatter,
  isProviderReadyFromStatusOutput,
  parseArgs,
  stripAnsi,
  violatesEditClaimContract,
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

  it("detects provider not ready when provider is mock", () => {
    const output = ["provider: mock", "model: gpt-5-mini"].join("\n");
    expect(isProviderReadyFromStatusOutput(output)).toBe(false);
  });

  it("assumes provider ready when provider is not mock", () => {
    const output = ["provider: openai", "model: gpt-5-mini"].join("\n");
    expect(isProviderReadyFromStatusOutput(output)).toBe(true);
  });

  it("detects edit claim signals in output", () => {
    expect(hasEditClaimSignal("Edited /tmp/x.txt successfully.")).toBe(true);
    expect(hasEditClaimSignal("Updated the file content.")).toBe(true);
    expect(hasEditClaimSignal("Wrote /tmp/new.txt")).toBe(false);
  });

  it("detects edit claim contract violations", () => {
    expect(violatesEditClaimContract("Updated /tmp/x.txt")).toBe(true);
    expect(violatesEditClaimContract("Edited /tmp/x.txt\n• Edit /tmp/x.txt")).toBe(false);
    expect(violatesEditClaimContract("Create /tmp/new.txt")).toBe(false);
  });

  it("detects unwanted verification chatter in concise coding responses", () => {
    expect(hasUnwantedVerificationChatter("Ran bun run verify — all checks passed.")).toBe(true);
    expect(hasUnwantedVerificationChatter("Verification: attempted bun run verify")).toBe(true);
    expect(hasUnwantedVerificationChatter("Next action: run bun run verify")).toBe(true);
    expect(hasUnwantedVerificationChatter("Edited src/a.ts and src/b.ts.")).toBe(false);
  });

  it("detects advisory save-as responses in coding output", () => {
    expect(hasAdvisoryFileWriteSignal("Save this as sum.rs and run rustc.")).toBe(true);
    expect(hasAdvisoryFileWriteSignal("Copy/paste this into a file.")).toBe(true);
    expect(hasAdvisoryFileWriteSignal("Created /tmp/sum.rs and wrote the script.")).toBe(false);
  });

  it("detects required tool outcome verbs in output", () => {
    expect(hasToolOutcomeSignal("Create /tmp/sum.rs", "Create")).toBe(true);
    expect(hasToolOutcomeSignal("Edit /tmp/sum.rs", "Edit")).toBe(true);
    expect(hasToolOutcomeSignal("Edit /tmp/a.ts", "Edit")).toBe(true);
    expect(hasToolOutcomeSignal("Delete /tmp/a.ts", "Delete")).toBe(true);
    expect(hasToolOutcomeSignal("Read /tmp/a.ts", "Edit")).toBe(false);
  });

  it("detects diff preview lines in tool output", () => {
    expect(hasToolDiffPreviewSignal("12 + fn main() {}")).toBe(true);
    expect(hasToolDiffPreviewSignal("- old line")).toBe(true);
    expect(hasToolDiffPreviewSignal("-old line")).toBe(true);
    expect(hasToolDiffPreviewSignal("  1 -alpha")).toBe(true);
    expect(hasToolDiffPreviewSignal("Wrote /tmp/sum.rs")).toBe(false);
  });

  it("parseArgs defaults to optional provider readiness", () => {
    expect(parseArgs([])).toEqual({ requireProviderReady: false, transportMode: "auto" });
  });

  it("parseArgs enables required provider readiness", () => {
    expect(parseArgs(["--require-provider-ready"])).toEqual({ requireProviderReady: true, transportMode: "auto" });
  });

  it("parseArgs parses explicit transport mode", () => {
    expect(parseArgs(["--transport", "rpc"])).toEqual({ requireProviderReady: false, transportMode: "rpc" });
  });

  it("parseArgs rejects invalid transport mode", () => {
    expect(() => parseArgs(["--transport", "grpc"])).toThrow(
      "Invalid value for --transport. Expected auto, http, or rpc.",
    );
  });

  it("parseArgs rejects unknown flags", () => {
    expect(() => parseArgs(["--unknown"])).toThrow("Unknown argument: --unknown");
  });
});
