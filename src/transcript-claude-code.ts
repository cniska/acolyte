import { z } from "zod";
import { log } from "./log";
import { createTaskActivity, type TaskActivity } from "./task-activity";
import type { ToolCallRecord } from "./tool-contract";

const WRITE_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const DISCOVERY_TOOLS: ReadonlySet<string> = new Set(["Read", "Glob", "Grep", "NotebookRead", "WebFetch", "WebSearch"]);

const textBlockSchema = z.object({ type: z.literal("text"), text: z.string() });
const toolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()).optional(),
});
const toolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  is_error: z.boolean().optional(),
});
// Thinking, images, and anything the format grows later: read as present but carrying nothing here.
const opaqueBlockSchema = z.object({ type: z.string() }).transform(() => ({ type: "opaque" }) as const);
const contentBlockSchema = z.union([textBlockSchema, toolUseBlockSchema, toolResultBlockSchema, opaqueBlockSchema]);

const transcriptRecordSchema = z.object({
  type: z.string(),
  message: z.object({ role: z.string(), content: z.union([z.string(), z.array(contentBlockSchema)]) }).optional(),
  cwd: z.string().optional(),
  sessionId: z.string().optional(),
  timestamp: z.string().optional(),
  isMeta: z.boolean().optional(),
  isSidechain: z.boolean().optional(),
});

type TranscriptRecord = z.infer<typeof transcriptRecordSchema>;
type ContentBlock = z.infer<typeof contentBlockSchema>;

/** One user prompt and the response that closed it, with a digest of the work done in between. */
export type TranscriptExchange = {
  readonly prompt: string;
  readonly response: string;
  readonly activity: TaskActivity;
};

export type ClaudeCodeTranscript = {
  readonly sessionId: string | null;
  readonly workspaces: readonly string[];
  readonly lastActivityAt: string | null;
  readonly exchanges: readonly TranscriptExchange[];
};

function blocksOf(content: string | ContentBlock[]): ContentBlock[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

// Claude Code names a path by the tool's own argument; the activity digest reads `path`.
function toolArgs(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const args = input ?? {};
  const path = args.file_path ?? args.notebook_path ?? args.path;
  return typeof path === "string" ? { ...args, path } : args;
}

// Claude Code leaves `isMeta` off these, so the wrapper is all that marks them as not typed.
const HARNESS_PROMPT_PREFIXES: readonly string[] = [
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<local-command-stdout>",
  "<local-command-stderr>",
  "<task-notification>",
  "[Request interrupted",
];

function isHarnessPrompt(text: string): boolean {
  return HARNESS_PROMPT_PREFIXES.some((prefix) => text.startsWith(prefix));
}

type OpenExchange = {
  prompt: string;
  response: string | null;
  calls: ToolCallRecord[];
  callsById: Map<string, ToolCallRecord>;
};

function closeExchange(open: OpenExchange): TranscriptExchange | null {
  const response = open.response?.trim();
  if (!response) return null;
  return {
    prompt: open.prompt,
    response,
    activity: createTaskActivity(open.calls, WRITE_TOOLS, DISCOVERY_TOOLS),
  };
}

function joinText(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is z.infer<typeof textBlockSchema> => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function applyToolResults(open: OpenExchange | null, blocks: ContentBlock[]): void {
  if (!open) return;
  for (const block of blocks) {
    if (block.type !== "tool_result") continue;
    const call = open.callsById.get(block.tool_use_id);
    if (call && block.is_error) call.status = "failed";
  }
}

function collectAssistant(open: OpenExchange | null, blocks: ContentBlock[]): void {
  if (!open) return;
  const toolUses = blocks.filter((block): block is z.infer<typeof toolUseBlockSchema> => block.type === "tool_use");
  const text = joinText(blocks);
  if (toolUses.length > 0) open.response = null;
  else if (text) open.response = text;

  for (const block of toolUses) {
    const args = toolArgs(block.input);
    const call: ToolCallRecord = {
      toolName: block.name,
      args,
      status: "succeeded",
      ...(typeof args.command === "string" ? { command: args.command } : {}),
    };
    open.calls.push(call);
    open.callsById.set(block.id, call);
  }
}

/**
 * Replays a Claude Code session file as the exchanges Acolyte's own turns produce: a prompt, the
 * text that ended the turn, and the tool work between them. Records the format carries for its own
 * bookkeeping — snapshots, titles, queue operations — describe the log rather than the work, and a
 * sidechain is a subagent's conversation rather than this one, so neither becomes an exchange.
 */
export function parseClaudeCodeTranscript(text: string): ClaudeCodeTranscript {
  const exchanges: TranscriptExchange[] = [];
  let open: OpenExchange | null = null;
  let sessionId: string | null = null;
  const workspaces = new Set<string>();
  let lastActivityAt: string | null = null;

  let unreadable = 0;

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      unreadable++;
      continue;
    }
    const parsed = transcriptRecordSchema.safeParse(raw);
    if (!parsed.success) {
      unreadable++;
      continue;
    }
    const record: TranscriptRecord = parsed.data;
    if (record.isSidechain) continue;

    sessionId ??= record.sessionId ?? null;
    if (record.cwd) workspaces.add(record.cwd);
    if (record.timestamp) lastActivityAt = record.timestamp;

    if (!record.message) continue;
    const blocks = blocksOf(record.message.content);

    if (record.type === "assistant") {
      collectAssistant(open, blocks);
      continue;
    }
    if (record.type !== "user") continue;

    applyToolResults(open, blocks);
    if (record.isMeta) continue;
    const prompt = joinText(blocks);
    if (!prompt) continue;

    if (open) {
      const closed = closeExchange(open);
      if (closed) exchanges.push(closed);
      open = null;
    }
    if (isHarnessPrompt(prompt)) continue;
    open = { prompt, response: null, calls: [], callsById: new Map() };
  }

  if (open) {
    const closed = closeExchange(open);
    if (closed) exchanges.push(closed);
  }

  if (unreadable > 0) log.warn("import.transcript.unreadable_records", { sessionId, unreadable });

  return { sessionId, workspaces: [...workspaces], lastActivityAt, exchanges };
}
