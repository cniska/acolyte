import { appConfig } from "./app-config";
import type { Client, ClientOptions } from "./client-contract";
import { resolveTransportMode } from "./client-contract";
import { createHttpTransport, HttpClient } from "./client-http";
import { RpcClient } from "./client-rpc";

export type { Client, ClientOptions, ClientTransport, StreamEvent } from "./client-contract";
export { parseStreamEvent, rpcUrlFromApiUrl, streamEventSchema } from "./client-contract";

export function createClient(options?: ClientOptions): Client {
  const explicitApiUrl = options?.apiUrl?.trim();
  const apiUrl = explicitApiUrl || appConfig.server.apiUrl || `http://127.0.0.1:${appConfig.server.port}`;
  const apiKey = options?.apiKey ?? appConfig.server.apiKey;
  const replyTimeoutMs = options?.replyTimeoutMs;
  const mode = resolveTransportMode(apiUrl, options?.transportMode ?? appConfig.server.transportMode);

  if (mode === "rpc") return new RpcClient(apiUrl, apiKey, replyTimeoutMs);
  const transport = options?.transport ?? createHttpTransport(apiUrl);
  return new HttpClient(transport, apiKey, replyTimeoutMs);
}
