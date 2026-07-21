import { expect, test } from "bun:test";
import { footerStatusSchema } from "./footer-status-contract";

test("footer status accepts semantic context without renderer values", () => {
  expect(
    footerStatusSchema.safeParse({
      repo: "acolyte",
      worktree: "tui-presentation",
      branch: "tui-presentation",
      dirty: true,
      ahead: 2,
      behind: 0,
      model: "gpt-5.2",
      effort: "medium",
      inputTokens: 48600,
      outputTokens: 12400,
      pr: { number: 281, state: "OPEN", title: "TUI", url: "https://example.test/pr/281" },
      skills: ["build"],
    }).success,
  ).toBe(true);
});
