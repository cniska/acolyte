import { appConfig } from "./app-config";
import { invariant } from "./assert";
import type { Client, ClientOptions } from "./client-contract";
import { RpcClient } from "./client-rpc";

export function createClient(options: ClientOptions): Client {
  const apiUrl = options.apiUrl;
  invariant(apiUrl, "apiUrl is required");
  const apiKey = options.apiKey ?? appConfig.server.apiKey;
  const replyTimeoutMs = options.replyTimeoutMs;
  return new RpcClient(apiUrl, apiKey, replyTimeoutMs);
}
