import { describe, expect, test } from "bun:test";
import { errorToLogFields, renderLogLine } from "./log";

describe("log", () => {
  test("renderLogLine includes level, message, and fields", () => {
    const line = renderLogLine("info", "hello world", { service: "acolyte", ok: true, count: 2 });
    expect(line).toContain("level=info");
    expect(line).toContain('msg="hello world"');
    expect(line).toContain("service=acolyte");
    expect(line).toContain("ok=true");
    expect(line).toContain("count=2");
  });

  test("renderLogLine supports json output", () => {
    const line = renderLogLine("warn", "be careful", { service: "acolyte" }, "json");
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("warn");
    expect(parsed.msg).toBe("be careful");
    expect(parsed.service).toBe("acolyte");
  });

  test("renderLogLine escapes logfmt fields with spaces", () => {
    const line = renderLogLine("info", "quoted", { detail: "failed to read file", scope: "src/app.ts" });
    expect(line).toContain('detail="failed to read file"');
    expect(line).toContain("scope=src/app.ts");
  });

  test("renderLogLine redacts sensitive fields", () => {
    const line = renderLogLine("info", "auth check", {
      apiKey: "sk-test-secret",
      authorization: "Bearer abc123",
      session_token: "session-secret",
      inputTokens: 1200,
    });
    expect(line).toContain('apiKey="[REDACTED]"');
    expect(line).toContain('authorization="[REDACTED]"');
    expect(line).toContain('session_token="[REDACTED]"');
    expect(line).toContain("inputTokens=1200");
  });

  test("renderLogLine redacts secret-like values in messages and fields", () => {
    const line = renderLogLine("warn", "failed Bearer abc123 apiKey=xyz sk-1234567890", {
      detail: "request ?apiKey=hello&x=1 failed with Bearer qwerty",
    });
    expect(line).toContain('msg="failed Bearer [REDACTED] apiKey=[REDACTED] [REDACTED]"');
    expect(line).toContain('detail="request ?apiKey=[REDACTED]&x=1 failed with Bearer [REDACTED]"');
  });

  test("renderLogLine redacts sensitive fields in json mode", () => {
    const line = renderLogLine("warn", "be careful", { api_key: "abc", cookie: "session=secret" }, "json");
    const parsed = JSON.parse(line);
    expect(parsed.api_key).toBe("[REDACTED]");
    expect(parsed.cookie).toBe("[REDACTED]");
  });

  test("errorToLogFields captures error details", () => {
    const fields = errorToLogFields(new Error("boom"));
    expect(fields.error_name).toBe("Error");
    expect(fields.error_message).toBe("boom");
    expect(typeof fields.error_stack).toBe("string");
  });
});
