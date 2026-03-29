import { describe, test } from "bun:test";
import { OBSERVER_PROMPT, REFLECTOR_PROMPT } from "./memory-distill-prompts";
import { expectIntent } from "./test-utils";

describe("memory distill prompts", () => {
  test("observer prompt enforces strict scope tags with examples", () => {
    expectIntent(OBSERVER_PROMPT, [
      ["scope tag format", "strict"],
      ["routing guidance"],
      ["use [project]", "repository facts"],
      ["use [user]", "stable personal preferences"],
      ["project-scoped", "tag it [project], not [user]"],
      ['valid: "[project] uses bun"'],
      ['invalid: "[proj] ..."'],
      ["if unsure about scope", "default to [session]"],
    ]);
  });

  test("reflector prompt preserves continuation labels", () => {
    expectIntent(REFLECTOR_PROMPT, [['always include "current task:" and "next step:"']]);
  });
});
