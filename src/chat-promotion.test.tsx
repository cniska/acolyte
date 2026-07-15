import { describe, expect, test } from "bun:test";
import type { ChatRow } from "./chat-contract";
import {
  appendPromotedItems,
  createHeaderItem,
  currentSegment,
  type PromotedItem,
  usePromotion,
} from "./chat-promotion";
import { createSession } from "./test-utils";
import { renderHook, wait } from "./tui/test-utils";

describe("promotion pure helpers", () => {
  test("appendPromotedItems deduplicates by id", () => {
    const current = [{ id: "a", kind: "user" as const, content: "hello" }];
    const next = [
      { id: "a", kind: "user" as const, content: "hello" },
      { id: "b", kind: "assistant" as const, content: "hi" },
    ];
    const result = appendPromotedItems(current, next);
    expect(result).toHaveLength(2);
    expect(result[1]?.id).toBe("b");
  });

  test("appendPromotedItems returns same array when nothing new", () => {
    const current = [{ id: "a", kind: "user" as const, content: "hello" }];
    const same = [{ id: "a", kind: "user" as const, content: "hello" }];
    expect(appendPromotedItems(current, same)).toBe(current);
  });

  test("currentSegment returns the tail after the last header", () => {
    const log: PromotedItem[] = [
      createHeaderItem("1.0", "sess_a"),
      { id: "row_a1", kind: "user", content: "a1" },
      { id: "row_a2", kind: "assistant", content: "a2" },
    ];
    expect(currentSegment(log)).toEqual({
      sessionId: "sess_a",
      rows: [
        { id: "row_a1", kind: "user", content: "a1" },
        { id: "row_a2", kind: "assistant", content: "a2" },
      ],
    });
  });

  test("currentSegment of a freshly opened segment is empty (post-clear)", () => {
    const log: PromotedItem[] = [
      createHeaderItem("1.0", "sess_a"),
      { id: "row_a1", kind: "user", content: "a1" },
      createHeaderItem("1.0", "sess_a"),
    ];
    expect(currentSegment(log)).toEqual({ sessionId: "sess_a", rows: [] });
  });

  test("currentSegment ignores rows from prior sessions' segments", () => {
    const log: PromotedItem[] = [
      createHeaderItem("1.0", "sess_a"),
      { id: "row_a1", kind: "user", content: "a1" },
      createHeaderItem("1.0", "sess_b"),
      { id: "row_b1", kind: "user", content: "b1" },
      { id: "row_b2", kind: "assistant", content: "b2" },
    ];
    expect(currentSegment(log)).toEqual({
      sessionId: "sess_b",
      rows: [
        { id: "row_b1", kind: "user", content: "b1" },
        { id: "row_b2", kind: "assistant", content: "b2" },
      ],
    });
  });

  test("currentSegment with no header yields a null session", () => {
    expect(currentSegment([])).toEqual({ sessionId: null, rows: [] });
  });
});

