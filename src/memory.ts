import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface MemoryEntry {
  id: string;
  content: string;
  createdAt: string;
}

interface MemoryStore {
  entries: MemoryEntry[];
}

const DATA_DIR = join(homedir(), ".acolyte");
const MEMORY_PATH = join(DATA_DIR, "memory.json");

const EMPTY_STORE: MemoryStore = { entries: [] };

async function readMemoryStore(): Promise<MemoryStore> {
  if (!existsSync(MEMORY_PATH)) {
    return EMPTY_STORE;
  }

  try {
    const raw = await readFile(MEMORY_PATH, "utf8");
    const parsed = JSON.parse(raw) as MemoryStore;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return EMPTY_STORE;
  }
}

async function writeMemoryStore(store: MemoryStore): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(MEMORY_PATH, JSON.stringify(store, null, 2), "utf8");
}

export async function listMemories(): Promise<MemoryEntry[]> {
  const store = await readMemoryStore();
  return store.entries;
}

export async function addMemory(content: string): Promise<MemoryEntry> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Memory content cannot be empty");
  }

  const store = await readMemoryStore();
  const entry: MemoryEntry = {
    id: `mem_${crypto.randomUUID()}`,
    content: trimmed,
    createdAt: new Date().toISOString(),
  };
  store.entries.unshift(entry);
  await writeMemoryStore(store);
  return entry;
}

