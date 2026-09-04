import { describe, expect, test } from "bun:test";
import { parseClaudeCodeTranscript } from "./transcript-claude-code";

type Line = Record<string, unknown>;

function transcript(...records: Line[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

function user(content: unknown, extra: Line = {}): Line {
  return { type: "user", sessionId: "s1", cwd: "/repo", message: { role: "user", content }, ...extra };
}

function assistant(content: unknown): Line {
  return { type: "assistant", sessionId: "s1", cwd: "/repo", message: { role: "assistant", content } };
}

describe("parseClaudeCodeTranscript", () => {
  test("pairs each prompt with the text that ended the turn", () => {
    const parsed = parseClaudeCodeTranscript(
      transcript(
        user("add a flag"),
        assistant([{ type: "text", text: "Looking." }]),
        assistant([{ type: "text", text: "Added it." }]),
        user("now document it"),
        assistant([{ type: "text", text: "Documented." }]),
      ),
    );

    expect(parsed.exchanges.map((e) => [e.prompt, e.response])).toEqual([
      ["add a flag", "Added it."],
      ["now document it", "Documented."],
    ]);
  });

  test("reads the session and workspace the records carry", () => {
    const parsed = parseClaudeCodeTranscript(
      transcript(
        { type: "mode", mode: "normal", sessionId: "s1" },
        user("hello"),
        assistant([{ type: "text", text: "hi" }]),
      ),
    );

    expect(parsed.sessionId).toBe("s1");
    expect(parsed.workspace).toBe("/repo");
  });

  test("digests tool work into the exchange's activity", () => {
    const parsed = parseClaudeCodeTranscript(
      transcript(
        user("fix it"),
        assistant([{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: "src/a.ts" } }]),
        user([{ type: "tool_result", tool_use_id: "t1" }]),
        assistant([{ type: "tool_use", id: "t2", name: "Bash", input: { command: "bun test" } }]),
        user([{ type: "tool_result", tool_use_id: "t2", is_error: true }]),
        assistant([{ type: "text", text: "Fixed." }]),
      ),
    );

    expect(parsed.exchanges[0].activity).toEqual({
      filesChanged: ["src/a.ts"],
      commands: [{ command: "bun test", failed: true }],
      errors: [],
    });
  });

  test("a failed write leaves no file in the digest", () => {
    const parsed = parseClaudeCodeTranscript(
      transcript(
        user("fix it"),
        assistant([{ type: "tool_use", id: "t1", name: "Write", input: { file_path: "src/a.ts" } }]),
        user([{ type: "tool_result", tool_use_id: "t1", is_error: true }]),
        assistant([{ type: "text", text: "Blocked." }]),
      ),
    );

    expect(parsed.exchanges[0].activity.filesChanged).toEqual([]);
    expect(parsed.exchanges[0].activity.errors).toEqual([{ tool: "Write", detail: "src/a.ts" }]);
  });

  test("skips meta records and sidechains", () => {
    const parsed = parseClaudeCodeTranscript(
      transcript(
        user("<local-command-caveat>ignore me</local-command-caveat>", { isMeta: true }),
        user("real prompt"),
        {
          type: "assistant",
          isSidechain: true,
          message: { role: "assistant", content: [{ type: "text", text: "sub" }] },
        },
        assistant([{ type: "text", text: "real answer" }]),
      ),
    );

    expect(parsed.exchanges).toHaveLength(1);
    expect(parsed.exchanges[0]).toMatchObject({ prompt: "real prompt", response: "real answer" });
  });

  test("drops an exchange the assistant never answered", () => {
    const parsed = parseClaudeCodeTranscript(
      transcript(
        user("answered"),
        assistant([{ type: "text", text: "done" }]),
        user("interrupted"),
        assistant([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }]),
      ),
    );

    expect(parsed.exchanges.map((e) => e.prompt)).toEqual(["answered"]);
  });

  test("drops an exchange whose last word was progress before more tool work", () => {
    const parsed = parseClaudeCodeTranscript(
      transcript(
        user("fix it"),
        assistant([{ type: "text", text: "Now the storage row. Let me look." }]),
        assistant([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }]),
        user([{ type: "tool_result", tool_use_id: "t1" }]),
        user("never mind"),
        assistant([{ type: "text", text: "Dropped it." }]),
      ),
    );

    expect(parsed.exchanges.map((e) => [e.prompt, e.response])).toEqual([["never mind", "Dropped it."]]);
  });

  test("a step that both narrates and calls a tool has not answered", () => {
    const parsed = parseClaudeCodeTranscript(
      transcript(
        user("fix it"),
        assistant([
          { type: "text", text: "Reading the file." },
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } },
        ]),
        user([{ type: "tool_result", tool_use_id: "t1" }]),
        user("stop"),
        assistant([{ type: "text", text: "Stopped." }]),
      ),
    );

    expect(parsed.exchanges.map((e) => [e.prompt, e.response])).toEqual([["stop", "Stopped."]]);
  });

  test("skips what the harness wrote into a user record", () => {
    const parsed = parseClaudeCodeTranscript(
      transcript(
        user("ship it"),
        assistant([{ type: "text", text: "Shipped." }]),
        user("<task-notification>\n<task-id>a1</task-id>\n</task-notification>"),
        assistant([{ type: "text", text: "The agent finished." }]),
        user("<command-message>handoff</command-message>\n<command-name>/handoff</command-name>"),
        assistant([{ type: "text", text: "Wrote the handoff." }]),
        user("[Request interrupted by user]"),
        user("thanks"),
        assistant([{ type: "text", text: "Welcome." }]),
      ),
    );

    expect(parsed.exchanges.map((e) => [e.prompt, e.response])).toEqual([
      ["ship it", "Shipped."],
      ["thanks", "Welcome."],
    ]);
  });

  test("ignores unparseable lines and records it cannot read", () => {
    const parsed = parseClaudeCodeTranscript(
      [
        "{ not json",
        JSON.stringify({ type: "file-history-snapshot", messageId: "m1" }),
        "",
        transcript(
          user("hi"),
          assistant([
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "there" },
          ]),
        ),
      ].join("\n"),
    );

    expect(parsed.exchanges).toEqual([
      { prompt: "hi", response: "there", activity: { filesChanged: [], commands: [], errors: [] } },
    ]);
  });
});