describe("usePromotion hook", () => {
  test("initializes with header and session rows", () => {
    const session = createSession({
      id: "sess_test1",
      messages: [
        { id: "msg_1", role: "user", content: "hello", timestamp: "2026-01-01T00:00:00.000Z" },
        { id: "msg_2", role: "assistant", content: "hi", timestamp: "2026-01-01T00:00:01.000Z" },
      ],
    });

    const { result, unmount } = renderHook(() =>
      usePromotion({
        version: "1.0",
        session,
        currentSessionId: session.id,
        setRows: () => {},
      }),
    );

    const { promotedRows } = result.current;
    expect(promotedRows[0]).toMatchObject({ kind: "header", id: "header_sess_test1" });
    expect(promotedRows[1]).toMatchObject({ kind: "user", content: "hello" });
    expect(promotedRows[2]).toMatchObject({ kind: "assistant", content: "hi" });

    unmount();
  });

  test("seeds from the persisted transcript when present (resume parity)", () => {
    const transcript: ChatRow[] = [
      { id: "row_u", kind: "user", content: "edit a.rs" },
      { id: "row_a", kind: "assistant", content: "Checking." },
      { id: "row_t", kind: "tool", content: { parts: [] } },
      { id: "row_b", kind: "assistant", content: "Done." },
    ];
    const session = createSession({
      id: "sess_par1",
      // Divergent messages prove the transcript, not toRows(messages), seeds the resume.
      messages: [{ id: "msg_1", role: "assistant", content: "collapsed", timestamp: "2026-01-01T00:00:00.000Z" }],
    });
    session.transcript = transcript;

    const { result, unmount } = renderHook(() =>
      usePromotion({ version: "1.0", session, currentSessionId: session.id, setRows: () => {} }),
    );

    const { promotedRows } = result.current;
    expect(promotedRows[0]).toMatchObject({ kind: "header" });
    expect(promotedRows.slice(1)).toEqual(transcript);
    unmount();
  });

  test("promoteRows appends the given finalized rows", async () => {
    const session = createSession({ id: "sess_pr1" });
    const { result, unmount } = renderHook(() =>
      usePromotion({ version: "1.0", session, currentSessionId: session.id, setRows: () => {} }),
    );

    const before = result.current.promotedRows.length;
    result.current.promoteRows([
      { id: "row_x", kind: "assistant", content: "one" },
      { id: "row_y", kind: "tool", content: { parts: [] } },
    ]);
    await wait();

    expect(result.current.promotedRows.length).toBe(before + 2);
    expect(result.current.promotedRows.some((r) => r.id === "row_x")).toBe(true);
    // Idempotent under repeat (StrictMode double-invoke): dedupes by id.
    result.current.promoteRows([{ id: "row_x", kind: "assistant", content: "one" }]);
    await wait();
    expect(result.current.promotedRows.filter((r) => r.id === "row_x")).toHaveLength(1);
    unmount();
  });

  test("clearTranscript replaces header without duplicating", async () => {
    const session = createSession({ id: "sess_clear1" });
    const { result, unmount } = renderHook(() =>
      usePromotion({
        version: "1.0",
        session,
        currentSessionId: session.id,
        setRows: () => {},
      }),
    );

    expect(result.current.promotedRows.filter((r) => r.id === "header_sess_clear1")).toHaveLength(1);

    result.current.clearTranscript();
    await wait();

    const headers = result.current.promotedRows.filter((r) => r.kind === "header");
    // Original header + new header after clear (unique IDs, no duplicates)
    expect(headers).toHaveLength(2);
    expect(headers[0]?.id).toBe("header_sess_clear1");
    expect(headers[1]?.id).toMatch(/^header_sess_clear1_/);

    // No duplicate key warnings — all IDs are unique
    const ids = result.current.promotedRows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    unmount();
  });

  test("clearTranscript empties the current session's projection", async () => {
    const session = createSession({ id: "sess_clearproj" });
    const { result, unmount } = renderHook(() =>
      usePromotion({ version: "1.0", session, currentSessionId: session.id, setRows: () => {} }),
    );
    result.current.promoteRows([{ id: "row_1", kind: "assistant", content: "before clear" }]);
    await wait();
    expect(currentSegment(result.current.promotedRows).rows).toHaveLength(1);

    result.current.clearTranscript();
    await wait();
    expect(currentSegment(result.current.promotedRows)).toEqual({ sessionId: "sess_clearproj", rows: [] });

    unmount();
  });

  test("resumeTranscript seeds a new segment from the target's transcript with fresh ids", async () => {
    const session = createSession({ id: "sess_from" });
    const { result, unmount } = renderHook(() =>
      usePromotion({ version: "1.0", session, currentSessionId: session.id, setRows: () => {} }),
    );

    const target = createSession({ id: "sess_to" });
    target.transcript = [
      { id: "row_orig1", kind: "user", content: "target q" },
      { id: "row_orig2", kind: "assistant", content: "target a" },
    ];
    result.current.resumeTranscript(target);
    await wait();

    const segment = currentSegment(result.current.promotedRows);
    expect(segment.sessionId).toBe("sess_to");
    expect(segment.rows.map((r) => [r.kind, r.content])).toEqual([
      ["user", "target q"],
      ["assistant", "target a"],
    ]);
    // Fresh ids: reusing the target's persisted ids would collide with an earlier display.
    expect(segment.rows.map((r) => r.id)).not.toEqual(["row_orig1", "row_orig2"]);
    const ids = result.current.promotedRows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    unmount();
  });

  test("resumeTranscript falls back to messages, and empty stays empty (not undefined)", async () => {
    const session = createSession({ id: "sess_from2" });
    const { result, unmount } = renderHook(() =>
      usePromotion({ version: "1.0", session, currentSessionId: session.id, setRows: () => {} }),
    );

    const withMessages = createSession({
      id: "sess_msgs",
      messages: [{ id: "msg_1", role: "user", content: "from messages", timestamp: "2026-01-01T00:00:00.000Z" }],
    });
    result.current.resumeTranscript(withMessages);
    await wait();
    expect(currentSegment(result.current.promotedRows).rows.map((r) => r.content)).toEqual(["from messages"]);

    const empty = createSession({ id: "sess_empty" });
    result.current.resumeTranscript(empty);
    await wait();
    expect(currentSegment(result.current.promotedRows)).toEqual({ sessionId: "sess_empty", rows: [] });

    unmount();
  });

  test("resume A->B->A keeps every promoted id globally unique", async () => {
    const a = createSession({ id: "sess_a" });
    a.transcript = [{ id: "row_a", kind: "assistant", content: "answer a" }];
    const { result, unmount } = renderHook(() =>
      usePromotion({
        version: "1.0",
        session: createSession({ id: "sess_seed" }),
        currentSessionId: "sess_seed",
        setRows: () => {},
      }),
    );

    const b = createSession({ id: "sess_b" });
    b.transcript = [{ id: "row_b", kind: "assistant", content: "answer b" }];
    result.current.resumeTranscript(a);
    await wait();
    result.current.resumeTranscript(b);
    await wait();
    result.current.resumeTranscript(a);
    await wait();

    const ids = result.current.promotedRows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The last segment is A again, rendered afresh — not deduped away.
    expect(currentSegment(result.current.promotedRows).rows.map((r) => r.content)).toEqual(["answer a"]);

    unmount();
  });

  test("resume does not leak the outgoing session's rows into the incoming projection", async () => {
    // The bug: the sync effect projects currentSegment into currentSession.transcript.
    // Before the segment scoping, resuming B while A's rows were still in the log wrote
    // A's rows into B.transcript. This mirrors that effect against the real hook.
    const a = createSession({ id: "sess_leak_a" });
    const { result, unmount } = renderHook(() =>
      usePromotion({ version: "1.0", session: a, currentSessionId: a.id, setRows: () => {} }),
    );
    result.current.promoteRows([{ id: "row_a1", kind: "assistant", content: "A only" }]);
    await wait();

    const b = createSession({ id: "sess_leak_b" });
    result.current.resumeTranscript(b);
    await wait();

    // Emulate chat-state's guarded sync effect for the now-current session B.
    const segment = currentSegment(result.current.promotedRows);
    if (segment.sessionId === b.id) b.transcript = segment.rows;
    expect(b.transcript).toEqual([]);
    expect(b.transcript?.some((r) => r.content === "A only")).toBe(false);

    unmount();
  });

  test("promote moves live rows to promoted", async () => {
    const session = createSession({ id: "sess_p1" });
    const liveRows: ChatRow[] = [{ id: "row_1", kind: "user", content: "hello" }];
    let rowsState = liveRows;

    const { result, unmount } = renderHook(() =>
      usePromotion({
        version: "1.0",
        session,
        currentSessionId: session.id,
        setRows: (updater) => {
          rowsState = updater(rowsState);
        },
      }),
    );

    const before = result.current.promotedRows.length;
    result.current.promote();
    await wait();

    expect(result.current.promotedRows.length).toBeGreaterThan(before);
    expect(result.current.promotedRows.some((r) => r.id === "row_1")).toBe(true);
    expect(rowsState).toEqual([]);

    unmount();
  });
});
