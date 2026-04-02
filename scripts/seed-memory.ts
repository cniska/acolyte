#!/usr/bin/env bun
/**
 * Seeds project memory from a JSON array of facts.
 * Idempotent: purges existing project memories before re-adding.
 *
 * Usage:
 *   bun scripts/seed-memory.ts <facts.json>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addMemory, listMemories, removeMemory } from "../src/memory-ops";

const cwd = join(import.meta.dir, "..");
const arg = process.argv[2];

if (!arg) {
  console.error("Usage: bun scripts/seed-memory.ts <facts.json>");
  process.exit(1);
}

const raw = readFileSync(arg, "utf8");
const facts: string[] = JSON.parse(raw);
if (!Array.isArray(facts) || facts.some((f) => typeof f !== "string")) {
  console.error("Expected a JSON array of strings.");
  process.exit(1);
}

const existing = await listMemories({ scope: "project", workspace: cwd });
for (const entry of existing) {
  await removeMemory(entry.id, { workspace: cwd });
}
if (existing.length > 0) console.log(`Purged ${existing.length} existing project memories.`);

for (const fact of facts) {
  await addMemory(fact, { scope: "project", workspace: cwd });
}

const entries = await listMemories({ scope: "project", workspace: cwd });
console.log(`Done. ${entries.length} project memories seeded.`);
