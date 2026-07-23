import { describe, expect, test } from "bun:test";
import { appendPromotedSlices, createHeaderSlice, resumeActiveTranscript, useScenePromotion } from "./chat-promotion";
import type { TranscriptRow } from "./chat-transcript-contract";
import { createSession } from "./test-utils";
import type { PromotedSceneSlice } from "./tui/scene-viewport";
import { renderHook, wait } from "./tui/test-utils";

const slice = (id: string): PromotedSceneSlice => ({ id, lines: [{ spans: [{ text: id, role: "plain" }] }] });

describe("resumeActiveTranscript", () => {
  test("seeds rows and presentation from the semantic transcript with matching ids", () => {
    const presentation: TranscriptRow[] = [
      { id: "row_u", kind: "user", status: "complete", content: { kind: "message", text: "edit a.rs" } },
      { id: "row_a", kind: "assistant", status: "complete", content: { kind: "message", text: "done" } },
    ];
    const session = createSession({ id: "sess_r1" });
    session.transcriptPresentation = presentation;

    const seed = resumeActiveTranscript(session);
    expect(seed.presentation).toEqual(presentation);
    expect(seed.rows).toEqual([
      { id: "row_u", kind: "user", content: "edit a.rs" },
      { id: "row_a", kind: "assistant", content: "done" },
    ]);
  });

  test("freshIds re-ids rows and presentation together so the projection still matches", () => {
    const session = createSession({ id: "sess_r2" });
    session.transcriptPresentation = [
      { id: "row_a", kind: "assistant", status: "complete", content: { kind: "message", text: "hi" } },
    ];
    const seed = resumeActiveTranscript(session, true);
    expect(seed.presentation[0]?.id).not.toBe("row_a");
    expect(seed.rows[0]?.id).toBe(seed.presentation[0]?.id);
  });

  test("clamps a persisted active status to complete so promotion is not front-anchored forever", () => {
    const session = createSession({ id: "sess_active" });
    session.transcriptPresentation = [
      { id: "row_t", kind: "tool", status: "active", content: { kind: "tool-output", output: { parts: [] } } },
    ];
    expect(resumeActiveTranscript(session).presentation[0]?.status).toBe("complete");
  });

  test("falls back to migrating messages when there is no semantic transcript", () => {
    const session = createSession({
      id: "sess_r3",
      messages: [{ id: "msg_1", role: "user", content: "hello", timestamp: "2026-01-01T00:00:00.000Z" }],
    });
    const seed = resumeActiveTranscript(session);
    expect(seed.rows).toEqual([{ id: "row_1", kind: "user", content: "hello" }]);
    expect(seed.presentation).toEqual([
      { id: "row_1", kind: "user", status: "complete", content: { kind: "message", text: "hello" } },
    ]);
  });
});

describe("createHeaderSlice", () => {
  test("keeps the bare id for segment 0 and versions later segments", () => {
    expect(createHeaderSlice("1.0", "sess_h", 0).id).toBe("header_sess_h");
    expect(createHeaderSlice("1.0", "sess_h", 2).id).toBe("header_sess_h_2");
    expect(createHeaderSlice("1.0", "sess_h", 0).lines.length).toBeGreaterThan(0);
  });
});

describe("appendPromotedSlices", () => {
  test("appends new slices and dedupes by id", () => {
    const current = [slice("header_sess"), slice("row_1")];
    const result = appendPromotedSlices(current, [slice("row_1"), slice("row_2")]);
    expect(result.map((s) => s.id)).toEqual(["header_sess", "row_1", "row_2"]);
  });

  test("returns the same array when nothing is new", () => {
    const current = [slice("row_1")];
    expect(appendPromotedSlices(current, [slice("row_1")])).toBe(current);
  });
});

describe("useScenePromotion", () => {
  test("seeds scrollback with the session's header slice", () => {
    const session = createSession({ id: "sess_seed" });
    const { result, unmount } = renderHook(() => useScenePromotion({ version: "1.0", session }));
    expect(result.current.promotedSlices.map((s) => s.id)).toEqual(["header_sess_seed"]);
    unmount();
  });

  test("appendSlices commits new slices and stays idempotent under repeats", async () => {
    const session = createSession({ id: "sess_seed" });
    const { result, unmount } = renderHook(() => useScenePromotion({ version: "1.0", session }));
    result.current.appendSlices([slice("row_1")]);
    await wait();
    result.current.appendSlices([slice("row_1")]);
    await wait();
    expect(result.current.promotedSlices.map((s) => s.id)).toEqual(["header_sess_seed", "row_1"]);
    unmount();
  });

  test("openSegment appends a versioned header so a re-opened session never collides", async () => {
    const session = createSession({ id: "sess_a" });
    const { result, unmount } = renderHook(() => useScenePromotion({ version: "1.0", session }));
    result.current.openSegment("sess_b");
    await wait();
    result.current.openSegment("sess_a");
    await wait();
    const ids = result.current.promotedSlices.map((s) => s.id);
    expect(ids).toEqual(["header_sess_a", "header_sess_b_1", "header_sess_a_2"]);
    expect(new Set(ids).size).toBe(ids.length);
    unmount();
  });
});
