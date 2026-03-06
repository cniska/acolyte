import { describe, expect, test } from "bun:test";
import { OBSERVER_PROMPT, REFLECTOR_PROMPT } from "./memory-distill-prompts";

describe("memory distill prompts", () => {
  test("observer prompt enforces strict scope tags with examples", () => {
    expect(OBSERVER_PROMPT).toContain("Scope tag format is strict:");
    expect(OBSERVER_PROMPT).toContain("Routing guidance:");
    expect(OBSERVER_PROMPT).toContain("use [project] for repository facts");
    expect(OBSERVER_PROMPT).toContain("use [user] only for stable personal preferences");
    expect(OBSERVER_PROMPT).toContain("if a user preference is clearly project-scoped, tag it [project], not [user].");
    expect(OBSERVER_PROMPT).toContain('valid: "[project] uses Bun"');
    expect(OBSERVER_PROMPT).toContain('invalid: "[proj] ..."');
    expect(OBSERVER_PROMPT).toContain("If unsure about scope, default to [session].");
  });

  test("reflector prompt preserves continuation labels", () => {
    expect(REFLECTOR_PROMPT).toContain('always include "Current task:" and "Next step:"');
  });
});
