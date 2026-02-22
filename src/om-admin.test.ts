import { describe, expect, test } from "bun:test";
import { parseArgs } from "./om-admin";

describe("om-admin args", () => {
  test("parses wipe confirmation flag", () => {
    expect(parseArgs(["--yes"])).toEqual({ yes: true, help: false, unknown: [] });
  });

  test("parses resource id with --yes", () => {
    expect(parseArgs(["resource_123", "--yes"])).toEqual({
      resourceId: "resource_123",
      yes: true,
      help: false,
      unknown: [],
    });
  });

  test("parses help flags", () => {
    expect(parseArgs(["--help"])).toEqual({
      yes: false,
      help: true,
      unknown: [],
    });
    expect(parseArgs(["-h"])).toEqual({
      yes: false,
      help: true,
      unknown: [],
    });
  });

  test("collects unknown flags and extra positional args", () => {
    expect(parseArgs(["resource_123", "extra", "--force"])).toEqual({
      resourceId: "resource_123",
      yes: false,
      help: false,
      unknown: ["extra", "--force"],
    });
  });
});
