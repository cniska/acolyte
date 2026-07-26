import { expect, test } from "bun:test";
import { usePendingState } from "./chat-pending";
import { renderHook } from "./tui/test-utils";

test("isPending reflects the pending state before React commits it", () => {
  const { result, unmount } = renderHook(() => usePendingState());

  expect(result.current.isPending()).toBe(false);

  result.current.setPendingState({ kind: "running" });
  expect(result.current.isPending()).toBe(true);
  expect(result.current.pendingState).toBeNull();

  result.current.setPendingState(null);
  expect(result.current.isPending()).toBe(false);

  unmount();
});
