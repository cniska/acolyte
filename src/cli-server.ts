import { t } from "./i18n";
import { apiUrlForPort } from "./server-daemon";

const LOCAL_SERVER_SHUTDOWN_TIMEOUT_MS = 4_000;
const LOCAL_SERVER_REQUEST_TIMEOUT_MS = 1_200;

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
  port: number;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<boolean> {
  const { port, apiKey, timeoutMs = LOCAL_SERVER_SHUTDOWN_TIMEOUT_MS } = input;
  const baseUrl = apiUrlForPort(port);
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
