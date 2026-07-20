import { describe, expect, test } from "bun:test";
import { parseStatusFields } from "./status-contract";

describe("parseStatusFields", () => {
  test("returns fields for valid status payload", () => {
    const fields = parseStatusFields({
      ok: true,
      providers: ["openai"],
      provider_auth: ["openai (api key)"],
      model: "gpt-5-mini",
      protocol_version: "1",
      capabilities: "chat",
      service: "acolyte",
      tasks_total: 0,
      tasks_running: 0,
      rpc_queue_length: 0,
    });
    expect(fields).not.toBeNull();
    expect(fields?.provider_auth).toEqual(["openai (api key)"]);
    expect(fields?.model).toBe("gpt-5-mini");
    expect(fields).not.toHaveProperty("ok");
  });

  test("returns null for invalid payload", () => {
    expect(parseStatusFields({})).toBeNull();
    expect(parseStatusFields(null)).toBeNull();
  });
});
