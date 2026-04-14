import { describe, expect, test } from "bun:test";
import { formatMcpResult } from "./mcp-client";

describe("formatMcpResult", () => {
  test("concatenates text content blocks", () => {
    const result = formatMcpResult({
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ],
    });
    expect(result).toBe("hello\nworld");
  });

  test("formats image blocks as placeholder", () => {
    const result = formatMcpResult({
      content: [{ type: "image", mimeType: "image/png", data: "base64data" }],
    });
    expect(result).toBe("[image: image/png]");
  });

  test("formats resource blocks with text inline", () => {
    const result = formatMcpResult({
      content: [
        { type: "resource", resource: { uri: "file://foo.txt", mimeType: "text/plain", text: "file content" } },
      ],
    });
    expect(result).toBe("file content");
  });

  test("formats binary resource blocks by URI", () => {
    const result = formatMcpResult({
      content: [{ type: "resource", resource: { uri: "file://image.png", mimeType: "image/png", blob: "b64" } }],
    });
    expect(result).toBe("[resource: file://image.png]");
  });

  test("prefixes error results", () => {
    const result = formatMcpResult({
      content: [{ type: "text", text: "something went wrong" }],
      isError: true,
    });
    expect(result).toStartWith("[mcp-error]");
    expect(result).toContain("something went wrong");
  });

  test("handles legacy format without content as empty string", () => {
    // Legacy MCP protocol returned toolResult instead of content array.
    // CallToolResultSchema adds content: [] as default, so it parses successfully.
    const result = formatMcpResult({ toolResult: "raw value" } as never);
    expect(result).toBe("");
  });

  test("returns empty string for empty content", () => {
    const result = formatMcpResult({ content: [] });
    expect(result).toBe("");
  });
});
