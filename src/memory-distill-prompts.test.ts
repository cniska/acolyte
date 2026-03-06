import { describe, expect, test } from "bun:test";
import { OBSERVER_PROMPT, REFLECTOR_PROMPT } from "./memory-distill-prompts";

describe("memory distill prompts", () => {
  test("observer prompt enforces strict scope tags with examples", () => {
    expect(OBSERVER_PROMPT).toContain("Scope tag format is strict:");
    expect(OBSERVER_PROMPT).toContain('valid: "[project] uses Bun"');
    expect(OBSERVER_PROMPT).toContain('invalid: "[proj] ..."');
    expect(OBSERVER_PROMPT).toContain("If unsure about scope, default to [session].");
  });

  test("reflector prompt preserves continuation labels", () => {
    expect(REFLECTOR_PROMPT).toContain('always include "Current task:" and "Next step:"');
  });
});
