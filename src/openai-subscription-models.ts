import { z } from "zod";
import { CodedError } from "./coded-error";
import { ERROR_KINDS, PROVIDER_ERROR_CODES } from "./error-contract";
import { withChatGPTAuthFetch } from "./openai-chatgpt-fetch";
import type { Env } from "./paths";
import { OPENAI_SUBSCRIPTION_BASE_URL } from "./provider-constants";
import type { FetchFn } from "./rate-limiter";

// The subscription /models endpoint gates discovery by client_version; too-high is harmless, too-low
// hides new models. Pinning the latest real Codex release (fetched, with this fallback) is what other
// clients do and avoids drift. Calls to /responses ignore client_version.
const CODEX_VERSION_FALLBACK = "0.144.6";
const CODEX_LATEST_RELEASE_URL = "https://api.github.com/repos/openai/codex/releases/latest";
const CLIENT_VERSION_TTL_MS = 6 * 60 * 60 * 1000;

// Entitlements change without the process restarting, and a set held forever would route a newly
// served model to the API key for the life of a daemon.
const SERVED_MODELS_TTL_MS = 6 * 60 * 60 * 1000;

let clientVersion: { value: string; fetchedAt: number } | undefined;
let discovery: { models: Promise<ReadonlySet<string>>; fetchedAt: number } | undefined;

export function resetSubscriptionModelsCache(): void {
  clientVersion = undefined;
  discovery = undefined;
}

/**
 * The models the subscription serves. Awaiting is the only way to read the set, so no caller can
 * route on an answer discovery has not given yet — the state that used to read as "not served".
 */
export function subscriptionModels(fetchFn: FetchFn, env?: Env): Promise<ReadonlySet<string>> {
  const now = Date.now();
  if (discovery && now - discovery.fetchedAt < SERVED_MODELS_TTL_MS) return discovery.models;
  const models = fetchSubscriptionModels(fetchFn, env).then(
    (slugs) => new Set(slugs) as ReadonlySet<string>,
    (cause) => {
      discovery = undefined;
      throw new CodedError(PROVIDER_ERROR_CODES.subscriptionDiscoveryFailed, "Could not read your OpenAI subscription", {
        kind: ERROR_KINDS.subscriptionDiscoveryFailed,
        cause,
      });
    },
  );
  discovery = { models, fetchedAt: now };
  return models;
}

async function codexClientVersion(fetchFn: FetchFn): Promise<string> {
  const now = Date.now();
  if (clientVersion && now - clientVersion.fetchedAt < CLIENT_VERSION_TTL_MS) return clientVersion.value;
  let value = CODEX_VERSION_FALLBACK;
  try {
    const res = await fetchFn(CODEX_LATEST_RELEASE_URL, { headers: { Accept: "application/vnd.github+json" } });
    if (res.ok) {
      const parsed = codexReleaseSchema.safeParse(await res.json());
      const tag = parsed.success ? parsed.data.tag_name?.replace(/^rust-v/, "") : undefined;
      if (tag && /^\d+\.\d+\.\d+$/.test(tag)) value = tag;
    }
  } catch {
    // Offline or rate-limited: the fallback still reveals the current served set.
  }
  clientVersion = { value, fetchedAt: now };
  return value;
}

const codexReleaseSchema = z.object({ tag_name: z.string().optional() });

const codexModelSchema = z.object({
  slug: z.string(),
  visibility: z.string().optional(),
  tool_mode: z.string().nullish(),
});
const codexModelsResponseSchema = z.object({ models: z.array(codexModelSchema).optional() });

// code_mode_only models (the gpt-5.6 family) reject Acolyte's standard function tools on this
// backend, so they are unusable over the subscription; excluding them also routes them to the API
// key, where the same models accept standard tools. `visibility === "list"` is the endpoint's own
// "selectable in a picker" signal.
export async function fetchSubscriptionModels(fetchFn: FetchFn, env?: Env): Promise<string[]> {
  const version = await codexClientVersion(fetchFn);
  const authed = withChatGPTAuthFetch(fetchFn, env);
  const res = await authed(`${OPENAI_SUBSCRIPTION_BASE_URL}/models?client_version=${version}`);
  if (!res.ok) throw new Error(`Codex models request failed: ${res.status}`);
  const parsed = codexModelsResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error("Codex models response failed validation");
  const models = parsed.data.models ?? [];
  return models.filter((m) => m.visibility === "list" && m.tool_mode !== "code_mode_only").map((m) => m.slug);
}


