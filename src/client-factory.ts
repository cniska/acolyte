import { invariant } from "./assert";
import type { Client, ClientOptions } from "./client-contract";
import { RpcClient } from "./client-rpc";

export function createClient(options: ClientOptions): Client {
  const apiUrl = options.apiUrl;
  invariant(apiUrl, "apiUrl is required");
  return new RpcClient(apiUrl, options.apiKey, options.replyTimeoutMs);
}
