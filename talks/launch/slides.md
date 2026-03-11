---
theme: default
title: "Acolyte: a terminal-first AI coding agent"
info: Launch talk — March 2026
class: text-center
drawings:
  persist: false
transition: slide-left
---

# Acolyte

<p style="font-size: 1.5em; line-height: 1.6; opacity: 0.9;">
A terminal-first AI coding assistant:<br>
local-first, observable, and built for extension.
</p>

<style>
h1 {
  color: #A56EFF !important;
}
</style>

<!--
Welcome everyone. Acolyte is an open-source AI coding agent that runs in your terminal. I'll walk through what makes it different, then show a live demo.
-->

---

# Who?

Christoffer Niska

- Software architect — 15+ years across various industries
- AI-assisted development since early Cursor, now Claude Code and Codex daily
- Built Acolyte to get the best of both worlds: open source + AI coding agent

[github.com/cniska](https://github.com/cniska) · [crisu.me](https://crisu.me)

<!--
Quick intro. I've been doing software architecture for 15 years. Started using AI-assisted dev early — Cursor, then Claude Code and Codex. Great tools, but I wanted something open source with the same depth. That's why I built Acolyte.
-->

---

# Why open source?

Claude Code and Codex are great — if one provider is enough.

<v-clicks>

- **Provider choice** — OpenAI, Anthropic, Google, or any compatible endpoint
- **Self-hosted** — everything runs on your infrastructure
- **Customizable** — lifecycle, guards, evaluators, memory are all extensible contracts
- **Transparent** — every tool call and guard decision is in structured logs
- **No lock-in** — sessions, memory, and config are local files you own

</v-clicks>

<!--
Why not just use Claude Code or Codex? They're excellent. But they lock you into one provider, one way of doing things. You can't customize the agent behavior, you can't see what it's doing under the hood, and your data lives on their infrastructure. Acolyte gives you all of that.
-->

---

# Architecture

Headless daemon + typed RPC protocol

```
┌──────────┐   ┌──────────┐   ┌──────────┐
│   CLI    │   │  Editor  │   │  Custom  │
│  (Ink)   │   │  plugin  │   │  client  │
└────┬─────┘   └────┬─────┘   └────┬─────┘
     │              │              │
     └──────────────┼──────────────┘
                    │
              WebSocket RPC
                    │
            ┌───────┴───────┐
            │    Daemon     │
            │  (headless)   │
            └───────────────┘
```

The TUI is just another client — no special access.

<!--
The architecture is daemon-based. A headless server handles all the AI work. The CLI connects over WebSocket RPC — same protocol an editor plugin or custom client would use. The TUI has no special access. You can have multiple clients sharing the same session.
-->

---

# Lifecycle pipeline

Every request flows through five explicit phases, each in its own module.

```
┌───────────┐   ┌───────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐
│  resolve  │ → │  prepare  │ → │  generate  │ → │  evaluate  │ → │  finalize  │
└───────────┘   └───────────┘   └────────────┘   └────────────┘   └────────────┘
```

- **Resolve** — pick mode (work/verify) and model
- **Prepare** — wire tools, session context, and guards
- **Generate** — run the model with tool calls
- **Evaluate** — inspect output, decide accept or re-generate
- **Finalize** — persist results and emit the response

<!--
This is the core of Acolyte. Every request goes through five explicit phases.

- Resolve picks the mode — work mode for writing code, verify mode for running checks — and selects the model.
- Prepare wires up the tools the agent can use, loads session context, and attaches the guards.
- Generate is the actual model call — it streams tool calls and text.
- Evaluate is the key differentiator. After the model finishes, evaluators inspect the result. They can trigger re-generation with a different tool strategy — for example, if a multi-match edit failed, retry with a different approach. They can switch modes — after the agent writes code, it automatically transitions to verify mode to run tests. They can kick off verify cycles that run your project's checks and re-generate if something fails. All automatic, no manual intervention.
- Finalize persists results, commits memory, and emits the response to the client.

No other open-source agent separates these into independently testable modules.
-->

---

# Guards and caching

Two layers prevent the agent from wasting time and tokens.

```
┌──────────┐   ┌─────────┐   ┌───────────┐   ┌──────────┐
│  guards  │ → │  cache  │ → │  execute  │ → │  record  │
└──────────┘   └─────────┘   └───────────┘   └──────────┘
```

- **Guards** — block degenerate patterns: step budgets, churn loops, redundant discovery
- **Cache** — return identical read-only results instantly (LRU, 256 entries per task)
- **Execute** — run the tool against the workspace
- **Record** — track calls and invalidate cache entries on writes

Both guards and cache are pluggable — add your own without touching the pipeline.

<!--
Two layers work together to keep the agent efficient.

Guards are functions that run before every tool call. They look at the call history and decide: allow or block. File-churn tracks how many times the agent has read and edited the same file — cross the threshold, it blocks the call and tells the model to move on. Step-budget is a hard limit: N tool calls per cycle, then stop cleanly.

The result cache sits after guards. Read-only and search tools are cached per-task with LRU eviction. If the agent reads the same file twice with identical arguments, the second call returns instantly — no disk I/O, no wasted tokens. When the agent writes, the cache invalidates affected entries. Shell commands clear the whole cache since they could change anything.

Guards correct degenerate behavior by blocking it. The cache silently eliminates redundant work. Both are pluggable — add your own guard or swap the cache strategy without touching the pipeline.
-->

---

# Memory

Context distillation instead of context compaction.

- **Problem:** most agents compress context when the window fills — lossy, reactive, drops details
- **Acolyte:** proactively extract structured facts and persist them across sessions
- Three tiers: **session** → **project** → **user**

```
┌──────────┐   ┌─────────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  ingest  │ → │  normalize  │ → │  select  │ → │  inject  │ → │  commit  │
└──────────┘   └─────────────┘   └──────────┘   └──────────┘   └──────────┘
```

- **Ingest / Normalize** — extract structured facts, deduplicate, and clean
- **Select** — pick what fits within the token budget
- **Inject** — add selected facts to the next request
- **Commit** — persist to storage for future sessions

Each stage is strategy-injectable. Inspired by [Mastra's Observational Memory](https://mastra.ai/docs/memory/observational-memory).

<!--
Most agents handle memory by compacting the conversation when it gets too long — summarizing or truncating. The problem is this fires under pressure, when the context window is full, and important details get silently dropped.

Acolyte does something different: context distillation. After each conversation, it extracts structured facts — observations like "this project uses pnpm workspaces" and reflections that consolidate multiple observations into higher-level understanding.

Three tiers:
- Session memory is conversation context within one session — what you're working on right now.
- Project memory persists across sessions for one codebase — architecture decisions, naming conventions, test patterns. Things you'd put in a CLAUDE.md.
- User memory is cross-project — your preferences, commit style, tool choices. Follows you everywhere.

The pipeline has five stages. Ingest pulls facts from the conversation. Normalize cleans them up. Select picks what fits in the budget. Inject adds them to the next request. Commit writes them to persistent storage.

Each stage is a strategy you can swap. The model is inspired by Mastra's Observational Memory — they use Observer and Reflector agents to compress history. We adapted the observation/reflection idea but with explicit scope promotion instead of threshold-based compression.
-->

---

# Context budgeting

Proactive token budgeting via tiktoken — not reactive compaction.

```
┌─────────────────┐   ┌──────────┐   ┌───────────────┐   ┌───────────┐   ┌─────────────────┐
│  system prompt  │ → │  memory  │ → │  attachments  │ → │  history  │ → │  tool payloads  │
└─────────────────┘   └──────────┘   └───────────────┘   └───────────┘   └─────────────────┘
```

- **System prompt** — measured and reserved first, non-negotiable baseline
- **Memory** — skills, memory facts, and session context
- **Attachments** — explicitly attached files
- **History** — conversation turns, newest first, fills remaining space
- **Tool payloads** — age-capped: recent turns get full budget, older ones shrink to 60 tokens

<!--
This is closely related to memory. You have a finite context window — say 128k or 200k tokens. How do you decide what goes in?

Most agents just fill it up and then panic when it overflows — compress, summarize, truncate. Acolyte does it the other way around: budget before assembly.

First, the system prompt — your soul prompt, instructions, active skills — gets measured with tiktoken and its cost is reserved. That's the non-negotiable baseline.

Then remaining space fills by priority. Pinned context and memory facts go in first — these are the high-value items. Then file attachments you've explicitly attached. Then conversation history, newest first. Finally tool payloads from previous calls.

The age-based compaction is important: a tool output from the last turn gets full budget, but one from 10 turns ago gets capped to 60 tokens. You still see it happened, but the full output is gone.

And when anything gets truncated, the model sees "[truncated — N tokens removed]". No silent data loss. The model knows it's missing context and can ask for it if needed.
-->

---

# Developer experience

Full TUI built with Ink.

- Fuzzy search and autocomplete for file paths, sessions, commands, skills
- Model picker that queries provider APIs for available models
- Structured tool output with typed rendering
- AST-based code editing and scanning via ast-grep
- Session management with history navigation
- Daemon lifecycle with Docker-style output
- Slash commands and SKILL.md support

<!--
The CLI isn't a thin wrapper — it's a full TUI. Fuzzy search for everything, model picker that queries your actual provider APIs, structured output so you can see what tools are doing. I'll show this in the demo.
-->

---

# Observability

Structured debug events for every lifecycle action.

```
task_id=task_abc123
10:00:01 lifecycle.tool.call    tool=edit-file path=src/foo.ts
10:00:02 lifecycle.tool.result  tool=edit-file duration_ms=45
10:00:02 lifecycle.guard        guard=file-churn action=blocked
10:00:03 lifecycle.eval         evaluator=verifyCycle action=regenerate
10:00:05 lifecycle.summary      model_calls=2 tool_calls=8 blocked=1
```

Dedicated trace tool parses daemon logs into compact timelines.

<!--
Every tool call, guard decision, and evaluator action is a structured event. There's a trace tool that parses the daemon logs into timelines like this. When something goes wrong, you can see exactly what happened and why.
-->

---

# Extensibility

Clean contracts at every seam — no plugin runtime, no DI container.

- **Lifecycle** — policy controls for step budgets, timeouts, and regeneration caps
- **Guards** — pluggable array, add custom guards without touching the pipeline
- **Memory** — strategy-injectable normalization and selection
- **Tools** — toolkit registration with permission categories and guard hooks
- **Skills** — declarative SKILL.md with tool restrictions and compatibility metadata

When you need to extend, you implement a contract. When you don't, the defaults work.

<!--
Everything I've shown has extension points. But the key design decision is: no plugin runtime.

There's no DI container, no extension API to maintain, no plugin lifecycle to manage. Each system exposes a clean interface — a TypeScript type you implement.

Want a custom guard? Implement the guard interface, add it to the array. Want a different memory selection strategy? Implement the strategy interface, pass it to the registry. Want to change how tools are registered? The toolkit contract is right there.

Skills are the most accessible example — they're just Markdown files with frontmatter. Drop a SKILL.md in your project, define what tools it can use, and it's available via slash commands.

And beyond extension, the existing systems are configurable out of the box — token budgets, step limits, tool output caps, model selection — all through the config file. You don't need to write code to tune behavior, only to add new behavior.

The principle is "interface-first boundaries." Clean contracts at every seam, but no framework overhead.
-->

---
layout: center
class: text-center
---

# Demo

Acolyte working on its own codebase.

<!--
Let me switch to the terminal. I'm going to use Acolyte on its own codebase — the tool working on itself. I'll show the TUI, give it a real task, and we'll see the lifecycle in action.

DEMO FLOW:
1. Open terminal in ~/code/acolyte worktree
2. Run acolyte — show TUI, daemon connection
3. Quick DX tour: fuzzy search (@src/life<tab>), model picker (/model)
4. Give it a task, watch tool calls stream
5. If a guard fires, narrate it
6. After: show lifecycle trace from logs
7. New session — show memory recall
-->

---

# Code quality

|  | Acolyte | Typical range |
|---|---|---|
| Source lines | 16.6k | 25k – 628k |
| Runtime dependencies | 13 | 50 – 480 |
| Test/source ratio | 0.80 | 0.04 – 0.69 |
| Avg lines/file | 121 | 157 – 438 |
| `any` type escapes | 1 | dozens – hundreds |
| TODO/FIXME markers | 0 | varies |

Compared against 8 open-source agents. Full benchmarks in `docs/benchmarks.md`.

<!--
Quick numbers. We benchmarked against 8 other open-source agents. Acolyte is the smallest codebase with the fewest dependencies, highest type safety, and zero tech debt markers. Not because it's trivial — because every module is independently testable by design.
-->

---

# Get started

```bash
git clone https://github.com/cniska/acolyte.git
cd acolyte
bun install
bun run client init   # prompts for API key
bun run dev           # starts daemon + CLI
```

<br>

[acolyte.sh](https://acolyte.sh) · [github.com/cniska/acolyte](https://github.com/cniska/acolyte)

<!--
"This repo just went public — you can clone it right now." Flip it to public before showing this slide. Four commands to get running. Thank you!
-->
