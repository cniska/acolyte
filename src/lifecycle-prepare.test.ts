import { describe, expect, test } from "bun:test";
import { defaultLifecyclePolicy } from "./lifecycle-policy";
import { phasePrepare } from "./lifecycle-prepare";

describe("phasePrepare", () => {
  test("applies lifecycle policy to tool session context", () => {
    const policy = {
      ...defaultLifecyclePolicy,
      toolTimeoutMs: 1_234,
      consecutiveGuardBlockLimit: 7,
    };
    const prepared = phasePrepare({
      request: { model: "gpt-5-mini", message: "test", history: [] },
      workspace: undefined,
      taskId: "task_test0001",
      soulPrompt: "",
      initialMode: "work",
      model: "gpt-5-mini",
      policy,
      debug: () => {},
      onOutput: () => {},
      onChecklist: () => {},
    });
    expect(prepared.session.toolTimeoutMs).toBe(1_234);
    expect(prepared.session.flags.consecutiveGuardBlockLimit).toBe(7);
  });
});
