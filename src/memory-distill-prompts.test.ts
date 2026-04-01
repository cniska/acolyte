import { describe, test } from "bun:test";
import { OBSERVER_PROMPT, REFLECTOR_PROMPT } from "./memory-distill-prompts";
import { expectIntent } from "./test-utils";

describe("memory distill prompts", () => {
  test("observer prompt enforces strict @observe directives with examples", () => {
    expectIntent(OBSERVER_PROMPT, [
      ["scope directive format", "strict"],
      ["routing guidance"],
      ["use @observe project", "repository facts"],
      ["use @observe user", "stable personal preferences"],
      ["project-scoped", "@observe project, not @observe user"],
      ['valid: "@observe project"'],
      ['invalid: "[project] ..."'],
      ["if unsure about scope", "default to @observe session"],
    ]);
  });

  test("reflector prompt preserves continuation labels", () => {
    expectIntent(REFLECTOR_PROMPT, [['always include "current task:" and "next step:"']]);
  });
});
