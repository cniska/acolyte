#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createBackend } from "./backend";
import { readConfig, setConfigValue, unsetConfigValue } from "./config";
import { addMemory, listMemories } from "./memory";
import { createSession, readStore, writeStore } from "./storage";
import type { Message, Session, SessionStore } from "./types";
import {
  banner,
  printAssistantHeader,
  printError,
  printInfo,
  printUser,
  printWarning,
  streamText,
} from "./ui";

const FALLBACK_MODEL = "gpt-5-mini";

function usage(): void {
  printInfo("Usage: acolyte <chat|run|history|status|memory|config>");
  printInfo("  chat            Start interactive session");
  printInfo("  run <prompt>    Send one prompt and exit");
  printInfo("  history         Show recent sessions");
  printInfo("  status          Show backend connection status");
  printInfo("  memory          Manage personal memory notes");
  printInfo("  config          Manage local CLI defaults");
}

function nowIso(): string {
  return new Date().toISOString();
}

function newMessage(role: Message["role"], content: string): Message {
  return {
    id: `msg_${crypto.randomUUID()}`,
    role,
    content,
    timestamp: nowIso(),
  };
}

function getOrCreateActiveSession(store: SessionStore, model: string): Session {
  const active = store.sessions.find((s) => s.id === store.activeSessionId);
  if (active) {
    return active;
  }

  const created = createSession(model);
  store.sessions.unshift(created);
  store.activeSessionId = created.id;
  return created;
}

function printHelp(): void {
  printInfo("Slash commands:");
  printInfo("  /help           Show this help");
  printInfo("  /new            Start a new session");
  printInfo("  /history        Show messages in this session");
  printInfo("  /sessions       List saved sessions");
  printInfo("  /status         Show backend connection status");
  printInfo("  /remember <x>   Add a personal memory note");
  printInfo("  /memories       Show personal memory notes");
  printInfo("  /model <name>   Change active model");
  printInfo("  /exit           Exit the CLI");
}

function listSessions(store: SessionStore): void {
  if (store.sessions.length === 0) {
    printInfo("No saved sessions.");
    return;
  }

  for (const session of store.sessions.slice(0, 20)) {
    const active = session.id === store.activeSessionId ? "*" : " ";
    printInfo(`${active} ${session.id.slice(0, 12)}  ${session.model}  ${session.updatedAt}  ${session.title}`);
  }
}

function printSessionHistory(session: Session): void {
  if (session.messages.length === 0) {
    printInfo("Session is empty.");
    return;
  }

  for (const msg of session.messages) {
    const who = msg.role === "user" ? "you" : msg.role === "assistant" ? "Acolyte" : "system";
    printInfo(`[${msg.timestamp}] ${who}: ${msg.content}`);
  }
}

function printMemoryRows(rows: Awaited<ReturnType<typeof listMemories>>): void {
  if (rows.length === 0) {
    printInfo("No memories saved.");
    return;
  }

  for (const row of rows.slice(0, 50)) {
    printInfo(`${row.id.slice(0, 12)}  ${row.createdAt}  ${row.content}`);
  }
}

function setSessionTitle(session: Session, inputText: string): void {
  if (session.title !== "New Session") {
    return;
  }

  const title = inputText.trim().replace(/\s+/g, " ").slice(0, 60);
  if (title.length > 0) {
    session.title = title;
  }
}

async function buildHistoryWithMemoryContext(history: Message[]): Promise<Message[]> {
  const memories = await listMemories();
  const top = memories.slice(0, 8);
  if (top.length === 0) {
    return history;
  }

  const memoryLines = top.map((m) => `- ${m.content}`);
  const context: Message = {
    id: `msg_${crypto.randomUUID()}`,
    role: "system",
    content: `User memory context:\n${memoryLines.join("\n")}`,
    timestamp: nowIso(),
  };

  return [context, ...history];
}

async function handlePrompt(prompt: string, session: Session): Promise<void> {
  const backend = createBackend();
  const userMsg = newMessage("user", prompt);
  session.messages.push(userMsg);
  setSessionTitle(session, prompt);

  printUser(prompt);
  printAssistantHeader();

  try {
    const historyWithContext = await buildHistoryWithMemoryContext(session.messages);
    const reply = await backend.reply({
      message: prompt,
      history: historyWithContext,
      model: session.model,
    });

    await streamText(reply.output);
    session.messages.push(newMessage("assistant", reply.output));
    session.model = reply.model;
    session.updatedAt = nowIso();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    printError(message);
    session.updatedAt = nowIso();
  }
}

