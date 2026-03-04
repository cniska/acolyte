import { appConfig } from "./app-config";
import { invariant } from "./assert";
import type { Client, ClientOptions } from "./client-contract";
import { resolveTransportMode } from "./client-contract";
import { RpcClient } from "./client-rpc";

export type { Client, ClientOptions, StreamEvent } from "./client-contract";
export { parseStreamEvent, rpcUrlFromApiUrl, streamEventSchema } from "./client-contract";

export function createClient(options?: ClientOptions): Client {
  const explicitApiUrl = options?.apiUrl?.trim();
  const apiUrl = explicitApiUrl || appConfig.server.apiUrl || `http://127.0.0.1:${appConfig.server.port}`;
  const apiKey = options?.apiKey ?? appConfig.server.apiKey;
  const replyTimeoutMs = options?.replyTimeoutMs;
  const mode = resolveTransportMode(apiUrl, options?.transportMode ?? appConfig.server.transportMode);

  invariant(mode === "rpc", `Unsupported transport mode: ${mode}`);
  return new RpcClient(apiUrl, apiKey, replyTimeoutMs);
}
