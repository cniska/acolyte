import { describe, expect, test } from "bun:test";
import { withFakeProviderServer } from "./fake-provider-server";

describe("fake provider server", () => {
  test("returns deterministic response text for known prompt", async () => {
    await withFakeProviderServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-mini",
          input: [{ role: "user", content: [{ type: "input_text", text: 'Reply with exactly "ok".' }] }],
        }),
      });
      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      };
      const text = json.output?.[0]?.content?.find((part) => part.type === "output_text")?.text;
      expect(text).toBe("ok");
    });
  });

  test("returns 404 outside /v1/responses", async () => {
    await withFakeProviderServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(404);
    });
  });

  test("advances read-summarize scenario from tool-call phase to final message", async () => {
    await withFakeProviderServer(async (baseUrl) => {
      const first = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-mini",
          input: [
            { role: "user", content: [{ type: "input_text", text: "[bench:read-summarize] summarize scripts" }] },
          ],
          tools: [{ type: "function", name: "read-file" }],
        }),
      });
      const firstJson = (await first.json()) as {
        id?: string;
        output?: Array<{ type?: string; call_id?: string; name?: string }>;
      };
      expect(firstJson.output?.[0]?.type).toBe("function_call");
      expect(firstJson.output?.[0]?.call_id).toBe("call_read_pkg");
      expect(firstJson.output?.[0]?.name).toBe("read-file");

      const second = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5-mini",
          previous_response_id: firstJson.id,
          input: [{ type: "function_call_output", call_id: "call_read_pkg", output: "Read package.json" }],
        }),
      });
      const secondJson = (await second.json()) as {
        output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
      };
      expect(secondJson.output?.[0]?.type).toBe("message");
      const text = secondJson.output?.[0]?.content?.find((part) => part.type === "output_text")?.text ?? "";
      expect(text).toContain("scripts");
    });
  });
});
