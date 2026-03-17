import { describe, expect, test } from "bun:test";
import { createStatusOutput } from "./status-format";

describe("status format", () => {
  test("maps known fields to labeled pairs", () => {
    const output = createStatusOutput({
      providers: ["openai"],
      model: "gpt-5-mini",
      permissions: "write",
      service: "http://localhost:6767",
      memory: "file (8 entries)",
    });

    expect(output?.header).toBe("Status");
    const pairs = output?.sections[0] ?? [];
    expect(pairs).toContainEqual(["Providers", "openai"]);
    expect(pairs).toContainEqual(["Model", "gpt-5-mini"]);
    expect(pairs).toContainEqual(["Permissions", "write"]);
    expect(pairs).toContainEqual(["Service", "http://localhost:6767"]);
    expect(pairs).toContainEqual(["Memory", "file (8 entries)"]);
  });

  test("returns null for empty fields", () => {
    expect(createStatusOutput({})).toBeNull();
  });

  test("joins array values with comma", () => {
    const output = createStatusOutput({
      providers: ["openai", "anthropic"],
    });
    const pairs = output?.sections[0] ?? [];
    expect(pairs).toContainEqual(["Providers", "openai, anthropic"]);
  });

  test("filters out unknown fields", () => {
    const output = createStatusOutput({
      providers: ["openai"],
      unknown_internal_field: "some_value",
    });
    const pairs = output?.sections[0] ?? [];
    expect(pairs.every(([k]: [string, string]) => k !== "Unknown internal field")).toBe(true);
    expect(pairs).toContainEqual(["Providers", "openai"]);
  });
});
