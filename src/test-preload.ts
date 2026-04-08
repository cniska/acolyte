import { setLogSink } from "./log";

setLogSink(() => {});

// Prevent real API calls in tests. Unit tests must use mocks.
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GOOGLE_API_KEY;
delete process.env.AI_GATEWAY_API_KEY;

// Guard: block outbound requests to known LLM provider APIs.
// Tests that need HTTP should use startTestServer() for local endpoints.
const BLOCKED_HOSTS = ["api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com"];
const originalFetch = globalThis.fetch;
const guardedFetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (const host of BLOCKED_HOSTS) {
      if (url.includes(host)) {
        throw new Error(`Test attempted real API call to ${host}. Use mocks instead.`);
      }
    }
    return originalFetch(input, init);
  },
  { preconnect: originalFetch.preconnect },
);
globalThis.fetch = guardedFetch;
