import { describe, test } from "bun:test";
import { OBSERVER_PROMPT, REFLECTOR_PROMPT } from "./memory-distill-prompts";
import { expectIntent } from "./test-utils";

describe("memory distill prompts", () => {
  test("observer prompt defines @observe scopes", () => {
    expectIntent(OBSERVER_PROMPT, [
      ["@observe project"],
      ["@observe user"],
      ["@observe session"],
      ["current task"],
      ["next step"],
    ]);
  });

  test("reflector prompt preserves continuation state", () => {
    expectIntent(REFLECTOR_PROMPT, [["current task"], ["next step"]]);
  });
});
