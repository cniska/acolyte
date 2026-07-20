import { describe, expect, test } from "bun:test";
import { collectProviderStatus } from "./provider-status";

const NONE = {
  anthropicApiKey: false,
  googleApiKey: false,
  openaiSubscription: false,
  openaiApiKey: false,
  vercelApiKey: false,
};

describe("collectProviderStatus", () => {
  test("omits providers with no auth", () => {
    expect(collectProviderStatus(NONE)).toEqual({ providers: [], providerAuth: [] });
  });

  test("includes vercel when its key is present", () => {
    const status = collectProviderStatus({ ...NONE, vercelApiKey: true });
    expect(status.providers).toContain("vercel");
    expect(status.providerAuth).toContain("vercel (api key)");
  });

  test("lists configured providers alphabetically", () => {
    const status = collectProviderStatus({
      anthropicApiKey: true,
      googleApiKey: true,
      openaiSubscription: false,
      openaiApiKey: true,
      vercelApiKey: true,
    });
    expect(status.providers).toEqual(["anthropic", "google", "openai", "vercel"]);
  });

  test("reports openai via subscription alone when no key is set", () => {
    const status = collectProviderStatus({ ...NONE, openaiSubscription: true });
    expect(status.providerAuth).toEqual(["openai (subscription)"]);
  });

  test("reports both openai methods when subscription and key coexist", () => {
    const status = collectProviderStatus({ ...NONE, openaiSubscription: true, openaiApiKey: true });
    expect(status.providerAuth).toEqual(["openai (subscription + api key)"]);
  });
});
