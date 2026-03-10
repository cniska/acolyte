import { appConfig } from "./app-config";
import { invariant } from "./assert";
import type { Client, ClientOptions } from "./client-contract";
import { resolveTransportMode } from "./client-contract";
import { RpcClient } from "./client-rpc";

export function createClient(options: ClientOptions): Client {
  const apiUrl = options.apiUrl;
  invariant(apiUrl, "apiUrl is required");
  const apiKey = options.apiKey ?? appConfig.server.apiKey;
  const replyTimeoutMs = options.replyTimeoutMs;
  const mode = resolveTransportMode(apiUrl, options.transportMode ?? appConfig.server.transportMode);

  invariant(mode === "rpc", `Unsupported transport mode: ${mode}`);
  return new RpcClient(apiUrl, apiKey, replyTimeoutMs);
}