async function chatMode(): Promise<void> {
  const config = await readConfig();
  const store = await readStore();
  const defaultModel = process.env.ACOLYTE_MODEL ?? config.model ?? FALLBACK_MODEL;
  let session = getOrCreateActiveSession(store, defaultModel);

  banner(session.model, session.id);

  const rl = createInterface({ input, output });

  const persist = async (): Promise<void> => {
    await writeStore(store);
  };
  const backend = createBackend({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
  });

  process.on("SIGINT", async () => {
    await persist();
    rl.close();
    process.exit(0);
  });

  while (true) {
    let line = "";
    try {
      line = (await rl.question("> ")).trim();
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "ERR_USE_AFTER_CLOSE") {
        await persist();
        return;
      }

      throw error;
    }
    if (!line) {
      continue;
    }

    if (line.startsWith("/")) {
      const [command, ...args] = line.split(/\s+/);
      if (command === "/help") {
        printHelp();
      } else if (command === "/new") {
        const created = createSession(session.model);
        store.sessions.unshift(created);
        store.activeSessionId = created.id;
        session = created;
        banner(session.model, session.id);
      } else if (command === "/history") {
        printSessionHistory(session);
      } else if (command === "/sessions") {
        listSessions(store);
      } else if (command === "/status") {
        try {
          const status = await backend.status();
          printInfo(status);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          printError(message);
        }
      } else if (command === "/remember") {
        const content = args.join(" ").trim();
        if (!content) {
          printWarning("Usage: /remember <memory text>");
        } else {
          const entry = await addMemory(content);
          printInfo(`Saved memory ${entry.id.slice(0, 12)}.`);
        }
      } else if (command === "/memories") {
        const rows = await listMemories();
        printMemoryRows(rows);
      } else if (command === "/model") {
        if (args.length === 0) {
          printWarning("Usage: /model <model-name>");
        } else {
          session.model = args[0];
          session.updatedAt = nowIso();
          printInfo(`Active model set to ${session.model}`);
        }
      } else if (command === "/exit") {
        await persist();
        rl.close();
        return;
      } else {
        printWarning(`Unknown command: ${command}`);
      }

      await persist();
      continue;
    }

    await handlePrompt(line, session);
    await persist();
  }
}

async function runMode(args: string[]): Promise<void> {
  const prompt = args.join(" ").trim();
  if (!prompt) {
    printError("Usage: acolyte run <prompt>");
    process.exitCode = 1;
    return;
  }

  const config = await readConfig();
  const store = await readStore();
  const defaultModel = process.env.ACOLYTE_MODEL ?? config.model ?? FALLBACK_MODEL;
  const session = getOrCreateActiveSession(store, defaultModel);
  await handlePrompt(prompt, session);
  await writeStore(store);
}

async function historyMode(): Promise<void> {
  const store = await readStore();
  listSessions(store);
}

async function statusMode(): Promise<void> {
  const config = await readConfig();
  const backend = createBackend({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
  });
  try {
    const status = await backend.status();
    printInfo(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    printError(message);
    process.exitCode = 1;
  }
}

async function memoryMode(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  if (subcommand === "list" || !subcommand) {
    const rows = await listMemories();
    printMemoryRows(rows);
    return;
  }

  if (subcommand === "add") {
    const content = rest.join(" ").trim();
    if (!content) {
      printError("Usage: acolyte memory add <memory text>");
      process.exitCode = 1;
      return;
    }
    const entry = await addMemory(content);
    printInfo(`Saved memory ${entry.id.slice(0, 12)}.`);
    return;
  }

  printError("Usage: acolyte memory [list|add <text>]");
  process.exitCode = 1;
}

async function configMode(args: string[]): Promise<void> {
  const [subcommand, key, ...rest] = args;
  const valid = new Set(["model", "apiUrl", "apiKey"]);

  if (!subcommand || subcommand === "list") {
    const config = await readConfig();
    printInfo(`model=${config.model ?? ""}`);
    printInfo(`apiUrl=${config.apiUrl ?? ""}`);
    printInfo(`apiKey=${config.apiKey ? "***set***" : ""}`);
    return;
  }

  if (subcommand === "set") {
    if (!key || !valid.has(key)) {
      printError("Usage: acolyte config set <model|apiUrl|apiKey> <value>");
      process.exitCode = 1;
      return;
    }

    const value = rest.join(" ").trim();
    if (!value) {
      printError("Config value cannot be empty");
      process.exitCode = 1;
      return;
    }

    await setConfigValue(key as "model" | "apiUrl" | "apiKey", value);
    printInfo(`Saved config ${key}.`);
    return;
  }

  if (subcommand === "unset") {
    if (!key || !valid.has(key)) {
      printError("Usage: acolyte config unset <model|apiUrl|apiKey>");
      process.exitCode = 1;
      return;
    }

    await unsetConfigValue(key as "model" | "apiUrl" | "apiKey");
    printInfo(`Removed config ${key}.`);
    return;
  }

  printError("Usage: acolyte config [list|set|unset] ...");
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (command === "chat") {
    await chatMode();
    return;
  }

  if (command === "run") {
    await runMode(args);
    return;
  }

  if (command === "history") {
    await historyMode();
    return;
  }

  if (command === "status") {
    await statusMode();
    return;
  }

  if (command === "memory") {
    await memoryMode(args);
    return;
  }

  if (command === "config") {
    await configMode(args);
    return;
  }

  usage();
  process.exitCode = 1;
}

await main();
