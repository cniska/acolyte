import { describe, expect, test } from "bun:test";
import { parseOptions } from "./om-soak";

describe("om-soak options", () => {
  test("parseOptions applies defaults", () => {
    const parsed = parseOptions([]);
    expect(parsed.turns).toBe(40);
    expect(parsed.delayMs).toBe(150);
    expect(parsed.checkpointEvery).toBe(10);
    expect(parsed.wipeBefore).toBe(false);
    expect(parsed.sessionId.startsWith("om_soak_")).toBe(true);
  });

  test("parseOptions reads explicit flags", () => {
    expect(
      parseOptions([
        "--turns",
        "20",
        "--delay-ms",
        "50",
        "--checkpoint-every",
        "5",
        "--session-id",
        "sess_a",
        "--wipe-before",
      ]),
    ).toEqual({
      turns: 20,
      delayMs: 50,
      checkpointEvery: 5,
      sessionId: "sess_a",
      wipeBefore: true,
    });
  });

  test("parseOptions accepts camelCase flag aliases", () => {
    expect(
      parseOptions([
        "--turns",
        "12",
        "--delayMs",
        "25",
        "--checkpointEvery",
        "3",
        "--sessionId",
        "sess_camel",
        "--wipeBefore",
      ]),
    ).toEqual({
      turns: 12,
      delayMs: 25,
      checkpointEvery: 3,
      sessionId: "sess_camel",
      wipeBefore: true,
    });
  });

  test("parseOptions rejects invalid numeric values", () => {
    expect(() => parseOptions(["--turns", "0"])).toThrow("Invalid --turns value.");
    expect(() => parseOptions(["--delay-ms", "-1"])).toThrow("Invalid --delay-ms value.");
    expect(() => parseOptions(["--checkpoint-every", "0"])).toThrow("Invalid --checkpoint-every value.");
  });

  test("parseOptions rejects unknown args", () => {
    expect(() => parseOptions(["--wat"])).toThrow("Unknown argument: --wat");
  });
});
