import { describe, expect, test } from "bun:test";
import { extractLifecycleSignal } from "./agent-stream";

describe("extractLifecycleSignal", () => {
  test("extracts done signal from the first line", () => {
    expect(extractLifecycleSignal("@signal done\nFinished the requested change.")).toEqual({
      signal: "done",
      text: "Finished the requested change.",
    });
  });

  test("extracts no_op signal from the first line", () => {
    expect(extractLifecycleSignal("@signal no_op\nNo changes were needed.")).toEqual({
      signal: "no_op",
      text: "No changes were needed.",
    });
  });

  test("leaves plain text unchanged when no signal is present", () => {
    expect(extractLifecycleSignal("Finished the requested change.")).toEqual({
      text: "Finished the requested change.",
    });
  });
});
