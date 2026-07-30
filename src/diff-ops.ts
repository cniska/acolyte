import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hermeticGitEnv, requireGitVersion } from "./git-ops";
import { runCommand } from "./tool-utils";

const DIFF_CONTEXT_LINES = 3;
const NULL_PATH = "/dev/null";

// The path git prints in the diff header, so it has to stay relative for `a/<path>` to name a
// file inside the scratch directory. A workspace whose files sit above it reports them as
// absolute, which would otherwise resolve out of the scratch tree.
function scratchRelativePath(displayPath: string): string {
  const segments = displayPath
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  return segments.length > 0 ? segments.join("/") : "file";
}

async function writeSide(root: string, side: string, relativePath: string, content: string | null): Promise<string> {
  if (content == null) return NULL_PATH;
  const sidePath = join(side, relativePath);
  const absPath = join(root, sidePath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, content, "utf8");
  return sidePath;
}

// Diffing two scratch images rather than the workspace file keeps a repository's own
// `.gitattributes` — which can declare a path binary or route it through a diff driver — from
// deciding what Acolyte reports about a file it just wrote. GIT_CEILING_DIRECTORIES stops the
// walk before any repository above the scratch directory is discovered.
export async function createDiff(input: {
  displayPath: string;
  previous: string | null;
  next: string | null;
}): Promise<string> {
  await requireGitVersion();
  const relativePath = scratchRelativePath(input.displayPath);
  const root = await mkdtemp(join(tmpdir(), "acolyte-diff-"));
  try {
    const previousPath = await writeSide(root, "a", relativePath, input.previous);
    const nextPath = await writeSide(root, "b", relativePath, input.next);
    const { code, stdout, stderr } = await runCommand(
      [
        "git",
        "-c",
        "core.quotePath=false",
        "diff",
        "--no-index",
        "--no-prefix",
        "--indent-heuristic",
        `--unified=${DIFF_CONTEXT_LINES}`,
        "--",
        previousPath,
        nextPath,
      ],
      root,
      hermeticGitEnv({ GIT_CEILING_DIRECTORIES: root }),
    );
    // `git diff --no-index` reports difference through its exit status: 0 identical, 1 differs.
    if (code > 1) throw new Error(stderr.trim() || "git diff failed");
    return stdout.trim();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
