import { describe, expect, test } from "bun:test";
import { createInstructions, createModeInstructions } from "./agent-instructions";

describe("createModeInstructions", () => {
  test("work mode includes key tool instructions", () => {
    const out = createModeInstructions("work");
    expect(out).toContain("Use `file-read`");
    expect(out).toContain("Use `file-edit`");
    expect(out).toContain("Use `code-edit`");
    expect(out).toContain("Use `shell-run`");
  });

  test("work mode includes key bounded-task guardrails", () => {
    const out = createModeInstructions("work");
    expect(out).toContain("You are in work mode. Implement the requested change directly.");
    expect(out).toContain("once every requested file has the requested bounded change, stop");
    expect(out).toContain("Do NOT create a checklist for a simple bounded fix.");
    expect(out).toContain("NEVER create a checklist just to represent read, edit, and verify as separate steps.");
    expect(out).toContain("Use `checklist-create` only for tasks with 5+ distinct user-visible steps");
  });

  test("verify mode includes verification instructions", () => {
    const out = createModeInstructions("verify");
    expect(out).toContain("Act as an independent code reviewer.");
    expect(out).toContain("Review the changes with ONE `code-scan` call");
    expect(out).toContain("Do not `file-read` edited files in verify mode");
    expect(out).toContain("If the verification pass is clean, stop.");
  });

  test("work mode does not include verification instructions", () => {
    const out = createModeInstructions("work");
    expect(out).not.toContain("Review the changes");
  });
});

describe("createInstructions", () => {
  test("includes base instructions for all modes", () => {
    const out = createInstructions("Soul.", "work");
    expect(out).toContain("Soul.");
    const modeIndex = out.indexOf("If the target path is explicit");
    const baseIndex = out.indexOf("Write ONE short direct sentence before acting.");
    const toolIndex = out.indexOf("Use `file-find` to locate");
    expect(modeIndex).toBeGreaterThan(-1);
    expect(baseIndex).toBeGreaterThan(-1);
    expect(toolIndex).toBeGreaterThan(-1);
    expect(modeIndex).toBeLessThan(baseIndex);
    expect(baseIndex).toBeLessThan(toolIndex);
    expect(out).toContain("Write ONE short direct sentence before acting.");
    expect(out).toContain("Do NOT send another assistant message until you are blocked or done.");
    expect(out).toContain("During tool use, stay silent. Do NOT narrate obvious read, edit, search, or verify steps.");
    expect(out).toContain("Do NOT recap visible tool output.");
    expect(out).toContain("If a write-tool diff or preview already makes the result obvious, say NOTHING after it.");
    expect(out).toContain("If you notice you have derailed, stop taking new actions.");
    expect(out).toContain("The `@signal` line is how you communicate task state to the host.");
    expect(out).toContain("End every final response with EXACTLY ONE `@signal` line.");
    expect(out).toContain(
      "After `@signal blocked`, write ONE short sentence stating what is missing and why it is needed.",
    );
    expect(out).toContain("@signal done");
    expect(out).toContain("@signal no_op");
    expect(out).toContain("@signal blocked");
  });

  test("work mode includes key edit guidance", () => {
    const out = createInstructions("Soul.", "work");
    expect(out).toContain("Use `code-edit` for AST-aware refactors or structural code rewrites.");
    expect(out).toContain("Prefer explicit operation objects.");
    expect(out).toContain("Use `file-edit` for text edits.");
    expect(out).toContain("If that preview shows the requested bounded change, stop immediately.");
    expect(out).toContain("Use `test-run` to validate changes with the test files you modified.");
    expect(out).toContain("The lifecycle runs detected lint and format commands automatically after your edits.");
    expect(out).toContain("Do NOT run build commands in work mode unless the user explicitly asked for it.");
    expect(out).toContain(
      "If a write-tool diff already shows the requested bounded change, do not add a closing sentence.",
    );
  });
});
