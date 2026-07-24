# Acolyte Specification

> A terminal-first, local-first AI coding agent whose runtime decisions and boundaries are inspectable by the developer running it.

This document specifies what Acolyte must do, not how. Implementation choices are the builder's, provided the requirements and acceptance criteria below hold. Fixed decisions live in §13 Constraints; everything in §14 Open decisions is deliberately left open.

Requirement families used here: **FR** functional, **LC** lifecycle & completion, **MEM** memory, **SEC** security & sandbox, **PR** protocol & tasks, **OBS** observability, **TUI** terminal UI, **NF** non-functional, **AC** acceptance, **D** deliverables, **C** constraints. The domain families (LC, MEM, SEC, PR, OBS, TUI) are the dimensions where Acolyte carries non-obvious guarantees that deserve their own addressable tests.

## 1. Purpose & context

Coding agents are typically opaque: the user cannot see why the agent stopped, what it retrieved, where its file access was bounded, or what it spent. Acolyte's premise is that a coding agent should be *inspectable* — its lifecycle phases, memory retrieval, workspace boundary, token budget, and per-task timeline are first-class, observable, and locally stored. It runs as a persistent local daemon with a terminal client, so the same runtime serves the CLI, editors, and custom clients over one typed contract.

A second premise is that completion belongs to the model, not the host. The runtime supplies structure (tools, budgets, phases) and trusts the model to decide when work is done; it intervenes only with hard backstops a well-behaved agent would never trip.

**Primary user:** a developer working in a terminal on a local machine (macOS or Linux), who wants a coding agent they can audit. Not targeted: users wanting a hosted web IDE, a zero-config GUI product, or a Windows-native experience.

**Reference product:** the class of terminal coding agents (Claude Code, Codex CLI, opencode); Acolyte differentiates on inspectability, on-demand memory over context compaction, and explicit extension seams.

## 2. Functional requirements

### 2.1 Core behavior

- **FR-1** — Given a natural-language prompt, the agent produces a response by interleaving model generation with tool calls against the user's workspace, streaming progress as it works.
- **FR-2** — The agent runs as a persistent background daemon; the CLI client connects to it over a typed transport, and one daemon serves multiple clients.
- **FR-3** — Each request executes as a single generation pass (model + tool loop) with no host-imposed multi-pass planning; the model, not the host, decides when the task is complete.
- **FR-4** — Every tool invocation is funneled through one execution path that enforces the step budget, shapes errors into the shared error contract, records the call for observability and effects, and applies result caching; no tool bypasses this path.
- **FR-5** — Tool filesystem and command access is confined to a single resolved workspace root per request (see §5 SEC).

### 2.2 Input handling

- **FR-6** — Interactive chat accepts multi-line prompts.
- **FR-7** — A prompt may attach file or directory context by `@path` reference; the referenced content is included in the request context.
- **FR-8** — A workspace path supplied to a request must exist and be a directory; otherwise the request is rejected with an actionable message. When none is supplied, the current working directory is used.
- **FR-9** — Every value crossing a runtime boundary (transport payload, model response, configuration value, tool arguments) is validated before entering typed code; invalid input is rejected with a structured error rather than propagating.
- **FR-10** — A malformed CLI invocation (unknown command, missing required argument) produces an actionable usage message and a non-zero exit, and near-miss command names produce a suggestion.

### 2.3 Feature coverage — tools

- **FR-11** — File tools: find, search, and read files; create, edit, and delete files. Read-only file tools are gitignore-aware in what they surface.
- **FR-12** — Query file tools (find/search/read/scan) present a search-oriented contract; mutation file tools (edit/create/delete) present a targeting-oriented contract. The two are not unified merely because they share an engine.
- **FR-13** — AST-based structural code scanning and editing across supported source files; an edit against an unsupported file surfaces a structured error rather than a silent no-op.
- **FR-14** — Git tools: status, diff, log, show, add, commit.
- **FR-15** — GitHub tools (view/create/edit issues and pull requests), auto-enabled when the `gh` CLI is present and omitted otherwise.
- **FR-16** — Shell command execution and workspace test execution through the detected test command.
- **FR-17** — Web search and web fetch for external information.
- **FR-18** — Session search over the current conversation's history, available to the model on demand.
- **FR-19** — Skill activation/deactivation: a roster of skills is always advertised, and the model activates or deactivates them at runtime rather than all being injected upfront.
- **FR-20** — Inline multi-step task checklist the model maintains and the client renders.
- **FR-21** — MCP client: when enabled, external MCP servers (stdio or HTTP transport) are connected and their tools appear alongside native tools.

