import { describe, expect, test } from "bun:test";
import { useState } from "react";
import { clampSuggestionIndex, useSuggestions } from "./chat-effects";
import { driveHookCommits, renderHook, wait } from "./tui/test-utils";

function suggestionsHarness(initial: string) {
  return renderHook(() => {
    const [value, setValue] = useState(initial);
    return { ...useSuggestions(value), setValue };
  });
}

describe("chat effects helpers", () => {
  test("clampSuggestionIndex stays within available suggestion range", () => {
    expect(clampSuggestionIndex(3, 2)).toBe(1);
    expect(clampSuggestionIndex(-2, 2)).toBe(0);
    expect(clampSuggestionIndex(0, 0)).toBe(0);
  });

  test("suggestions never schedule an update from a commit", () => {
    const original = console.error;
    const messages: string[] = [];
    console.error = (...args: unknown[]): void => {
      messages.push(args.map(String).join(" "));
    };
    try {
      // Well past React's 50-commit nested-update limit.
      driveHookCommits(200, () => {
        useSuggestions("");
      });
    } finally {
      console.error = original;
    }
    expect(messages.filter((message) => message.includes("Maximum update depth exceeded"))).toEqual([]);
  });
});

describe("slash suggestion selection", () => {
  test("a changed candidate list returns the selection to the top match", async () => {
    const { result, unmount } = suggestionsHarness("/m");
    expect(result.current.slashSuggestions).toEqual(["/model", "/memory", "/memory rm", "/memory list"]);

    result.current.setSlashSuggestionIndex(1);
    await wait();
    expect(result.current.slashSuggestionIndex).toBe(1);

    result.current.setValue("/me");
    await wait();
    expect(result.current.slashSuggestions).toEqual(["/memory", "/memory rm", "/memory list"]);
    expect(result.current.slashSuggestionIndex).toBe(0);

    unmount();
  });

  test("an unchanged candidate list holds an arrowed-to selection across renders", async () => {
    const { result, unmount } = suggestionsHarness("/s");

    result.current.setSlashSuggestionIndex(2);
    await wait();
    expect(result.current.slashSuggestionIndex).toBe(2);

    result.current.setValue("/s");
    await wait();
    expect(result.current.slashSuggestionIndex).toBe(2);

    unmount();
  });
});
