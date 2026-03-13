# Roadmap

## Vision

One AI coding assistant for day-to-day development across projects and machines.
Chat-first and opinionated for the 80% default workflow, with stable seams for customization.
Built for safe autonomous execution of bounded tasks with the developer in control.

## What shipped at launch

Acolyte v0 ships with these capabilities:

- **Foundations** — `bun run verify` runs lint, typecheck, and tests; CI passes on every commit
- **Core UX** — setup, diagnostics, per-tool permissions, error recovery
- **Execution engine** — 5-phase lifecycle (resolve → prepare → generate → evaluate → finalize) with streaming tool calls
- **Reliability** — anti-loop guards, step budgets, actionable diagnostics, automatic verify cycles
- **Autonomous execution** — bounded coding tasks end-to-end: plan, edit, verify, recover
- **Memory** — context distillation across session/project/user tiers, proactive token budgeting, rolling history pruning
- **Product polish** — typed RPC protocol, task-centric execution, skill parity, visual regression coverage
- **Extensibility** — interface-first boundaries for lifecycle, tools, guards, memory, and transport
- **OSS readiness** — docs, license, CI/CD, security baseline, localization, configurable locale

## What's next

Priorities for the near term, roughly ordered.

1. **Memory hardening** — evals for repeated instruction failures, hallucination checks, semantic recall via vector search
2. **Chat correctness** — end-to-end regression checks, cross-session memory continuity, edge case coverage
3. **Codebase polish** — audit/cleanup pass, `.gitignore`-based file discovery, config-driven permissions
4. **Early adopter feedback** — day-one value on real projects, usability fixes from first users
5. **Cloud sync** — shared storage services (memory, sessions), auth, local-first fallback

## Further out

- **Memory scalability** — progressive compaction for ultra-long sessions, storage backends beyond filesystem
- **Autonomy track** — bounded-task soak testing, failure explainability, stable protocol baseline
- **Long-run tasks** — background task IDs, detach/attach flow, task lifecycle RPC methods
- **Session workflows** — branching and session-tree navigation for isolated sub-tasks
- **Safety controls** — stronger tool policy, opt-in guard/evaluator policy controls
- **Tooling fidelity** — structured progress payloads, output truncation with on-demand full, output collapsing
- **Extension surface** — runtime hooks, agent-authored skills, slash command extensions
- **Embedding surface** — SDK-first local in-process API alongside CLI/RPC
- **Plan mode** — automatic planning phase from request intent, read-only tool set, lifecycle-driven plan→work transition
