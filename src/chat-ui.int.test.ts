import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCachedRepoPathCandidates, invalidateRepoPathCandidates } from "./chat-file-ref";

describe("chat-ui integration helpers", () => {
  test("getCachedRepoPathCandidates refreshes after invalidation", async () => {
    const root = await mkdtemp(join(tmpdir(), "acolyte-at-cache-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "a", "utf8");
    const first = await getCachedRepoPathCandidates(root);
    expect(first).toContain("src/a.ts");
    expect(first).not.toContain("sum.rs");
    await writeFile(join(root, "sum.rs"), "fn main() {}", "utf8");
    const stale = await getCachedRepoPathCandidates(root);
    expect(stale).not.toContain("sum.rs");
    invalidateRepoPathCandidates(root);
    const refreshed = await getCachedRepoPathCandidates(root);
    expect(refreshed).toContain("sum.rs");
  });
});
