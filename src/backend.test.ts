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

  test("reply maps socket-close fetch errors to backend-start hint", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("The socket connection was closed unexpectedly.");
    }) as unknown as typeof fetch;

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    await expect(
      backend.reply({
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      }),
    ).rejects.toThrow(
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

  test("reply surfaces backend error_id when present", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: "model call failed",
          errorId: "err_abc12345",
        }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    await expect(
      backend.reply({
        message: "ping",
        history: [],
        model: "gpt-5-mini",
        sessionId: "sess_test",
      }),
    ).rejects.toThrow("Remote backend error (502): model call failed [error_id=err_abc12345]");
  });
});

describe("remote backend status parsing", () => {
  test("status serializes grouped healthz payload fields", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          provider: {
            status: "openai",
            planner: "openai",
            coder: "anthropic",
            reviewer: "gemini",
            api_url: "https://api.openai.com/v1",
          },
          model: {
            status: "openai/gpt-5",
            planner: "openai/o3",
            coder: "anthropic/claude-sonnet-4",
            reviewer: "gemini/gemini-2.5-pro",
          },
          provider_ready: {
            lead: true,
            planner: true,
            coder: true,
            reviewer: false,
          },
          service: {
            status: "acolyte-backend",
            url: "http://localhost:6767",
          },
          memory: {
            status: "postgres",
            entries: 4,
          },
          om: {
            status: "enabled",
            scope: "resource",
            model: "openai/gpt-5",
            tokens: { obs: 3000, ref: 8000 },
            state: { exists: true, gen: 2 },
            last_observed: "2026-02-23T10:10:53.908Z",
            last_reflection: "2026-02-23T10:15:00.000Z",
          },
          permissions: "write",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;

    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    const status = await backend.status();

    expect(status).toContain("provider=openai");
    expect(status).toContain("model=openai/gpt-5");
    expect(status).toContain("model_planner=openai/o3");
    expect(status).toContain("model_coder=anthropic/claude-sonnet-4");
    expect(status).toContain("model_reviewer=gemini/gemini-2.5-pro");
    expect(status).toContain("provider_planner=openai");
    expect(status).toContain("provider_coder=anthropic");
    expect(status).toContain("provider_reviewer=gemini");
    expect(status).toContain("provider_ready_lead=true");
    expect(status).toContain("provider_ready_reviewer=false");
    expect(status).toContain("service=acolyte-backend");
    expect(status).toContain("url=http://localhost:6767");
    expect(status).toContain("provider_api_url=https://api.openai.com/v1");
    expect(status).toContain("memory_storage=postgres");
    expect(status).toContain("memory_context=4");
    expect(status).toContain("om=enabled");
    expect(status).toContain("om_scope=resource");
    expect(status).toContain("om_model=openai/gpt-5");
    expect(status).toContain("om_obs_tokens=3000");
    expect(status).toContain("om_ref_tokens=8000");
    expect(status).toContain("om_exists=true");
    expect(status).toContain("om_gen=2");
    expect(status).toContain("om_last_observed=2026-02-23T10:10:53.908Z");
    expect(status).toContain("om_last_reflection=2026-02-23T10:15:00.000Z");
    expect(status).toContain("permission_mode=write");
  });

  test("status serializes multi-provider model payload fields", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          provider: "openai-compatible",
          model: "openai-compatible/qwen2.5-coder",
          models: {
            lead: "openai/gpt-5-mini",
            planner: "openai/o3",
            coder: "anthropic/claude-sonnet-4",
            reviewer: "gemini/gemini-2.5-pro",
          },
          providers: {
            lead: "openai",
            planner: "openai",
            coder: "anthropic",
            reviewer: "gemini",
          },
          providerAvailability: {
            lead: true,
            planner: true,
            coder: true,
            reviewer: false,
          },
          service: "acolyte-backend",
          apiBaseUrl: "https://router.example/v1",
          permissionMode: "write",
          memory: {
            storage: "postgres",
            contextCount: 6,
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
    expect(status).toContain("model_lead=openai/gpt-5-mini");
    expect(status).toContain("model_planner=openai/o3");
    expect(status).toContain("model_coder=anthropic/claude-sonnet-4");
    expect(status).toContain("model_reviewer=gemini/gemini-2.5-pro");
    expect(status).toContain("provider_lead=openai");
    expect(status).toContain("provider_planner=openai");
    expect(status).toContain("provider_coder=anthropic");
    expect(status).toContain("provider_reviewer=gemini");
    expect(status).toContain("provider_ready_lead=true");
    expect(status).toContain("provider_ready_planner=true");
    expect(status).toContain("provider_ready_coder=true");
    expect(status).toContain("provider_ready_reviewer=false");
    expect(status).toContain("service=acolyte-backend");
    expect(status).toContain("url=http://localhost:6767");
    expect(status).toContain("provider_api_url=https://router.example/v1");
    expect(status).toContain("memory_storage=postgres");
    expect(status).toContain("memory_context=6");
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

describe("remote backend progress parsing", () => {
  test("progress returns null when no active session progress exists", async () => {
    globalThis.fetch = (async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch;
    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    await expect(backend.progress("sess_missing", 0)).resolves.toBeNull();
  });

  test("progress parses events and done flag", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          sessionId: "sess_123",
          requestId: "err_abcd",
          done: false,
          events: [
            { seq: 1, message: "Request received" },
            { seq: 2, message: "Run search-repo" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    const backend = createBackend({ apiUrl: "http://localhost:6767" });
    const progress = await backend.progress("sess_123", 0);
    expect(progress).toEqual({
      sessionId: "sess_123",
      requestId: "err_abcd",
      done: false,
      events: [
        { seq: 1, message: "Request received" },
        { seq: 2, message: "Run search-repo" },
      ],
    });
  });
});

describe("local backend status", () => {
  test("includes provider and readiness rows for role lanes", async () => {
    const backend = createBackend({ apiUrl: "" });
    const status = await backend.status();

    expect(status).toContain("provider=local-mock");
    expect(status).toContain("model=");
    expect(status).toContain("model_lead=");
    expect(status).toContain("model_planner=");
    expect(status).toContain("model_coder=");
    expect(status).toContain("model_reviewer=");
    expect(status).toContain("provider_lead=");
    expect(status).toContain("provider_planner=");
    expect(status).toContain("provider_coder=");
    expect(status).toContain("provider_reviewer=");
    expect(status).toContain("provider_ready_lead=");
    expect(status).toContain("provider_ready_planner=");
    expect(status).toContain("provider_ready_coder=");
    expect(status).toContain("provider_ready_reviewer=");
    expect(status).toContain("backend=embedded");
    expect(status).toContain("permission_mode=");
    expect(status).toContain("memory_context=");
  });
});
