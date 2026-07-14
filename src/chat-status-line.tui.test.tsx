import { describe, expect, test } from "bun:test";
import { prColor, StatusLine, type StatusLineState, statusTokenTotals } from "./chat-status-line";
import { renderToString } from "./tui";
import { DEFAULT_TERMINAL_WIDTH } from "./tui/constants";
import { stripAnsi } from "./tui/serialize";
import { ansi, colorToFg } from "./tui/styles";
import { renderPlain, trimRightLines } from "./tui/test-utils";

function entry(inputTokens: number, outputTokens: number) {
  return { usage: { inputTokens, outputTokens } };
}

describe("statusTokenTotals", () => {
  test("sums committed per-turn usage", () => {
    expect(statusTokenTotals([entry(100, 20), entry(50, 10)], null)).toEqual({ inputTokens: 150, outputTokens: 30 });
  });

  test("adds in-flight running usage to the committed total", () => {
    expect(statusTokenTotals([entry(100, 20)], { inputTokens: 40, outputTokens: 5 })).toEqual({
      inputTokens: 140,
      outputTokens: 25,
    });
  });

  test("is zero with no committed entries and no running usage", () => {
    expect(statusTokenTotals([], null)).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

const BASE: StatusLineState = {
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

function render(overrides: Partial<StatusLineState> = {}): string {
  return renderPlain(<StatusLine {...BASE} {...overrides} />).trimEnd();
}

describe("StatusLine", () => {
  test("renders repo, branch, model and effort with no ambient segments", () => {
    expect(render()).toBe("  acolyte · main · gpt-5.2 medium");
  });

  test("shows the dirty marker and ahead/behind on the branch", () => {
    expect(render({ dirty: true, ahead: 2, behind: 1 })).toBe("  acolyte · main* ↑2 ↓1 · gpt-5.2 medium");
  });

  test("omits ahead/behind when zero but keeps the dirty marker", () => {
    expect(render({ dirty: true })).toBe("  acolyte · main* · gpt-5.2 medium");
  });

  test("collapses a worktree that shares the branch name", () => {
    expect(render({ worktree: "feature", branch: "feature", dirty: true })).toBe(
      "  acolyte · feature* · gpt-5.2 medium",
    );
  });

  test("shows worktree and branch separately when they differ", () => {
    expect(render({ worktree: "wt", branch: "main" })).toBe("  acolyte · wt · main · gpt-5.2 medium");
  });

  test("collapses a branch whose name equals the repo, keeping the suffix", () => {
    expect(render({ branch: "acolyte", dirty: true, ahead: 3 })).toBe("  acolyte* ↑3 · gpt-5.2 medium");
  });

  test("renders cumulative tokens with up/down arrows", () => {
    expect(render({ inputTokens: 48600, outputTokens: 12400 })).toBe(
      "  acolyte · main · gpt-5.2 medium · ↑48.6k ↓12.4k",
    );
  });

  test("renders the PR number at the end", () => {
    const out = render({ pr: { number: 281, state: "open", title: "x", url: "https://example.test/pr/281" } });
    expect(out).toBe("  acolyte · main · gpt-5.2 medium · PR #281");
  });

  test("dims the PR state color", () => {
    const out = renderToString(
      <StatusLine {...BASE} pr={{ number: 281, state: "open", title: "x", url: "https://example.test/pr/281" }} />,
    );
    const dimGreen = `${ansi.dim}${colorToFg("green")}`;
    expect(out).toContain(`${dimGreen}#${ansi.reset}`);
    expect(out).toContain(`${dimGreen}281${ansi.reset}`);
  });

  test("right-justifies active skills against the terminal width", () => {
    const out = renderPlain(<StatusLine {...BASE} skills={["build", "debug"]} />, 60);
    expect(out).toBe(`  acolyte · main · gpt-5.2 medium${" ".repeat(14)}build · debug`);
  });

  test("stacks skills below the status when the terminal is too narrow", () => {
    const out = renderPlain(<StatusLine {...BASE} skills={["build", "debug"]} />, 40);
    expect(out).toBe("  acolyte · main · gpt-5.2 medium\n  build · debug");
  });

  test("falls back to the default width when the terminal width is unknown (non-TTY)", () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    delete (process.stdout as { columns?: number }).columns;
    try {
      const out = trimRightLines(
        stripAnsi(renderToString(<StatusLine {...BASE} skills={["build", "debug"]} />)),
      ).trimEnd();
      expect(out).toBe(
        renderPlain(<StatusLine {...BASE} skills={["build", "debug"]} />, DEFAULT_TERMINAL_WIDTH).trimEnd(),
      );
      expect(out).not.toContain("mediumbuild");
    } finally {
      if (descriptor) Object.defineProperty(process.stdout, "columns", descriptor);
    }
  });

  test("renders no trailing padding when there are no active skills", () => {
    expect(render({ skills: [] })).toBe("  acolyte · main · gpt-5.2 medium");
  });

  test("omits effort when absent", () => {
    expect(render({ effort: null })).toBe("  acolyte · main · gpt-5.2");
  });
});

describe("prColor", () => {
  test("maps each PR state to its color", () => {
    expect(prColor("open")).toBe("green");
    expect(prColor("merged")).toBe("magenta");
    expect(prColor("closed")).toBe("red");
  });
});
