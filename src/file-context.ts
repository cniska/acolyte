import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const MAX_BYTES = 200_000;
const MAX_DIR_ENTRIES = 120;
const IGNORED_DIRS = new Set([".git", "node_modules", ".acolyte", "dist", "build", ".next", "coverage"]);

function looksBinary(content: string): boolean {
  return content.includes("\u0000");
}

async function listDirectoryTree(root: string): Promise<{ lines: string[]; truncated: boolean }> {
  const lines: string[] = [];
  const stack: Array<{ abs: string; rel: string }> = [{ abs: root, rel: "" }];
  let truncated = false;

  while (stack.length > 0 && lines.length < MAX_DIR_ENTRIES) {
    const current = stack.pop();
    if (!current) {
      break;
    }
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await readdir(current.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      const abs = join(current.abs, entry.name);
      if (entry.isDirectory()) {
        lines.push(`${rel}/`);
        stack.push({ abs, rel });
      } else if (entry.isFile()) {
        lines.push(rel);
      }
      if (lines.length >= MAX_DIR_ENTRIES) {
        truncated = true;
        break;
      }
    }
  }

  return { lines, truncated };
}

export async function buildFileContext(pathInput: string): Promise<string> {
  const absPath = resolve(pathInput);
  const fileInfo = await stat(absPath);
  if (fileInfo.isDirectory()) {
    const listed = await listDirectoryTree(absPath);
    const truncatedNotice = listed.truncated ? "\n[truncated]" : "";
    return [
      `Attached directory: ${basename(absPath)}`,
      "```text",
      `${listed.lines.join("\n")}${truncatedNotice}`,
      "```",
    ].join("\n");
  }
  const buf = await readFile(absPath);
  const sliced = buf.byteLength > MAX_BYTES ? buf.subarray(0, MAX_BYTES) : buf;
  const text = sliced.toString("utf8");

  if (looksBinary(text)) {
    throw new Error(`File appears binary and cannot be inlined: ${absPath}`);
  }

  const truncatedNotice = buf.byteLength > MAX_BYTES ? "\n[truncated]" : "";
  return [
    `Attached file: ${basename(absPath)}`,
    "```text",
    `${text}${truncatedNotice}`,
    "```",
  ].join("\n");
}
