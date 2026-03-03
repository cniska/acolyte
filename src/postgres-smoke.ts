#!/usr/bin/env bun
import { appConfig } from "./app-config";

type StatusResponse = {
  ok?: boolean;
  memory?: string;
};

type OmStatusResponse = {
  ok: boolean;
  resourceId: string;
  exists: boolean;
};

function baseUrl(): string {
  const configured = appConfig.server.apiUrl?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return `http://localhost:${appConfig.server.port}`;
}

function buildHeaders(): Record<string, string> {
  if (!appConfig.server.apiKey) return {};
  return { authorization: `Bearer ${appConfig.server.apiKey}` };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) throw new Error(`Request failed (${response.status}) for ${url}: ${body || "no body"}`);
  return JSON.parse(body) as T;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim())
    throw new Error("DATABASE_URL is not set. Add it to .env before running db:smoke.");

  const url = baseUrl();
  console.log(`Running Postgres smoke test against ${url}`);

  const health = await fetchJson<StatusResponse>(`${url}/v1/status`, { headers: buildHeaders() });
  if (health.ok !== true) throw new Error("Status check did not return ok=true.");
  if (!health.memory?.startsWith("postgres"))
    throw new Error(`Expected memory to start with postgres, got ${health.memory ?? "unknown"}.`);
  console.log("✓ status reports postgres storage");

  const resourceId = `smoke_${Date.now().toString(36)}`;
  const params = new URLSearchParams({ resourceId });
  const statusBefore = await fetchJson<OmStatusResponse>(`${url}/v1/admin/om/status?${params}`, {
    headers: buildHeaders(),
  });
  console.log(`✓ OM status reachable (resource=${statusBefore.resourceId}, exists=${statusBefore.exists})`);

  await fetchJson<{ ok: boolean; wiped: boolean }>(`${url}/v1/admin/om/wipe?${params}`, {
    method: "POST",
    headers: buildHeaders(),
  });
  console.log("✓ OM wipe endpoint succeeded");

  const statusAfter = await fetchJson<OmStatusResponse>(`${url}/v1/admin/om/status?${params}`, {
    headers: buildHeaders(),
  });
  if (statusAfter.exists) throw new Error("Expected wiped resource to have exists=false after wipe.");
  console.log("✓ OM status confirms wiped state");
  console.log("Postgres smoke test passed.");
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("connectionrefused") || lower.includes("unable to connect")) {
    console.error(`Cannot reach server at ${baseUrl()}. Start it with: bun run serve`);
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}
