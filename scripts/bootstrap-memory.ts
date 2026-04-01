#!/usr/bin/env bun
/**
 * Seeds project memory with curated facts about the acolyte codebase.
 * Idempotent: purges existing project memories before re-adding.
 *
 * Usage:
 *   bun scripts/bootstrap-memory.ts
 */
import { join } from "node:path";
import { addMemory, listMemories, removeMemory } from "../src/memory-ops";

const cwd = join(import.meta.dir, "..");

const MEMORIES = [
  // Architecture
  "System flow: CLI → client → server → lifecycle → model + tools. One active task per session with ordered queued tasks.",
  "First-class concepts: sessions, tasks, lifecycle phases, effects, tools, skills, memory sources, and typed RPC protocol. Each has its own module with typed contracts.",
  "Dependency injection: no container or decorators. Dependencies are passed as typed parameters with defaults from appConfig. Factory functions take (deps, input) — deps for config, input for per-request runtime data.",
  "Composition roots that read appConfig and pass values down: cli-command-registry.ts, server-chat-runtime.ts, cli-chat.ts. Tests inject directly through params.",

  // Lifecycle
  "Lifecycle phases: resolve → prepare → generate → finalize. Single-pass execution — no regeneration loop, no feedback injection, no retry logic.",
  "Effects (format, lint) are lifecycle-owned side effects applied per-tool-result via onToolResult callback on the session. Lint errors are appended to tool results for the model to see.",
  "Step budget: checkStepBudget() is inlined into tool execution. Blocks calls with budgetExhausted error when exhausted. This is the only pre-tool policy check.",
  "Lifecycle signal contract: model emits @signal done, @signal no_op, or @signal blocked. Host validates against runtime state. A blocked signal maps to awaiting-input response state.",

  // Tooling
  "Tool execution layers: lifecycle → budget → cache → toolkit → registry. All tool calls run through runTool() which ensures budget enforcement, error shaping, and call recording.",
  "Toolkits: file-toolkit, code-toolkit, git-toolkit, shell-toolkit, web-toolkit, checklist-toolkit, memory-toolkit. Each is a factory function returning a map of ToolDefinition objects.",
  "Tool categories: read, search, write, execute, network, meta. Write tools invalidate cache. Meta tools (checklist, memory) are agent-internal.",
  "Tool result cache: L1 in-memory LRU (256 entries per task), L2 SQLite persists across tasks within a session. Write tools evict overlapping paths; shell-run clears entire cache.",
  "Query vs mutation tools have different design constraints. Query tools get simple vocabularies; mutation tools may expose scoping constraints. Do not unify contracts just because they share implementation.",

  // Workspace
  "Workspace sandbox: tool filesystem access is scoped to workspace root. Fail-closed with realpath validation. Symlink escapes blocked. Violations return E_SANDBOX_VIOLATION.",
  "Workspace profile detection: ecosystem, package manager, format/lint/test commands inferred from project files. Used by lifecycle effects for format/lint runs on edited files.",

  // Memory
  "Memory pipeline: ingest → normalize → select → inject → commit. Sources: stored (markdown files), distill_session, distill_project, distill_user.",
  "Stored memories: user scope in ~/.acolyte/memory/user/, project scope in .acolyte/memory/project/. Markdown files with frontmatter (id, createdAt, scope).",
  "Distill records: SQLite in ~/.acolyte/memory.db. Two tiers: observations (round-level facts) and reflections (consolidated state). Promotion via [project]/[user] tags.",
  "Memory selection: semantic ranking via cosine similarity when query/embeddings available. Continuation entries always rank first. Deduplication by normalized content.",

  // Testing
  "Test types: unit (*.test.ts), integration (*.int.test.ts), visual (*.tui.test.tsx), performance. Unit tests must avoid filesystem writes, subprocesses, and network calls.",
  "Verification: bun run verify runs lint + typecheck + test + audit. Always run before pushing.",
  "Behavior harness: scripts/run-behavior.ts for small real-model tuning across bounded temporary workspaces. Keep scenarios explicit, small, manually inspectable.",
];

// Purge existing project memories for idempotency
const existing = await listMemories({ scope: "project", workspace: cwd });
if (existing.length > 0) {
  for (const entry of existing) {
    await removeMemory(entry.id, { workspace: cwd });
  }
  console.log(`Purged ${existing.length} existing project memories.`);
}

for (const fact of MEMORIES) {
  await addMemory(fact, { scope: "project", workspace: cwd });
}

const entries = await listMemories({ scope: "project", workspace: cwd });
console.log(`Done. ${entries.length} project memories seeded.`);
