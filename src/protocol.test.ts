import { describe, expect, test } from "bun:test";
import { formatServerCapabilities, PROTOCOL_VERSION } from "./protocol";

describe("protocol metadata", () => {
  test("exposes stable protocol version", () => {
    expect(PROTOCOL_VERSION).toBe("1");
  });

  test("formats server capabilities as deterministic csv", () => {
    expect(formatServerCapabilities()).toBe("error.structured, permissions.mode, stream.sse, workspace.path");
  });
});
