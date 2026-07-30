import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDiff } from "./diff-ops";
import { gitEnv } from "./test-utils";

function lines(...values: string[]): string {
  return `${values.join("\n")}\n`;
}

function counts(diff: string): { added: number; removed: number } {
  const body = diff.split("\n");
  return {
    added: body.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
    removed: body.filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
  };
}

function hunks(diff: string): string[] {
  return diff.split("\n").filter((line) => line.startsWith("@@"));
}

describe("createDiff", () => {
  test("reports a single deletion when one repeated line is removed", async () => {
    const previous = lines("a", "", "b", "", "c", "", "d", "", "e");
    const next = lines("a", "b", "", "c", "", "d", "", "e");

    expect(counts(await createDiff({ displayPath: "t.txt", previous, next }))).toEqual({ added: 0, removed: 1 });
  });

  test("keeps the shared lines when a line moves to the end", async () => {
    const diff = await createDiff({ displayPath: "t.txt", previous: lines("A", "B", "C"), next: lines("B", "C", "A") });

    // One line moved, so a minimal alignment keeps B and C as context. Asserting the counts
    // rather than the row order pins the contract without pinning git's choice among ties.
    expect(counts(diff)).toEqual({ added: 1, removed: 1 });
  });

  test("stays proportional on a large file with one changed line", async () => {
    const before = Array.from({ length: 6000 }, (_, i) => (i % 3 === 0 ? "" : `line ${i}`));
    const after = [...before];
    after[3000] = "CHANGED";

    const diff = await createDiff({ displayPath: "t.txt", previous: lines(...before), next: lines(...after) });

    expect(counts(diff)).toEqual({ added: 1, removed: 1 });
    expect(hunks(diff)).toHaveLength(1);
  });

  test("reports a wholly rewritten large file precisely rather than collapsing it", async () => {
    const before = Array.from({ length: 2100 }, (_, i) => `old ${i}`);
    const after = Array.from({ length: 2100 }, (_, i) => `new ${i}`);

    const diff = await createDiff({ displayPath: "t.txt", previous: lines(...before), next: lines(...after) });

    expect(counts(diff)).toEqual({ added: 2100, removed: 2100 });
    expect(hunks(diff)).toHaveLength(1);
  });

  test("separates distant changes into their own hunks", async () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const after = [...before];
    after[2] = "CHANGED 2";
    after[37] = "CHANGED 37";

    const diff = await createDiff({ displayPath: "t.txt", previous: lines(...before), next: lines(...after) });

    expect(hunks(diff)).toHaveLength(2);
    expect(counts(diff)).toEqual({ added: 2, removed: 2 });
  });

  test("surrounds a change with three lines of context", async () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const after = [...before];
    after[10] = "CHANGED";

    const diff = await createDiff({ displayPath: "t.txt", previous: lines(...before), next: lines(...after) });

    expect(diff.split("\n").filter((line) => line.startsWith(" "))).toEqual([
      " line 7",
      " line 8",
      " line 9",
      " line 11",
      " line 12",
      " line 13",
    ]);
  });

  test("reports a new file as an addition against /dev/null", async () => {
    const diff = await createDiff({ displayPath: "src/t.txt", previous: null, next: lines("a", "b") });

    expect(diff).toContain("new file mode 100644");
    expect(diff).toContain("--- /dev/null");
    expect(diff).toContain("+++ b/src/t.txt");
    expect(hunks(diff)).toEqual(["@@ -0,0 +1,2 @@"]);
    expect(counts(diff)).toEqual({ added: 2, removed: 0 });
  });

  test("reports a deleted file as a removal against /dev/null", async () => {
    const diff = await createDiff({ displayPath: "src/t.txt", previous: lines("a", "b"), next: null });

    expect(diff).toContain("deleted file mode 100644");
    expect(diff).toContain("--- a/src/t.txt");
    expect(diff).toContain("+++ /dev/null");
    expect(hunks(diff)).toEqual(["@@ -1,2 +0,0 @@"]);
    expect(counts(diff)).toEqual({ added: 0, removed: 2 });
  });

  test("emits nothing when the content is unchanged", async () => {
    expect(await createDiff({ displayPath: "t.txt", previous: lines("a", "b"), next: lines("a", "b") })).toBe("");
  });

  test("marks a missing final newline on both sides", async () => {
    const diff = await createDiff({ displayPath: "t.txt", previous: "a\nb", next: "a\nB" });

    expect(diff.split("\n").filter((line) => line.startsWith("\\"))).toEqual([
      "\\ No newline at end of file",
      "\\ No newline at end of file",
    ]);
  });

  test("distinguishes adding a final newline from changing content", async () => {
    const diff = await createDiff({ displayPath: "t.txt", previous: "a\nb", next: "a\nb\n" });

    expect(counts(diff)).toEqual({ added: 1, removed: 1 });
    expect(diff).toContain("\\ No newline at end of file");
  });

  test("keeps a whitespace-only trailing context line", async () => {
    const diff = await createDiff({ displayPath: "t.txt", previous: "a\nb\n   \n", next: "a\nB\n   \n" });

    expect(diff.split("\n").slice(-4)).toEqual([" a", "-b", "+B", "    "]);
  });

  test("counts every row the hunk header claims", async () => {
    const diff = await createDiff({ displayPath: "t.txt", previous: "a\nb\n   \n", next: "a\nB\n   \n" });
    const [, oldCount, newCount] = diff.match(/@@ -\d+,(\d+) \+\d+,(\d+) @@/) ?? [];
    const body = diff.split("\n").slice(diff.split("\n").findIndex((line) => line.startsWith("@@")) + 1);

    expect(body.filter((line) => line.startsWith(" ") || line.startsWith("-"))).toHaveLength(Number(oldCount ?? 0));
    expect(body.filter((line) => line.startsWith(" ") || line.startsWith("+"))).toHaveLength(Number(newCount ?? 0));
  });

  test("keeps a whitespace-only added line's content", async () => {
    const diff = await createDiff({ displayPath: "t.txt", previous: "a\n", next: "a\n   \n" });

    expect(diff.split("\n").at(-1)).toBe("+   ");
  });

  test("keeps a nested path in the diff header", async () => {
    const diff = await createDiff({ displayPath: "src/deep/nested/t.txt", previous: lines("a"), next: lines("b") });

    expect(diff).toContain("--- a/src/deep/nested/t.txt");
    expect(diff).toContain("+++ b/src/deep/nested/t.txt");
  });

  test("keeps a non-ASCII path literal in the diff header", async () => {
    const diff = await createDiff({ displayPath: "src/överraskning.ts", previous: lines("a"), next: lines("b") });

    expect(diff).toContain("--- a/src/överraskning.ts");
    expect(diff).toContain("+++ b/src/överraskning.ts");
  });

  test("contains a path that would otherwise resolve outside the scratch tree", async () => {
    const diff = await createDiff({ displayPath: "/etc/hosts", previous: lines("a"), next: lines("b") });

    expect(diff).toContain("--- a/etc/hosts");
    expect(counts(diff)).toEqual({ added: 1, removed: 1 });
  });
});

