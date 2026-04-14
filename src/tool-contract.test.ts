import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createTool } from "./tool-contract";

describe("createTool", () => {
  test("parses zod input before execute", async () => {
    let seen: unknown;
    const tool = createTool({
      id: "test-zod-input",
      toolkit: "test",
      category: "read",
      description: "test",
      instruction: "test",
      inputSchema: z.object({ path: z.string() }),
      outputSchema: z.object({ ok: z.literal(true) }),
      execute: async (input) => {
        seen = input;
        return { result: { ok: true as const } };
      },
    });

    await tool.execute({ path: "src/index.ts", extra: 1 } as unknown as { path: string }, "call_1");
    expect(seen).toEqual({ path: "src/index.ts" });
  });

  test("rejects invalid zod input", async () => {
    const tool = createTool({
      id: "test-zod-invalid",
      toolkit: "test",
      category: "read",
      description: "test",
      instruction: "test",
      inputSchema: z.object({ path: z.string().min(1) }),
      outputSchema: z.object({ ok: z.literal(true) }),
      execute: async () => ({ result: { ok: true as const } }),
    });

    await expect(tool.execute({ path: "" } as unknown as { path: string }, "call_2")).rejects.toThrow();
  });

  test("passes through input for raw json schema tools", async () => {
    let seen: unknown;
    const tool = createTool({
      id: "test-json-schema",
      toolkit: "test",
      category: "network",
      description: "test",
      instruction: "test",
      inputSchema: {
        type: "object",
        properties: { q: { type: "string" } },
        required: ["q"],
      },
      outputSchema: z.object({ ok: z.literal(true) }),
      execute: async (input) => {
        seen = input;
        return { result: { ok: true as const } };
      },
    });

    await tool.execute({ q: "hello", extra: true } as unknown as { q: string }, "call_3");
    expect(seen).toEqual({ q: "hello", extra: true });
  });

  test("stores json-schema form on tool definition", () => {
    const tool = createTool({
      id: "test-json-schema-shape",
      toolkit: "test",
      category: "read",
      description: "test",
      instruction: "test",
      inputSchema: z.object({ path: z.string() }),
      outputSchema: z.object({ ok: z.literal(true) }),
      execute: async () => ({ result: { ok: true as const } }),
    });

    expect("$schema" in tool.inputSchema).toBe(false);
    expect(tool.inputSchema.type).toBe("object");
  });
});
