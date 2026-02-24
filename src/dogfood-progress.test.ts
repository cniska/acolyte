import { describe, expect, test } from "bun:test";
import {
  buildGitLogCmd,
  commitType,
  countDelegatedOutcomes,
  countDelegatedSlices,
  countDeliverySlices,
  nonDeliveryCategories,
  parseArgs,
  parseGitLog,
  selectScopeCommits,
  summarizeByType,
} from "./dogfood-progress";

describe("dogfood progress", () => {
  test("parseArgs applies defaults", () => {
    expect(parseArgs([])).toEqual({
      lookback: 30,
      target: 10,
      json: false,
    });
  });

  test("parseArgs parses since/target/lookback", () => {
    expect(parseArgs(["--since", "2026-02-21", "--target", "6", "--lookback", "50"])).toEqual({
      since: "2026-02-21",
      target: 6,
      lookback: 50,
      json: false,
    });
  });

  test("parseArgs parses --json", () => {
    expect(parseArgs(["--json"])).toEqual({
      lookback: 30,
      target: 10,
      json: true,
    });
  });

  test("parseArgs rejects invalid target value", () => {
    expect(() => parseArgs(["--target", "0"])).toThrow("Invalid --target value.");
  });

  test("parseArgs rejects invalid lookback value", () => {
    expect(() => parseArgs(["--lookback", "-1"])).toThrow("Invalid --lookback value.");
  });

  test("parseGitLog parses tab-delimited rows", () => {
    const rows = parseGitLog(
      ["abc123\t2026-02-21\tfeat(cli): improve status", "def456\t2026-02-21\tdocs: update"].join("\n"),
    );
    expect(rows).toEqual([
      { hash: "abc123", date: "2026-02-21", subject: "feat(cli): improve status" },
      { hash: "def456", date: "2026-02-21", subject: "docs: update" },
    ]);
  });

  test("summarizeByType groups conventional commit types", () => {
    const summary = summarizeByType([
      { hash: "1", date: "2026-02-21", subject: "feat(cli): one" },
      { hash: "2", date: "2026-02-21", subject: "feat(agent): two" },
      { hash: "3", date: "2026-02-21", subject: "fix(status): three" },
      { hash: "4", date: "2026-02-21", subject: "misc commit" },
    ]);
    expect(summary).toEqual([
      { type: "feat", count: 2 },
      { type: "fix", count: 1 },
      { type: "other", count: 1 },
    ]);
  });

  test("commitType falls back to other when conventional prefix is absent", () => {
    expect(commitType("feat(cli): one")).toBe("feat");
    expect(commitType("plain commit subject")).toBe("other");
  });

  test("selectScopeCommits skips docs commits in lookback mode", () => {
    const commits = [
      { hash: "1", date: "2026-02-21", subject: "docs: update readme" },
      { hash: "2", date: "2026-02-21", subject: "feat(cli): add status" },
      { hash: "3", date: "2026-02-21", subject: "docs: polish notes" },
      { hash: "4", date: "2026-02-21", subject: "fix(agent): handle edge case" },
      { hash: "5", date: "2026-02-21", subject: "refactor(ui): reduce noise" },
    ];
    const selected = selectScopeCommits(commits, { lookback: 2, target: 10, json: false });
    expect(selected.map((row) => row.hash)).toEqual(["2", "4"]);
  });

  test("countDeliverySlices includes feat/fix/refactor/test", () => {
    expect(
      countDeliverySlices([
        { type: "docs", count: 3 },
        { type: "feat", count: 2 },
        { type: "fix", count: 1 },
        { type: "test", count: 4 },
        { type: "other", count: 2 },
      ]),
    ).toBe(7);
  });

  test("countDelegatedOutcomes reports success/failure proxy and rate", () => {
    expect(
      countDelegatedOutcomes([
        { hash: "1", date: "2026-02-21", subject: "feat(cli): one" },
        { hash: "2", date: "2026-02-21", subject: "fix(cli): two" },
        { hash: "3", date: "2026-02-21", subject: "chore: three" },
        { hash: "4", date: "2026-02-21", subject: "docs: four" },
      ]),
    ).toEqual({
      success: 2,
      failure: 2,
      successRate: 50,
    });
  });

  test("countDelegatedSlices includes feat/fix only", () => {
    expect(
      countDelegatedSlices([
        { type: "feat", count: 2 },
        { type: "fix", count: 3 },
        { type: "refactor", count: 4 },
        { type: "test", count: 5 },
      ]),
    ).toBe(5);
  });

  test("nonDeliveryCategories reports non-delivery commit classes", () => {
    expect(
      nonDeliveryCategories([
        { type: "feat", count: 2 },
        { type: "fix", count: 1 },
        { type: "chore", count: 3 },
        { type: "other", count: 2 },
      ]),
    ).toEqual([
      { type: "chore", count: 3 },
      { type: "other", count: 2 },
    ]);
  });

  test("buildGitLogCmd uses argv form for lookback and since", () => {
    expect(buildGitLogCmd({ lookback: 12, target: 10, json: false })).toEqual([
      "git",
      "log",
      "--date=short",
      "--pretty=format:%h%x09%ad%x09%s",
      "-n",
      "12",
    ]);
    expect(buildGitLogCmd({ since: "2026-02-21 10:00", lookback: 30, target: 10, json: false })).toEqual([
      "git",
      "log",
      "--date=short",
      "--pretty=format:%h%x09%ad%x09%s",
      "--since",
      "2026-02-21 10:00",
    ]);
  });
});
