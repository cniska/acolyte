import { describe, expect, test } from "bun:test";
import { sessionTitleFromPrompt } from "./session-title";

describe("session title from prompt", () => {
  test("keeps a short prompt whole", () => {
    expect(sessionTitleFromPrompt("fix the login redirect")).toBe("fix the login redirect");
  });

  test("collapses whitespace and trims the ends", () => {
    expect(sessionTitleFromPrompt("  fix   the\n\nlogin  ")).toBe("fix the login");
  });

  test("cuts a long prompt on a word boundary, never mid-word", () => {
    const title = sessionTitleFromPrompt(
      "refactor the authentication middleware so that every request carries a verified owner",
    );
    expect(title.length).toBeLessThanOrEqual(60);
    // The boundary is what matters: the last character must end a word.
    expect(title).toBe("refactor the authentication middleware so that every");
    expect(title.endsWith(" ")).toBe(false);
  });

  test("cuts a single over-long word where it stands, having no boundary to retreat to", () => {
    const word = "a".repeat(80);
    expect(sessionTitleFromPrompt(word)).toBe("a".repeat(60));
  });

  test("keeps a prompt of exactly the ceiling whole", () => {
    const exact = "b".repeat(60);
    expect(sessionTitleFromPrompt(exact)).toBe(exact);
  });

  test("returns nothing for a blank prompt, leaving the session unnamed", () => {
    expect(sessionTitleFromPrompt("   \n  ")).toBe("");
  });
});