### 2.4 Feature coverage — CLI commands

- **FR-22** — `acolyte` (no command) starts interactive chat.
- **FR-23** — `acolyte run "<prompt>"` executes a one-shot task and exits; `--file <path>` adds file context.
- **FR-24** — `acolyte skill <name> [prompt]` runs a one-shot task with a named skill active.
- **FR-25** — `acolyte resume [id]` / `acolyte history` continue and list prior sessions; a session is resolvable by ID prefix.
- **FR-26** — `acolyte start|stop|restart|ps|status` manage and report daemon lifecycle.
- **FR-27** — `acolyte auth [provider]` authenticates a provider by API key or, where supported, subscription, and reports/removes credentials (see §5 SEC).
- **FR-28** — `acolyte config list|set|unset` reads and writes runtime configuration at user or project scope.
- **FR-29** — `acolyte memory list|add` manages persistent memory notes (see §3 MEM).
- **FR-30** — `acolyte logs` tails and filters the daemon log by count, level, session, and time window.
- **FR-31** — `acolyte trace [list] | trace task <id>` inspects task timelines (see §8 OBS).
- **FR-32** — `acolyte tool <tool-id> [args...]` runs a single tool directly, still subject to the workspace boundary.
- **FR-33** — `acolyte update` forces an update check; `acolyte login` / `acolyte logout` manage cloud credentials when cloud sync is enabled.
- **FR-34** — All list-style commands accept `--json` for machine-readable output.
- **FR-35** — `acolyte <command> help` (or `-h`/`--help`) prints detailed usage for that command.

### 2.5 Options / configuration

- **FR-36** — Configuration merges a user-scoped source and a project-scoped source, with project overriding user; the resolved surface includes model, temperature, reasoning level, provider base URLs, locale, log format, embedding and distill models, reply timeout, daemon port, and feature flags. The full settable-key set is fixed by the configuration reference, and an unknown key is rejected.
- **FR-37** — Feature flags are opt-in and default off: syncing AGENTS.md into project memory, undo checkpoints, parallel workspaces, cloud sync, and MCP. A disabled flag's surface (commands, tools, behavior) is absent, not merely inert.
- **FR-38** — Reasoning level (`low`/`medium`/`high`) is accepted and mapped to the selected provider's native reasoning control.
- **FR-39** — Locale selects the UI language; an unset locale defaults to English, and an unavailable locale falls back rather than failing.
- **FR-40** — Global update flags `--update` (force) and `--no-update` (skip) override the default startup update behavior; `--no-update` wins when both are present.

### 2.6 Provider support

- **FR-41** — Multiple model providers are supported (OpenAI, Anthropic, Google, and the Vercel AI Gateway); the active model selects the provider.
- **FR-42** — The model picker lists models by querying the configured provider(s) at runtime rather than from a static list.
- **FR-43** — An OpenAI-compatible local endpoint is usable by pointing the provider base URL at it and selecting the model explicitly.
- **FR-44** — When a direct provider key and the gateway are both available, the direct connection is preferred; when the direct key is absent, requests fall back to the gateway without configuration change.

### 2.7 Edge cases requiring special handling

