import { describe, expect, test } from "bun:test";
import { ghIssueList, ghPrView } from "./gh-ops";

describe("ghPrView", () => {
  test("returns PR info or null", async () => {
    const pr = await ghPrView(process.cwd());
    if (pr) {
      expect(typeof pr.number).toBe("number");
      expect(typeof pr.state).toBe("string");
    }
  });
});

describe("ghIssueList", () => {
  test("returns array", async () => {
    const issues = await ghIssueList(process.cwd(), { limit: 3 });
    expect(Array.isArray(issues)).toBe(true);
  });
});