describe("createDiff isolation", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of ["TMPDIR", "XDG_CONFIG_HOME", "GIT_EXTERNAL_DIFF"]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  test("ignores a user-level git attributes file", async () => {
    const home = mkdtempSync(join(tmpdir(), "acolyte-xdg-"));
    mkdirSync(join(home, "git"), { recursive: true });
    // `* -diff` would otherwise replace every patch with "Binary files ... differ".
    writeFileSync(join(home, "git", "attributes"), "* -diff\n", "utf8");
    process.env.XDG_CONFIG_HOME = home;

    const diff = await createDiff({ displayPath: "t.txt", previous: lines("a", "b"), next: lines("a", "B") });

    expect(diff).not.toContain("Binary files");
    expect(counts(diff)).toEqual({ added: 1, removed: 1 });
  });

  test("never runs an external diff program", async () => {
    const dir = mkdtempSync(join(tmpdir(), "acolyte-ext-"));
    const marker = join(dir, "ran");
    const script = join(dir, "ext.sh");
    writeFileSync(script, `#!/bin/sh\ntouch ${marker}\necho EXTERNAL\n`, { encoding: "utf8", mode: 0o755 });
    process.env.GIT_EXTERNAL_DIFF = script;

    const diff = await createDiff({ displayPath: "t.txt", previous: lines("a", "b"), next: lines("a", "B") });

    expect(existsSync(marker)).toBe(false);
    expect(diff).not.toContain("EXTERNAL");
    expect(counts(diff)).toEqual({ added: 1, removed: 1 });
  });

  test("ignores a surrounding repository's gitattributes", async () => {
    const repo = mkdtempSync(join(tmpdir(), "acolyte-attrs-"));
    execFileSync("git", ["init", "-q", repo], { env: gitEnv() });
    // `-diff` makes git treat a path as binary, which would replace the patch with a one-line
    // "Binary files differ" if the scratch images were discovered as part of this repository.
    writeFileSync(join(repo, ".gitattributes"), "* -diff\n", "utf8");
    const scratch = join(repo, "scratch");
    mkdirSync(scratch);
    process.env.TMPDIR = scratch;

    const diff = await createDiff({ displayPath: "t.txt", previous: lines("a", "b"), next: lines("a", "B") });

    expect(diff).not.toContain("Binary files");
    expect(counts(diff)).toEqual({ added: 1, removed: 1 });
  });
});
