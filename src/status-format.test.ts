import { describe, expect, test } from "bun:test";
import { formatStatusOutput } from "./status-format";

describe("status format", () => {
  test("formats flat key-value pairs with aligned columns", () => {
    const output = formatStatusOutput({
      providers: ["openai"],
      model: "gpt-5-mini",
      permissions: "write",
      service: "http://localhost:6767",
      memory: "postgres (8 entries)",
    });

    expect(output).toMatch(/^providers:\s+openai$/m);
    expect(output).toMatch(/^model:\s+gpt-5-mini$/m);
    expect(output).toMatch(/^permissions:\s+write$/m);
    expect(output).toMatch(/^service:\s+http:\/\/localhost:6767$/m);
    expect(output).toMatch(/^memory:\s+postgres \(8 entries\)$/m);
  });

  test("returns empty string for empty fields", () => {
    expect(formatStatusOutput({})).toBe("");
  });

  test("includes observational memory", () => {
    const output = formatStatusOutput({
      providers: ["openai", "anthropic"],
      observational_memory: "enabled (resource)",
    });
    expect(output).toMatch(/^providers:\s+openai, anthropic$/m);
    expect(output).toMatch(/^observational_memory:\s+enabled \(resource\)$/m);
  });
});
