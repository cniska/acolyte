import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const MAX_BYTES = 200_000;

function looksBinary(content: string): boolean {
  return content.includes("\u0000");
}

export async function buildFileContext(pathInput: string): Promise<string> {
  const absPath = resolve(pathInput);
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

