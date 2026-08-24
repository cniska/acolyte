import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCliVersion, resolveCommitShortFor } from "./cli-version";
import { gitEnv } from "./test-utils";

let root = "";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", env: gitEnv() }).trim();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "acolyte-commit-"));
  git(root, "init", "-b", "main");
  writeFileSync(join(root, "file.txt"), "one\n");
  git(root, "add", "file.txt");
  git(root, "commit", "--no-gpg-sign", "-m", "first");
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

test("the version comes from the install, not from a package.json in the working directory", () => {
  const original = process.cwd();
  const previousNpmVersion = process.env.npm_package_version;
  try {
    writeFileSync(join(root, "package.json"), '{"name":"a-site","version":"0.0.1"}');
    process.chdir(root);
    delete process.env.npm_package_version;
    expect(resolveCliVersion()).not.toBe("0.0.1");
    process.env.npm_package_version = "0.0.1";
    expect(resolveCliVersion()).not.toBe("0.0.1");
  } finally {
    process.chdir(original);
    if (previousNpmVersion === undefined) delete process.env.npm_package_version;
    else process.env.npm_package_version = previousNpmVersion;
  }
});

test("the commit resolves from a checkout", () => {
  expect(resolveCommitShortFor(root)).toBe(git(root, "rev-parse", "--short=7", "HEAD"));
});

test("the commit resolves from a linked worktree, whose branch ref lives in the main git dir", () => {
  const linked = join(root, "linked");
  git(root, "worktree", "add", "-b", "topic", linked);
  expect(resolveCommitShortFor(linked)).toBe(git(linked, "rev-parse", "--short=7", "HEAD"));
});
