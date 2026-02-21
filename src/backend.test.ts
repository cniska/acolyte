import { afterEach, describe, expect, test } from "bun:test";
import { createBackend } from "./backend";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("remote backend connection errors", () => {
  test("status surfaces a user-friendly backend-start hint on connection failure", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Unable to connect. Is the computer able to access the url?");
    }) as unknown as typeof fetch;

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    await expect(backend.status()).rejects.toThrow(
      "Cannot reach backend at http://localhost:6767. Start it with: bun run dev (or bun run serve:env)",
    );
  });

  test("reply preserves non-connection errors", async () => {
    globalThis.fetch = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    await expect(
      backend.reply({
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      }),
    ).rejects.toThrow("boom");
  });
});

describe("remote backend status parsing", () => {
  test("status serializes multi-provider model payload fields", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          provider: "openai-compatible",
          model: "openai-compatible/qwen2.5-coder",
          models: {
            main: "openai/gpt-5-mini",
            planner: "openai/o3",
            coder: "anthropic/claude-sonnet-4",
            reviewer: "gemini/gemini-2.5-pro",
          },
          providers: {
            main: "openai",
            planner: "openai",
            coder: "anthropic",
            reviewer: "gemini",
          },
          providerAvailability: {
            main: true,
            planner: true,
            coder: true,
            reviewer: false,
          },
          service: "acolyte-backend",
          apiBaseUrl: "https://router.example/v1",
          permissionMode: "write",
          memory: {
            storage: "postgres",
            observational: {
              enabled: true,
              scope: "resource",
              model: "openai/gpt-5-mini",
              observationTokens: 3000,
              reflectionTokens: 8000,
              current: {
                exists: true,
                generationCount: 3,
                lastObservedAt: "2026-02-21T10:10:53.908Z",
                lastReflectionAt: "2026-02-21T10:15:00.000Z",
              },
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    const status = await backend.status();

    expect(status).toContain("provider=openai-compatible");
    expect(status).toContain("model=openai-compatible/qwen2.5-coder");
    expect(status).toContain("model_main=openai/gpt-5-mini");
    expect(status).toContain("model_planner=openai/o3");
    expect(status).toContain("model_coder=anthropic/claude-sonnet-4");
    expect(status).toContain("model_reviewer=gemini/gemini-2.5-pro");
    expect(status).toContain("provider_main=openai");
    expect(status).toContain("provider_planner=openai");
    expect(status).toContain("provider_coder=anthropic");
    expect(status).toContain("provider_reviewer=gemini");
    expect(status).toContain("provider_ready_main=true");
    expect(status).toContain("provider_ready_planner=true");
    expect(status).toContain("provider_ready_coder=true");
    expect(status).toContain("provider_ready_reviewer=false");
    expect(status).toContain("service=acolyte-backend");
    expect(status).toContain("url=http://localhost:6767");
    expect(status).toContain("api_base_url=https://router.example/v1");
    expect(status).toContain("memory_storage=postgres");
    expect(status).toContain("om=enabled");
    expect(status).toContain("om_scope=resource");
    expect(status).toContain("om_model=openai/gpt-5-mini");
    expect(status).toContain("om_obs_tokens=3000");
    expect(status).toContain("om_ref_tokens=8000");
    expect(status).toContain("om_exists=true");
    expect(status).toContain("om_gen=3");
    expect(status).toContain("om_last_observed=2026-02-21T10:10:53.908Z");
    expect(status).toContain("om_last_reflection=2026-02-21T10:15:00.000Z");
    expect(status).toContain("permission_mode=write");
  });

  test("status falls back to mode when provider is absent", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          mode: "mock",
          service: "acolyte-backend",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    const status = await backend.status();

    expect(status).toContain("provider=mock");
    expect(status).toContain("service=acolyte-backend");
    expect(status).toContain("url=http://localhost:6767");
  });
});

describe("local backend status", () => {
  test("includes provider and role model fields for consistent status formatting", async () => {
    const backend = createBackend();
    const status = await backend.status();

    expect(status).toContain("provider=local-mock");
    expect(status).toContain("model=");
    expect(status).toContain("model_main=");
    expect(status).toContain("model_planner=");
    expect(status).toContain("model_coder=");
    expect(status).toContain("model_reviewer=");
    expect(status).toContain("backend=embedded");
    expect(status).toContain("permission_mode=");
  });
});
