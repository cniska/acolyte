import { describe, expect, test } from "bun:test";
import { ghAvailable, ghIssueList, ghPrView } from "./gh-ops";

describe("ghAvailable", () => {
  test("returns boolean", async () => {
    const result = await ghAvailable(process.cwd());
    expect(typeof result).toBe("boolean");
  });
});

describe("ghPrView", () => {
  test("returns PR info or null", async () => {
    if (!(await ghAvailable(process.cwd()))) return;
    const pr = await ghPrView(process.cwd());
    if (pr) {
      expect(typeof pr.number).toBe("number");
      expect(typeof pr.state).toBe("string");
    }
  });
});

describe("ghIssueList", () => {
  test("returns array", async () => {
    if (!(await ghAvailable(process.cwd()))) return;
    const issues = await ghIssueList(process.cwd(), { limit: 3 });
    expect(Array.isArray(issues)).toBe(true);
  });
});
