#!/usr/bin/env bun
import { appConfig } from "./app-config";

type OmStatusResponse = {
  ok: boolean;
  resourceId: string;
  exists: boolean;
  generationCount: number;
  lastObservedAt: string | null;
  lastReflectionAt: string | null;
  observations: string[];
  historyCount: number;
};

function usage(): void {
  console.log("Usage:");
  console.log("  bun run om:status [resourceId]");
  console.log("  bun run om:wipe [resourceId]");
}

function baseUrl(): string {
  const configured = appConfig.server.apiUrl?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  return `http://localhost:${appConfig.server.port}`;
}

function buildHeaders(): Record<string, string> {
  if (!appConfig.server.apiKey) {
    return {};
  }
  return { authorization: `Bearer ${appConfig.server.apiKey}` };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${text || "no body"}`);
  }
  return JSON.parse(text) as T;
}

async function status(resourceIdArg?: string): Promise<void> {
  const params = new URLSearchParams();
  if (resourceIdArg?.trim()) {
    params.set("resourceId", resourceIdArg.trim());
  }
  const endpoint = `${baseUrl()}/v1/admin/om/status${params.size > 0 ? `?${params}` : ""}`;
  const payload = await fetchJson<OmStatusResponse>(endpoint, { headers: buildHeaders() });
  console.log(`OM status for ${payload.resourceId}`);
  console.log(`exists=${payload.exists} generations=${payload.generationCount} history=${payload.historyCount}`);
  console.log(`last_observed=${payload.lastObservedAt ?? "n/a"}`);
  console.log(`last_reflection=${payload.lastReflectionAt ?? "n/a"}`);
  if (payload.observations.length === 0) {
    console.log("observations=none");
    return;
  }
  console.log("observations:");
  for (const row of payload.observations) {
    console.log(`- ${row}`);
  }
}

async function wipe(resourceIdArg?: string): Promise<void> {
  const params = new URLSearchParams();
  if (resourceIdArg?.trim()) {
    params.set("resourceId", resourceIdArg.trim());
  }
  const endpoint = `${baseUrl()}/v1/admin/om/wipe${params.size > 0 ? `?${params}` : ""}`;
  const payload = await fetchJson<{ ok: boolean; resourceId: string; wiped: boolean }>(endpoint, {
    method: "POST",
    headers: buildHeaders(),
  });
  console.log(`Wiped OM for ${payload.resourceId}: ${payload.wiped ? "ok" : "no-op"}`);
}

async function main(): Promise<void> {
  const [cmd, resourceIdArg] = process.argv.slice(2);
  if (cmd === "status") {
    await status(resourceIdArg);
    return;
  }
  if (cmd === "wipe") {
    await wipe(resourceIdArg);
    return;
  }
  usage();
  process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("connectionrefused") || lower.includes("unable to connect")) {
    console.error(`Cannot reach backend at ${baseUrl()}. Start it with: bun run serve:env`);
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}
