import { describe, expect, test } from "bun:test";
import { renderLogLine } from "./log";

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
});
