import { describe, expect, test } from "bun:test";
import { bindMcpTools, buildToolId, formatMcpResult, isInsecureRemoteHttp, sanitizeDescription } from "./mcp-client";
import type { McpServerConfig } from "./mcp-contract";
import { createSessionContext } from "./tool-session";

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

describe("isInsecureRemoteHttp", () => {
  test("returns true for http:// to remote host", () => {
    const config: McpServerConfig = { type: "http", url: "http://external.example.com/mcp" };
    expect(isInsecureRemoteHttp(config)).toBe(true);
  });

  test("returns false for https://", () => {
    const config: McpServerConfig = { type: "http", url: "https://external.example.com/mcp" };
    expect(isInsecureRemoteHttp(config)).toBe(false);
  });

  test("returns false for http://localhost", () => {
    const config: McpServerConfig = { type: "http", url: "http://localhost:3000/mcp" };
    expect(isInsecureRemoteHttp(config)).toBe(false);
  });

  test("returns false for http://127.0.0.1", () => {
    const config: McpServerConfig = { type: "http", url: "http://127.0.0.1:3000/mcp" };
    expect(isInsecureRemoteHttp(config)).toBe(false);
  });

  test("returns false for http://[::1]", () => {
    const config: McpServerConfig = { type: "http", url: "http://[::1]:3000/mcp" };
    expect(isInsecureRemoteHttp(config)).toBe(false);
  });

  test("returns false for stdio config", () => {
    const config: McpServerConfig = { type: "stdio", command: "npx" };
    expect(isInsecureRemoteHttp(config)).toBe(false);
  });
});

describe("sanitizeDescription", () => {
  test("returns raw text when within limit", () => {
    expect(sanitizeDescription("hello world", "fallback")).toBe("hello world");
  });

  test("uses fallback when raw is undefined", () => {
    expect(sanitizeDescription(undefined, "fallback")).toBe("fallback");
  });

  test("truncates text exceeding 512 chars", () => {
    const long = "a".repeat(600);
    const result = sanitizeDescription(long, "");
    expect(result.length).toBe(515); // 512 + "..."
    expect(result).toEndWith("...");
  });

  test("strips control characters", () => {
    expect(sanitizeDescription("hello\x00\x07\x1Fworld", "")).toBe("helloworld");
  });

  test("preserves newlines and tabs", () => {
    expect(sanitizeDescription("line1\nline2\ttab", "")).toBe("line1\nline2\ttab");
  });
});

describe("bindMcpTools", () => {
  // An MCP tool's instruction would be hoisted into the system prompt once per tool per
  // server, restating a description that already ships with its schema.
  test("binds tools without hoisting an instruction into the system prompt", () => {
    const config = { name: "files", type: "stdio", command: "server" } as McpServerConfig;
    const tools = bindMcpTools(
      [
        {
          serverName: "files",
          config,
          tools: [{ name: "read_file", description: "Read a file.", inputSchema: { type: "object" } }],
        },
      ],
      createSessionContext(),
      new Set(),
    );

    const bound = Object.values(tools);
    expect(bound).toHaveLength(1);
    expect(bound[0]?.description).toBe("Read a file.");
    expect(bound[0]?.instruction).toBeUndefined();
  });
});

describe("buildToolId", () => {
  test("namespaces the server and normalizes underscores", () => {
    expect(buildToolId("github", "create_issue")).toBe("mcp-github-create-issue");
  });

  test("replaces characters a provider tool name cannot carry", () => {
    expect(buildToolId("acme.tools-github", "create_issue")).toBe("mcp-acme-tools-github-create-issue");
    expect(buildToolId("my server", "run")).toBe("mcp-my-server-run");
  });
});
