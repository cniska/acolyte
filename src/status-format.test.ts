import { afterEach, describe, expect, test } from "bun:test";
import { setLocale } from "./i18n";
import { createStatusOutput } from "./status-format";

describe("status format", () => {
  afterEach(() => {
    setLocale("en");
  });

  test("labels follow the locale set after the module loads", () => {
    setLocale("fi");
    const pairs = createStatusOutput({ model: "gpt-5-mini" })?.sections[0] ?? [];
    expect(pairs).toContainEqual(["Malli", "gpt-5-mini"]);
  });

  test("maps known fields to labeled pairs", () => {
    const output = createStatusOutput({
      provider_auth: ["openai (api key)"],
      model: "gpt-5-mini",
      service: "http://localhost:6767",
    });

    expect(output?.header).toBe("Status");
    const pairs = output?.sections[0] ?? [];
    expect(pairs).toContainEqual(["Providers", "openai (api key)"]);
    expect(pairs).toContainEqual(["Model", "gpt-5-mini"]);
    expect(pairs).toContainEqual(["Service", "http://localhost:6767"]);
  });

  test("labels the memory summary the daemon emits", () => {
    const output = createStatusOutput({ memory: "sqlite (142 entries)" });
    const pairs = output?.sections[0] ?? [];
    expect(pairs).toContainEqual(["Memory", "sqlite (142 entries)"]);
  });

  test("surfaces resource diagnostics the daemon emits", () => {
    const output = createStatusOutput({
      model: "gpt-5-mini",
      "resources.prompt.agents": "missing_or_unreadable",
      "resources.skills.invalid": 2,
      "resources.config.collisions": "project,user",
    });
    const pairs = output?.sections[0] ?? [];
    expect(pairs).toContainEqual(["Agents file", "missing_or_unreadable"]);
    expect(pairs).toContainEqual(["Invalid skills", "2"]);
    expect(pairs).toContainEqual(["Config file collisions", "project,user"]);
  });

  test("drops labels the daemon never emits", () => {
    const output = createStatusOutput({
      model: "gpt-5-mini",
      active_skill: "review",
    });
    const pairs = output?.sections[0] ?? [];
    expect(pairs.map(([k]: [string, string]) => k)).toEqual(["Model"]);
  });

  test("returns null for empty fields", () => {
    expect(createStatusOutput({})).toBeNull();
  });

  test("joins array values with comma", () => {
    const output = createStatusOutput({
      provider_auth: ["openai (subscription + api key)", "anthropic (api key)"],
    });
    const pairs = output?.sections[0] ?? [];
    expect(pairs).toContainEqual(["Providers", "openai (subscription + api key), anthropic (api key)"]);
  });

  test("filters out unknown fields", () => {
    const output = createStatusOutput({
      provider_auth: ["openai (api key)"],
      unknown_internal_field: "some_value",
    });
    const pairs = output?.sections[0] ?? [];
    expect(pairs.every(([k]: [string, string]) => k !== "Unknown internal field")).toBe(true);
    expect(pairs).toContainEqual(["Providers", "openai (api key)"]);
  });
});
