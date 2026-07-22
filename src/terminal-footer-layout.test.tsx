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

test("footer shows the dirty marker and ahead/behind on the branch", () => {
  expect(render({ ...base, dirty: true, ahead: 2, behind: 1 }, 100)).toBe("  acolyte · main* ↑2 ↓1 · gpt-5.2 medium");
});

test("footer omits ahead/behind when zero but keeps the dirty marker", () => {
  expect(render({ ...base, dirty: true }, 100)).toBe("  acolyte · main* · gpt-5.2 medium");
});

test("footer collapses a worktree that shares the branch name", () => {
  expect(render({ ...base, worktree: "feature", branch: "feature", dirty: true }, 100)).toBe(
    "  acolyte · feature* · gpt-5.2 medium",
  );
});

test("footer shows worktree and branch separately when they differ", () => {
  expect(render({ ...base, worktree: "wt", branch: "main" }, 100)).toBe("  acolyte · wt · main · gpt-5.2 medium");
});

test("footer collapses a branch whose name equals the repo, keeping the suffix", () => {
  expect(render({ ...base, branch: "acolyte", dirty: true, ahead: 3 }, 100)).toBe("  acolyte* ↑3 · gpt-5.2 medium");
});

test("footer renders cumulative tokens with up/down arrows", () => {
  expect(render({ ...base, inputTokens: 48600, outputTokens: 12400 }, 100)).toBe(
    "  acolyte · main · gpt-5.2 medium · ↑48.6k ↓12.4k",
  );
});

test("footer renders the PR number at the end", () => {
  expect(
    render({ ...base, pr: { number: 281, state: "open", title: "x", url: "https://example.test/pr/281" } }, 100),
  ).toBe("  acolyte · main · gpt-5.2 medium · PR #281");
});

test("footer omits effort when absent", () => {
  expect(render({ ...base, effort: null }, 100)).toBe("  acolyte · main · gpt-5.2");
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
