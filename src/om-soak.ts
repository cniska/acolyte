#!/usr/bin/env bun
import { z } from "zod";
import type { ChatRequest, ChatResponse } from "./api";
import { appConfig } from "./app-config";
import type { Message } from "./types";

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

type SoakOptions = {
  turns: number;
  delayMs: number;
  checkpointEvery: number;
  sessionId: string;
  wipeBefore: boolean;
};

const DEFAULT_OPTIONS = {
  turns: 40,
  delayMs: 150,
  checkpointEvery: 10,
} as const;

const soakOptionsSchema = z.object({
  turns: z.coerce.number().int().positive(),
  delayMs: z.coerce.number().int().nonnegative(),
  checkpointEvery: z.coerce.number().int().positive(),
  sessionId: z.string().min(1),
  wipeBefore: z.boolean(),
});

function baseUrl(): string {
  const configured = appConfig.server.apiUrl?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  return `http://localhost:${appConfig.server.port}`;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (appConfig.server.apiKey) {
    headers.authorization = `Bearer ${appConfig.server.apiKey}`;
  }
  return headers;
}

function parseOptions(argv: string[]): SoakOptions {
  const raw: {
    turns: number | string;
    delayMs: number | string;
    checkpointEvery: number | string;
    sessionId: string;
    wipeBefore: boolean;
  } = {
    turns: DEFAULT_OPTIONS.turns,
    delayMs: DEFAULT_OPTIONS.delayMs,
    checkpointEvery: DEFAULT_OPTIONS.checkpointEvery,
    sessionId: `om_soak_${Date.now().toString(36)}`,
    wipeBefore: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--turns") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Invalid --turns value.");
      }
      raw.turns = value;
      i += 1;
      continue;
    }
    if (token === "--delay-ms" || token === "--delayMs") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Invalid --delay-ms value.");
      }
      raw.delayMs = value;
      i += 1;
      continue;
    }
    if (token === "--checkpoint-every" || token === "--checkpointEvery") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Invalid --checkpoint-every value.");
      }
      raw.checkpointEvery = value;
      i += 1;
      continue;
    }
    if (token === "--session-id" || token === "--sessionId") {
      const value = (argv[i + 1] ?? "").trim();
      if (!value) {
        throw new Error("Invalid --session-id value.");
      }
      raw.sessionId = value;
      i += 1;
      continue;
    }
    if (token === "--wipe-before" || token === "--wipeBefore") {
      raw.wipeBefore = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  const parsed = soakOptionsSchema.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === "turns")) {
      throw new Error("Invalid --turns value.");
    }
    if (parsed.error.issues.some((issue) => issue.path[0] === "delayMs")) {
      throw new Error("Invalid --delay-ms value.");
    }
    if (parsed.error.issues.some((issue) => issue.path[0] === "checkpointEvery")) {
      throw new Error("Invalid --checkpoint-every value.");
    }
    if (parsed.error.issues.some((issue) => issue.path[0] === "sessionId")) {
      throw new Error("Invalid --session-id value.");
    }
    throw new Error("Invalid options.");
  }

  return parsed.data;
}

function nowIso(): string {
  return new Date().toISOString();
}

function printUsage(): void {
  console.log(
    "Usage: bun run om:soak -- [--turns N] [--delay-ms N] [--checkpoint-every N] [--session-id ID] [--wipe-before]",
  );
  console.log("Aliases: --delayMs --checkpointEvery --sessionId --wipeBefore");
}

function makeMessage(role: Message["role"], content: string): Message {
  return {
    id: `msg_${crypto.randomUUID()}`,
    role,
    content,
    timestamp: nowIso(),
  };
}

function promptForTurn(turn: number): string {
  const prompts = [
    "Use concise output and list only key actions.",
    "When editing files, show a compact diff-first summary.",
    "Keep confirmations short and user-focused.",
    "Prefer verify-first coding loop with explicit pass/fail result.",
    "Avoid repeating the same explanation if no new information exists.",
  ];
  return `Turn ${turn}: ${prompts[(turn - 1) % prompts.length] ?? prompts[0]}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}: ${text || "no body"}`);
  }
  return JSON.parse(text) as T;
}

async function fetchOmStatus(url: string): Promise<OmStatusResponse> {
  return fetchJson<OmStatusResponse>(`${url}/v1/admin/om/status`, {
    headers: buildHeaders(),
  });
}

async function wipeOm(url: string): Promise<void> {
  await fetchJson<{ ok: boolean; wiped: boolean }>(`${url}/v1/admin/om/wipe`, {
    method: "POST",
    headers: buildHeaders(),
  });
}

async function runChatTurn(
  url: string,
  message: string,
  model: string,
  sessionId: string,
  history: Message[],
): Promise<string> {
  const payload: ChatRequest = {
    message,
    model,
    sessionId,
    history,
  };
  const response = await fetchJson<ChatResponse>(`${url}/v1/chat`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  return response.output;
}

async function checkpoint(url: string, turn: number): Promise<void> {
  const status = await fetchOmStatus(url);
  console.log(
    `checkpoint turn=${turn} exists=${status.exists} gen=${status.generationCount} history=${status.historyCount} observations=${status.observations.length}`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }
  const options = parseOptions(args);
  const url = baseUrl();
  const model = appConfig.models.lead;
  const history: Message[] = [];

  console.log(`OM soak starting url=${url} turns=${options.turns} session=${options.sessionId}`);
  if (options.wipeBefore) {
    await wipeOm(url);
    console.log("wiped OM before soak");
  }

  const before = await fetchOmStatus(url);
  console.log(
    `before exists=${before.exists} gen=${before.generationCount} history=${before.historyCount} observations=${before.observations.length}`,
  );

  for (let turn = 1; turn <= options.turns; turn += 1) {
    const prompt = promptForTurn(turn);
    const output = await runChatTurn(url, prompt, model, options.sessionId, history);
    history.push(makeMessage("user", prompt));
    history.push(makeMessage("assistant", output));

    if (turn % options.checkpointEvery === 0 || turn === options.turns) {
      await checkpoint(url, turn);
    }
    if (options.delayMs > 0) {
      await Bun.sleep(options.delayMs);
    }
  }

  const after = await fetchOmStatus(url);
  console.log(`after exists=${after.exists} gen=${after.generationCount} history=${after.historyCount}`);
  if (after.observations.length === 0) {
    console.log("observations: none");
  } else {
    console.log("observations:");
    for (const row of after.observations) {
      console.log(`- ${row}`);
    }
  }
  console.log("OM soak complete.");
}

if (import.meta.main) {
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
}

export { parseOptions };
