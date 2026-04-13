import { describe, expect, test } from "bun:test";
import { parseStatusFields } from "./status-contract";

describe("parseStatusFields", () => {
  test("returns fields for valid status payload", () => {
    const fields = parseStatusFields({
      ok: true,
      providers: ["openai"],
      model: "gpt-5-mini",
      protocol_version: "1",
      capabilities: "chat",
      service: "acolyte",
      tasks_total: 0,
      tasks_running: 0,
      tasks_detached: 0,
      rpc_queue_length: 0,
    });
    expect(fields).not.toBeNull();
    expect(fields?.providers).toEqual(["openai"]);
    expect(fields?.model).toBe("gpt-5-mini");
    expect(fields).not.toHaveProperty("ok");
  });

  test("returns null for invalid payload", () => {
    expect(parseStatusFields({})).toBeNull();
    expect(parseStatusFields(null)).toBeNull();
  });
});
