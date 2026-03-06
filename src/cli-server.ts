import { t } from "./i18n";
import { isLoopbackHost } from "./network-host";

const DEFAULT_LOCAL_API_HOST = "127.0.0.1";
const DEFAULT_LOCAL_API_PORT = 6767;
const LOCAL_SERVER_SHUTDOWN_TIMEOUT_MS = 4_000;
const LOCAL_SERVER_REQUEST_TIMEOUT_MS = 1_200;

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
  if (result.started) return t("cli.server.started", { apiUrl: result.apiUrl });
  if (result.managed) return t("cli.server.using_local", { apiUrl: result.apiUrl });
  return t("cli.server.using_external", { apiUrl: result.apiUrl });
}

async function canReachStatus(apiUrl: string, apiKey?: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_SERVER_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/status`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function requestLocalServerShutdown(input: {
  apiUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<boolean> {
  const { apiUrl, apiKey, timeoutMs = LOCAL_SERVER_SHUTDOWN_TIMEOUT_MS } = input;
  if (!isLocalLoopbackApiUrl(apiUrl)) return false;
  const baseUrl = apiUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_SERVER_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/v1/admin/shutdown`, {
      method: "POST",
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await canReachStatus(baseUrl, apiKey))) return true;
    await Bun.sleep(120);
  }
  return false;
}
