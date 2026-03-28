import { describe, expect, test } from "bun:test";
import { parseArgs } from "./show-prompt";

describe("parseArgs", () => {
  test("parses work mode", () => {
    expect(parseArgs(["work"])).toEqual({ mode: "work", workspace: undefined });
  });

  test("parses verify mode with workspace", () => {
    expect(parseArgs(["verify", "--workspace", "/tmp/demo"])).toEqual({ mode: "verify", workspace: "/tmp/demo" });
  });

  test("rejects unknown flags", () => {
    expect(() => parseArgs(["work", "--bogus"])).toThrow("Unknown argument: --bogus");
  });
});
