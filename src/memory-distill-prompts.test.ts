import { describe, test } from "bun:test";
import { OBSERVER_PROMPT, REFLECTOR_PROMPT } from "./memory-distill-prompts";
import { expectIntent } from "./test-utils";

describe("memory distill prompts", () => {
  test("observer prompt defines @observe scopes", () => {
    expectIntent(OBSERVER_PROMPT, [["@observe project"], ["@observe user"], ["@observe session"]]);
  });

  test("reflector prompt requires merge and dedup", () => {
    expectIntent(REFLECTOR_PROMPT, [["merge duplicates"], ["resolve contradictions"]]);
  });
});
