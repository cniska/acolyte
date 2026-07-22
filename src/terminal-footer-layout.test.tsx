import { expect, test } from "bun:test";
import type { FooterStatus } from "./footer-status-contract";
import { layoutFooterStatus } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { renderPlain } from "./tui/test-utils";

const base: FooterStatus = {
  repo: "acolyte",
  worktree: null,
  branch: "main",
  dirty: false,
  ahead: 0,
  behind: 0,
  model: "gpt-5.2",
  effort: "medium",
  inputTokens: 0,
  outputTokens: 0,
  pr: null,
  skills: [],
};

const render = (status: FooterStatus, columns: number) =>
  renderPlain(<TerminalSceneRender scene={layoutFooterStatus(status, columns)} />, columns);

test("footer without skills renders the status segments", () => {
  expect(render(base, 80)).toBe("  acolyte · main · gpt-5.2 medium");
});

test("footer right-justifies skills against the terminal width", () => {
  expect(render({ ...base, skills: ["build", "debug"] }, 60)).toBe(
    `  acolyte · main · gpt-5.2 medium${" ".repeat(14)}build · debug`,
  );
});

test("footer stacks skills on their own indented row when they do not fit", () => {
  expect(render({ ...base, skills: ["build", "debug"] }, 40)).toBe(
    "  acolyte · main · gpt-5.2 medium\n  build · debug",
  );
});
