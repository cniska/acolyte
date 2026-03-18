import { describe, expect, test } from "bun:test";
import { appendPromotedItems, applyPromotion, usePromotion } from "./chat-promotion";
import { createSession } from "./test-utils";
import { renderHook, wait } from "./tui-test-utils";

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

  test("applyPromotion splits live rows into promoted and surviving", () => {
    const promoted: never[] = [];
    const captured = [
      { id: "row_1", kind: "user" as const, content: "hello" },
      { id: "row_2", kind: "assistant" as const, content: "hi" },
    ];
    const live = [...captured, { id: "row_3", kind: "system" as const, content: "output" }];
    const { nextPromoted, nextLive } = applyPromotion(promoted, captured, live);
    expect(nextPromoted).toEqual(captured);
    expect(nextLive).toEqual([{ id: "row_3", kind: "system", content: "output" }]);
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
        rowsRef: { current: [] },
        setRows: () => {},
      }),
    );

    const { promotedRows } = result.current;
    expect(promotedRows[0]).toMatchObject({ kind: "header", id: "header_sess_test1" });
    expect(promotedRows[1]).toMatchObject({ kind: "user", content: "hello" });
    expect(promotedRows[2]).toMatchObject({ kind: "assistant", content: "hi" });

    unmount();
  });

  test("promote moves live rows to promoted", async () => {
    const session = createSession({ id: "sess_p1" });
    const liveRows = [{ id: "row_1", kind: "user" as const, content: "hello" }];
    const rowsRef = { current: liveRows };
    let rowsState = liveRows;

    const { result, unmount } = renderHook(() =>
      usePromotion({
        version: "1.0",
        session,
        currentSessionId: session.id,
        rowsRef,
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

    unmount();
  });
});
