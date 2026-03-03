import { appConfig } from "./app-config";
import type { Client, ClientOptions } from "./client-contract";
import { resolveTransportMode } from "./client-contract";
import { createHttpTransport, HttpClient } from "./client-http";
import { RpcClient } from "./client-rpc";
import { createUserError } from "./error-messages";

export type { Client, ClientOptions, ClientTransport, StreamEvent } from "./client-contract";
export { parseStreamEvent, rpcUrlFromApiUrl, streamEventSchema } from "./client-contract";

export function createClient(options?: ClientOptions): Client {
  const apiUrl = options?.apiUrl ?? appConfig.server.apiUrl;
  const apiKey = options?.apiKey ?? appConfig.server.apiKey;
  const replyTimeoutMs = options?.replyTimeoutMs;
  const mode = resolveTransportMode(apiUrl, options?.transportMode ?? appConfig.server.transportMode);

  if (mode === "rpc") {
    if (!apiUrl) throw createUserError("E_CLIENT_API_URL_NOT_CONFIGURED");
    return new RpcClient(apiUrl, apiKey, replyTimeoutMs);
  }

  const transport = options?.transport ?? (apiUrl ? createHttpTransport(apiUrl) : null);
  if (!transport) throw createUserError("E_CLIENT_API_URL_NOT_CONFIGURED");
  return new HttpClient(transport, apiKey, replyTimeoutMs);
}
