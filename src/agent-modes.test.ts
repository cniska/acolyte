import { describe, expect, test } from "bun:test";
import { agentModes } from "./agent-modes";

describe("agentModes", () => {
  test("every mode has preamble", () => {
    for (const def of Object.values(agentModes)) {
      expect(def.preamble.length).toBeGreaterThan(0);
    }
  });
});
