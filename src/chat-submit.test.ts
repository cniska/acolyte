import { describe, expect, test } from "bun:test";
import {
  dequeueQueuedMessage,
  drainQueueOnTurnEnd,
  enqueueQueuedMessage,
  resolveQueueSubmit,
  resolveSubmitInput,
} from "./chat-submit";

describe("chat submit helpers", () => {
  test("autocompletes unresolved @path on submit", () => {
    const result = resolveSubmitInput({
      value: "review @src/ch",
      atSuggestions: ["src/chat-ui.tsx"],
      atSuggestionIndex: 0,
      slashSuggestions: [],
      slashSuggestionIndex: 0,
    });
    expect(result).toEqual({ kind: "autocomplete", value: "review @src/chat-ui.tsx " });
  });

  test("autocompletes unresolved slash command on submit", () => {
    const result = resolveSubmitInput({
      value: "/st",
      atSuggestions: [],
      atSuggestionIndex: 0,
      slashSuggestions: ["/status"],
      slashSuggestionIndex: 0,
    });
    expect(result).toEqual({ kind: "autocomplete", value: "/status" });
  });

  test("submits when no autocomplete rule applies", () => {
    const result = resolveSubmitInput({
      value: "hello world",
      atSuggestions: [],
      atSuggestionIndex: 0,
      slashSuggestions: [],
      slashSuggestionIndex: 0,
    });
    expect(result).toEqual({ kind: "submit", value: "hello world" });
  });

  test("resolveQueueSubmit ignores empty input", () => {
    expect(resolveQueueSubmit({ value: "   ", isPending: true })).toEqual({ kind: "ignore" });
  });

  test("resolveQueueSubmit submits while thinking", () => {
    expect(resolveQueueSubmit({ value: "hello", isPending: true })).toEqual({
      kind: "submit",
      value: "hello",
    });
  });

  test("resolveQueueSubmit submits slash commands while thinking", () => {
    expect(resolveQueueSubmit({ value: "/status", isPending: true })).toEqual({
      kind: "submit",
      value: "/status",
    });
  });

  test("resolveQueueSubmit submits immediately when idle", () => {
    expect(resolveQueueSubmit({ value: "hello", isPending: false })).toEqual({
      kind: "submit",
      value: "hello",
    });
  });

  test("enqueueQueuedMessage keeps only latest prompt in one-at-a-time mode", () => {
    expect(enqueueQueuedMessage(["first", "second"], "latest", "one-at-a-time")).toEqual(["latest"]);
  });

  test("enqueueQueuedMessage appends in all mode", () => {
    expect(enqueueQueuedMessage(["first", "second"], "latest", "all")).toEqual(["first", "second", "latest"]);
  });

  test("dequeueQueuedMessage splits head from rest", () => {
    expect(dequeueQueuedMessage(["one", "two"])).toEqual({ next: "one", rest: ["two"] });
    expect(dequeueQueuedMessage([])).toEqual({ next: undefined, rest: [] });
  });

  // A queued slash command must reach the transcript once. The original bug scheduled
  // the resubmit inside the queue state updater, so React's StrictMode double-invoke of
  // that updater submitted the command twice. This harness double-invokes the updater
  // (discarding the first result, like StrictMode) and asserts a single submit.
  test("drainQueueOnTurnEnd submits the head once under a double-invoked updater", () => {
    const submitted: string[] = [];
    let queue = ["/model"];
    const setQueue = (updater: (current: string[]) => string[]): void => {
      updater([...queue]); // StrictMode extra invocation — result discarded
      queue = updater(queue); // real invocation — committed
    };

    drainQueueOnTurnEnd({ queue, submit: (message) => submitted.push(message), setQueue });

    expect(submitted).toEqual(["/model"]);
    expect(queue).toEqual([]);
  });

  test("drainQueueOnTurnEnd does nothing on an empty queue", () => {
    const submitted: string[] = [];
    let queue: string[] = [];
    drainQueueOnTurnEnd({
      queue,
      submit: (message) => submitted.push(message),
      setQueue: (updater) => {
        queue = updater(queue);
      },
    });
    expect(submitted).toEqual([]);
    expect(queue).toEqual([]);
  });
});
