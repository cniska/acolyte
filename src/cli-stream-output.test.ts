import { describe, expect, test } from "bun:test";
import { mergeAssistantStreamOutput, missingAssistantStreamTail } from "./cli-stream-output";

describe("cli-stream-output", () => {
  test("missingAssistantStreamTail returns full output when no stream text was captured", () => {
    expect(missingAssistantStreamTail("", "hello world")).toBe("hello world");
  });

  test("missingAssistantStreamTail returns empty tail when stream already matches final output", () => {
    expect(missingAssistantStreamTail("hello world", "hello world")).toBe("");
  });

  test("missingAssistantStreamTail returns only missing suffix when stream is a prefix", () => {
    expect(missingAssistantStreamTail("hello ", "hello world")).toBe("world");
  });

  test("missingAssistantStreamTail returns empty tail when streamed content is not a prefix", () => {
    expect(missingAssistantStreamTail("hello there", "hello world")).toBe("");
  });

  test("mergeAssistantStreamOutput keeps streamed content when final output is shorter", () => {
    expect(mergeAssistantStreamOutput("hello world from stream", "hello world")).toBe("hello world from stream");
  });

  test("mergeAssistantStreamOutput appends only missing suffix when final output extends stream", () => {
    expect(mergeAssistantStreamOutput("hello ", "hello world")).toBe("hello world");
  });
});
