import { isLoopbackHost } from "./network-host";

const DEFAULT_LOCAL_API_HOST = "127.0.0.1";
const DEFAULT_LOCAL_API_PORT = 6767;

function isLocalLoopbackApiUrl(apiUrl: string): boolean {
  try {
    const parsed = new URL(apiUrl);
    if (parsed.protocol !== "http:") return false;
    return isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function resolveChatApiUrl(configuredApiUrl: string | undefined, port = DEFAULT_LOCAL_API_PORT): string {
  const trimmed = configuredApiUrl?.trim();
  if (trimmed) return trimmed;
  return `http://${DEFAULT_LOCAL_API_HOST}:${port}`;
}

export function shouldAutoStartLocalServerForChat(configuredApiUrl: string | undefined): boolean {
  const trimmed = configuredApiUrl?.trim();
  if (!trimmed) return true;
  return isLocalLoopbackApiUrl(trimmed);
}

export function resolveLocalDaemonApiUrl(configuredApiUrl: string | undefined, port = DEFAULT_LOCAL_API_PORT): string {
  if (shouldAutoStartLocalServerForChat(configuredApiUrl)) return resolveChatApiUrl(configuredApiUrl, port);
  return resolveChatApiUrl(undefined, port);
}

export function formatLocalServerReadyMessage(result: { apiUrl: string; started: boolean; managed: boolean }): string {
  if (result.started) return `Started local server at ${result.apiUrl}`;
  if (result.managed) return `Using local server at ${result.apiUrl}`;
  return `Using external local server at ${result.apiUrl} (started outside this client).`;
}