- **FR-45** — File discovery excludes an always-ignored set (at minimum the VCS directory, dependency directory, and Acolyte's own state directory) that takes precedence over gitignore rules and cannot be re-included by a gitignore negation pattern.
- **FR-46** — A read-only/search tool result is served from cache on an identical call without re-execution, and a stale result is never served after a mutation that could affect it: a write tool evicts cached entries tracking the written path and all pathless search results, and after a shell execution no previously cached result is served. Windowed and full reads of the same path cache independently yet invalidate together.
- **FR-47** — An MCP server unreachable at task start is skipped with a warning and the request continues; it does not fail the task.
- **FR-48** — A tool call that exceeds its timeout is terminated and surfaced as a structured timeout error, not left hanging.

## 3. Memory requirements (MEM)

- **MEM-1** — Memory persists across sessions in three scopes: session, project, and user.
- **MEM-2** — Memory is retrieved on demand through memory tools the model invokes when it needs context; durable memory is never injected wholesale into the system prompt.
- **MEM-3** — The model can search, add, and remove memory records at runtime.
- **MEM-4** — After each request, a background distillation step extracts durable observations from the conversation and commits them at the appropriate scope, tagged with an optional single-word topic.
- **MEM-5** — Recall is scope-guarded: a record is returned only if the caller's context could have written to its scope — session facts only to their own session, project facts only to the current project, user facts always visible.
- **MEM-6** — Recall ranks records by relevance combining semantic similarity and keyword overlap; when embeddings are unavailable, it falls back to recency rather than failing.
- **MEM-7** — Memory commit at finalize is best-effort background work; a commit failure is recorded observably and never fails or delays the user-facing response.
- **MEM-8** — Exact-duplicate observations are not stored twice.
- **MEM-9** — With the AGENTS.md-sync flag enabled, the project's AGENTS.md is committed as a deterministic project memory record and recalled on demand instead of being injected into the prompt.

## 4. Lifecycle & completion requirements (LC)

- **LC-1** — Each request runs through four observable phases — resolve, prepare, generate, finalize — with clear boundaries.
- **LC-2** — The model terminates a turn by emitting a step with no tool calls; that step's text is the final response. The host never forces or fabricates completion.
- **LC-3** — Before finalizing, the terminal step is classified by its provider finish reason and answer text into accept, incomplete, or failed:
  - **LC-3a** — A normal finish with non-empty text is accepted as the final response.
  - **LC-3b** — An incomplete finish (empty answer, or output truncated by the token limit) reopens the turn exactly once with a model-facing nudge; a second incomplete finish of the same reason errors.
  - **LC-3c** — An unrecoverable finish (content filter, or a provider error) errors immediately without reopening.
- **LC-4** — A length/truncation finish is classified as truncated before the empty-text check, because a truncation can leave the text empty when the budget was spent on reasoning; a truncated continuation is appended to the prior fragment so the assembled answer is whole.
- **LC-5** — On any error verdict, the user-facing message is synthesized by the host (the model's rejected step is never presented as the answer), and any partial text is still surfaced alongside the error.
- **LC-6** — A per-turn tool-call ceiling bounds runaway loops within a single generation pass; the count resets each request and is never carried across independent human-gated turns. A no-tool-call step is not counted, so the model can always terminate.
- **LC-7** — When the tool-call ceiling is reached, further tool calls are blocked with a budget-exhausted error code and a neutral message; a single neutral notice is injected once when the count first crosses a high-water fraction of the ceiling, deduplicated per request.
- **LC-8** — Before each model call, the composed prompt size is estimated and checked against a per-call input-token limit that applies to each call, not to a cumulative turn total; overflow fails the call with a breakdown of system, tool, and message token counts.
- **LC-9** — The input-token limit is a flat ceiling applied uniformly across models rather than derived per model; for models whose window is at least the assumed baseline the check is exact, and for smaller models it is best-effort with the provider as the real enforcer.
- **LC-10** — Lifecycle-owned effects run per successful tool result: formatting runs silently, and lint findings are appended to the tool result so the model can see and act on them. Effects are driven by the detected workspace commands.
- **LC-11** — A tool-result payload is capped in size when written, so no single result consumes the next call's context; the per-call input check is the backstop for cumulative growth.
- **LC-12** — The active-skill roster is bounded to a fraction of the context window; when an entry does not fit, the whole entry is dropped rather than emitting a malformed partial skill description.
- **LC-13** — When earlier conversation history cannot fit the running window, the model receives an explicit gap notice and can retrieve the omitted history via session search; the drop is recorded observably.
- **LC-14** — A run-control object owns yield and cancellation for a run: a yield checkpoint is honored only between lifecycle decisions, never mid-step, and yielding skips result acceptance and memory commit. Cancellation is polled at event and error boundaries, and a cancelled run likewise skips result acceptance and memory commit at that decision point, so an undelivered result is not accepted or distilled into memory.
- **LC-15** — Provider rate limits are respected with sliding-window pacing and backoff, and provider prompt-cache behavior is used where available with cached-input tokens reported.

## 5. Security & sandbox requirements (SEC)

- **SEC-1** — Tool filesystem access outside the resolved workspace root is denied; access within it is allowed. Enforcement applies on every tool entry path, including direct CLI tool mode.
- **SEC-2** — Path validation is fail-closed and resolves real paths so symlink escapes are blocked; for a not-yet-existing path, the nearest existing parent is validated against the same boundary.
- **SEC-3** — A boundary violation returns a structured tool error with a stable sandbox-violation code and kind, not a raw exception.
- **SEC-4** — Shell execution runs an argv command without shell-string evaluation, validates the command path and path-like arguments against the workspace boundary, and runs with a restricted environment allowlist. (This is command-level, not kernel-level, isolation.)
- **SEC-5** — There is no per-tool approval prompt; trust is granted in advance at task start, and the workspace boundary is the enforced limit.
- **SEC-6** — Provider API keys are read from the process environment first, then a private credentials file with owner-only permissions; an environment value always overrides a stored key.
- **SEC-7** — Subscription (OAuth) tokens are stored separately from API keys with owner-only permissions and refresh automatically; logout can remove a key, a subscription, or both for a provider, and replacing stored credentials asks for confirmation.
- **SEC-8** — MCP is disabled by default and opt-in per repository; HTTP MCP servers must use HTTPS except for localhost, and stdio MCP subprocesses receive only a minimal environment allowlist plus explicitly configured variables.
- **SEC-9** — Acolyte has no product telemetry: trace events, logs, and memory remain on the local machine (or the user's own cloud when cloud sync is enabled) and are never uploaded to Acolyte.

## 6. Protocol & task requirements (PR)

- **PR-1** — The client/server transport contract is versioned and negotiated on connect; a version mismatch is rejected cleanly.
- **PR-2** — A request is one task payload (message, history, session ID, runtime options); a response is an ordered, append-only event stream followed by exactly one terminal reply.
- **PR-3** — Every request terminates with either a done reply or an error reply; a tool-output/result event always references a prior tool-call event's id; clients ignore unknown event fields for forward compatibility.
- **PR-4** — Each chat request becomes a tracked task with a server-assigned stable id moving through accepted → queued → running → completed | failed | cancelled; only the defined transitions are allowed and terminal states permit no further transition.
- **PR-5** — Execution is serial per connection: one active task at a time, additional requests queued FIFO with 1-based positions reported to the client, and independent connections run in parallel.
- **PR-6** — Queue capacity per connection is bounded; positions are re-emitted to remaining clients when the queue changes (abort or dequeue).
- **PR-7** — An abort request cancels the targeted request; a connection close cancels all of that connection's active and queued tasks.
- **PR-8** — Task records live in memory only (not persisted across daemon restart), bounded in count with oldest terminal tasks evicted first.
- **PR-9** — The daemon binds to the loopback interface only. When an API key is configured, every HTTP endpoint and WebSocket RPC connection (except the health check) requires bearer authentication; with no key configured, the loopback RPC is open. The transport is otherwise an implementation detail behind the contract.

## 7. Terminal UI requirements (TUI)

- **TUI-1** — The chat client renders in the terminal through a custom React renderer with its own reconciler; it does not depend on a general-purpose terminal-UI framework.
- **TUI-2** — Completed transcript content is flushed once to terminal scrollback and never re-rendered; only the active region is repainted on updates.
- **TUI-3** — Erase-and-repaint of the active region is atomic within a synchronized-output block to prevent flicker, with a documented fallback where synchronized output is unsupported.
- **TUI-4** — When the active region overflows the viewport, top lines are frozen to scrollback and only the bottom portion re-renders; terminal resize and focus-in invalidate frozen state and repaint cleanly.
- **TUI-5** — TUI state reads that depend on current state use the functional-update form so concurrent updates from streaming events and input handlers do not race on a stale value.
- **TUI-6** — Only active input handlers receive key events; terminal key parsing is centralized, with unambiguous modifier reporting on terminals that support the enhanced keyboard protocol.
- **TUI-7** — A live status line shows location, model, token usage, active skill, and PR context, updating token totals during a turn.
- **TUI-8** — Slash commands cover session control (new, clear, resume, sessions), model change, status, usage, memory management, skill run and skills picker, and exit; the parallel-workspaces commands appear only when that flag is enabled.
- **TUI-9** — Fuzzy autocomplete is offered for file paths, sessions, commands, and skills.
- **TUI-10** — A queued message typed while a turn is running is handled cooperatively and processed in order rather than dropped or interleaved mid-step.
- **TUI-11** — A user message preserves its whitespace in the transcript: leading indentation and internal whitespace runs are kept (tabs expanded to fixed-width stops), and a wrapped line repeats its indentation on each continuation row. Inline markup — backtick `code`, bold, and file paths — renders styled, with its delimiters interpreted.

## 8. Observability requirements (OBS)

- **OBS-1** — Every request is recorded as an ordered, task-scoped trace covering lifecycle phases, tool calls with their results, errors, and cache decisions, budget blocks, memory loads and commits, and a final summary. Recording is local.
- **OBS-2** — Traces are queryable after the fact: recent tasks are listable, and a single task's timeline and summary are renderable, with a machine-readable output mode.
- **OBS-3** — Structured daemon logs are tailable and filterable by line count, level, session, and time window.

## 9. Non-functional requirements (NF)

- **NF-1** — The daemon starts automatically on client use and manages its own lifecycle; the CLI checks for a newer released binary at most once per startup-day, and on update downloads, verifies checksum, self-replaces, stops the running server, and re-execs.
- **NF-2** — Installation is a single released binary for macOS and Linux via a one-line install script; no runtime toolchain install is required for end users.
- **NF-3** — SQLite-backed stores (memory, trace, cache) apply versioned forward migrations automatically and cumulatively on startup, within transactions.
- **NF-4** — Releases follow semantic versioning; patch and minor releases are always safe to apply.
- **NF-5** — Errors are classified by a structured code/kind, never by matching message strings; error messages are descriptive enough for the model to act on.
- **NF-6** — A failure in a non-critical subsystem does not fail the request: trace-store open/write failure warns once per session and continues; a memory commit failure is logged and swallowed; an effect (format/lint) failure is recorded and does not abort the tool result.
- **NF-7** — Sessions are bounded by per-call context pressure, not by a cumulative token cap, so long-lived sessions remain usable.
- **NF-8** — Each completed request reports input, output, total, and input-budget token counts with a prompt breakdown separating system, tools, skills, memory, and messages.

### 9.1 Testing

- **NF-9** — A test suite ships and must pass before release, layered into unit (pure, boundary effects mocked), integration (real server/lifecycle/tool wiring with a fake model provider), and visual TUI snapshot suites, with the boundary between unit and integration enforced by file-suffix convention.
- **NF-10** — Each §2.7 and lifecycle edge case has a dedicated test: the terminal-step classification and single-reopen policy (LC-3, LC-4), the per-turn budget reset and notice (LC-6, LC-7), the tool-execution funnel (FR-4), cache invalidation on write and shell (FR-46), the ignored-dirs precedence over gitignore (FR-45), symlink-escape denial (SEC-2), and TUI frozen-overflow rendering (TUI-4).
- **NF-11** — Filesystem, subprocess, and network boundaries are mocked in unit tests; behavior needing real such effects lives only in integration tests.
- **NF-12** — Changes affecting agent behavior are validated by running the real agent, not tests alone, before release.

## 10. Out of scope

- Windows-native support (macOS and Linux only).
- A GUI or web client in the core product; the transport contract permits third-party clients, but building them is out of scope.
- Kernel-level or container process isolation for tools; the sandbox is command- and path-level.
- Per-tool interactive approval prompts.
- Product telemetry / usage analytics upload.
- Cloud storage as a default; the hosted Postgres/pgvector backends exist only behind the cloud-sync flag.

## 11. Acceptance criteria

- **AC-1** — Running `acolyte run "<prompt>"` in a workspace streams progress and tool activity and ends with a single final assistant response and a usage report. (FR-1, FR-3, FR-23, PR-2, NF-8)
- **AC-2** — Starting one client auto-starts the daemon; a second client attaches to the same daemon, and both can run requests. (FR-2, NF-1, PR-5)
- **AC-3** — A model turn that ends with a no-tool-call step is accepted as final without any host-injected continuation, and its text is returned verbatim. (LC-2, LC-3a)
- **AC-4** — A turn whose terminal step is empty or truncated is reopened exactly once and, if it recurs, ends with a host-synthesized error that still shows any partial text; a content-filter or provider-error finish ends immediately with a host-synthesized error. (LC-3b, LC-3c, LC-4, LC-5)
- **AC-5** — With the tool-call ceiling reached, the next tool call is blocked with the budget-exhausted code and message, a single high-water notice was emitted earlier that turn, and a fresh request starts the count at zero. (FR-4, LC-6, LC-7)
- **AC-6** — A composed prompt exceeding the per-call input limit fails the call with a system/tools/messages token breakdown before reaching the provider. (LC-8, LC-9)
- **AC-7** — A tool attempting to read or write outside the workspace root — including via a symlink and via `acolyte tool` — returns the structured sandbox-violation error and performs no I/O outside the boundary. (FR-5, FR-32, SEC-1, SEC-2, SEC-3, SEC-4)
- **AC-8** — An identical read/search tool call returns a cached result without re-execution; a subsequent write to an overlapping path, or any shell execution, causes the next such call to re-execute. (FR-4, FR-46)
- **AC-9** — File discovery for find/search omits the always-ignored directories and honors nested gitignore, and a gitignore negation cannot re-include an always-ignored directory. (FR-11, FR-45)
- **AC-10** — The model retrieves relevant prior context via a memory search scoped so that no other session's or project's records appear, and user-scoped records are always visible; after the request, a durable observation is committed in the background without delaying the response. (MEM-2, MEM-4, MEM-5, MEM-7)
- **AC-11** — Each tracked task exposes its state transitions through the defined state machine, an abort moves an active/queued task to cancelled, and closing the connection cancels its outstanding tasks. (PR-4, PR-5, PR-7)
- **AC-12** — `acolyte trace task <id>` renders the task's ordered tool timeline and summary from local storage, and works with the daemon offline from any provider telemetry; a trace-store write failure did not fail the originating task. (FR-31, OBS-1, OBS-2, NF-6, SEC-9)
- **AC-13** — With MCP enabled, a reachable server's tools appear to the agent, and an unreachable server is skipped with a warning while the request still completes. (FR-21, FR-47, SEC-8)
- **AC-14** — In interactive chat, completed transcript rows move to scrollback and are not repainted, streaming and typed input update state without a lost or stale value, and a message typed mid-turn is queued and processed in order. (TUI-2, TUI-5, TUI-10)
- **AC-15** — `acolyte auth <provider>` stores a key with owner-only permissions, an environment-provided key overrides it for that provider, and `--logout` removes the selected credential(s); a disabled feature flag leaves its commands and behavior entirely absent. (FR-27, FR-37, SEC-6, SEC-7)
- **AC-16** — The project's full verification — lint, typecheck, all test suites, dependency audit — passes on a clean checkout, and the edge-case tests of NF-10 are present and passing. (NF-9, NF-10, NF-11)

## 12. Deliverables

- **D-1** — The `acolyte` CLI/daemon binary and its documented commands (§2.4).
- **D-2** — The one-line install script producing a self-updating macOS/Linux binary. (NF-2)
- **D-3** — The layered test suite (unit, integration, visual) and the behavior/perf/memory-benchmark harnesses. (NF-9)
- **D-4** — Canonical documentation under `docs/` (architecture, lifecycle, tooling, memory, workspace, sessions, tasks, protocol, configuration, CLI, errors, observability, TUI) and `AGENTS.md` invariants/seams.
- **D-5** — The bundled engineering-skill set (plan, build, review, and the others) available to the agent from first run.

## 13. Constraints (fixed)

- **C-1** — Runtime is Bun; language is TypeScript in strict mode.
- **C-2** — Every runtime boundary value is validated with Zod, and shared string unions/types are defined as a Zod schema first with the TypeScript type inferred from it.
- **C-3** — Dependency injection is by typed parameters with defaults read at composition roots — no DI container, no decorators.
- **C-4** — The terminal UI is a custom React reconciler renderer; a general-purpose TUI framework (e.g. Ink) is explicitly not used.
- **C-5** — Model access goes through the AI SDK provider abstraction for OpenAI, Anthropic, Google, and the Vercel AI Gateway.
- **C-6** — Source layout is a flat `src/` with `*-contract` modules for type/schema boundaries; imports are from the canonical source module with no re-export layers, and no transitional/dual-owner architecture is landed.
- **C-7** — Errors carry a structured `code`/`kind`; classification never depends on message-string matching.
- **C-8** — The product is local-first with no telemetry client; cloud storage exists only behind an opt-in flag.
- **C-9** — License is MIT.

## 14. Open decisions (left to the builder)

- Internal data structures and algorithms behind every requirement — the terminal-step classifier, the tool-execution funnel, the reconciler and serializer, prompt assembly and rolling-history fitting, and the recall scorer are mechanism, not contract; only their observable outcomes above are fixed.
- Exact prompt/nudge wording, provided the completion policy of LC-3/LC-4 holds.
- The precise ecosystem-detection rules and the set of detected ecosystems, provided a detected workspace yields install/lint/format/test commands (LC-10, FR-16).
- New tools and new lifecycle effects, added through the documented seams without changing existing contracts.

### Policies chosen (not open)

- **Storage defaults** — SQLite for memory/trace/cache and a JSON file for sessions are the defaults; Postgres/pgvector is selected only by the cloud-sync flag. (serves MEM-1, PR-8, NF-3, SEC-9)
- **Flat context ceiling** — the per-call input-token budget is a single fixed ceiling for all models rather than model-derived, because the product leans on on-demand memory over a large context window. (serves LC-8, LC-9, NF-7)
- **Native completion over forced completion** — the host never fabricates or forces turn completion; its only completion gate is the terminal-step finish-reason backstop. (serves LC-2, LC-3)
- **On-demand memory over context compaction** — durable and older context are retrieved by tool call, not injected or summarized into every prompt. (serves MEM-2, LC-13)
- **Per-turn (not session-wide) budget** — the tool-call ceiling bounds a single generation pass and resets each request. (serves LC-6)
- **No per-tool approval** — trust is granted in advance and bounded by the workspace sandbox rather than per-call prompts. (serves SEC-5)
- **Conservative shell invalidation** — a shell execution currently clears the whole tool-result cache; the contract is only that no stale result is served (FR-46), so a future path-scoped invalidation may replace the full clear. (serves FR-46)
- **Default daemon port and queue bounds** — a fixed default daemon port, one active task per connection, and a bounded per-connection queue are chosen defaults, the port being user-configurable. (serves FR-36, PR-5, PR-6)
