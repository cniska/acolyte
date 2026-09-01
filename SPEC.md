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
- **FR-4** — Every tool invocation is funneled through one execution path that enforces the step budget, shapes errors into the shared error contract, and records the call for observability and effects; no tool bypasses this path.
- **FR-5** — Tool filesystem and command access is confined to a single resolved workspace root per request (see §5 SEC).

### 2.2 Input handling

- **FR-6** — Interactive chat accepts multi-line prompts.
- **FR-7** — A prompt may attach file or directory context by `@path` reference; the referenced content is included in the request context. Completion candidates include gitignored paths and exclude nested repository checkouts.
- **FR-8** — A workspace path supplied to a request must exist and be a directory; otherwise the request is rejected with an actionable message. When none is supplied, the current working directory is used.
- **FR-9** — Every value crossing a runtime boundary (transport payload, model response, configuration value, tool arguments) is validated before entering typed code; invalid input is rejected with a structured error rather than propagating.
- **FR-10** — A malformed CLI invocation (unknown command, missing required argument) produces an actionable usage message and a non-zero exit, and near-miss command names produce a suggestion.

### 2.3 Feature coverage — tools

- **FR-11** — File tools: find, search, and read files; create, edit, and delete files. Read-only file tools are gitignore-aware in what they surface. File find matches its pattern as a path glob against workspace-relative paths, and as a case-insensitive substring when the pattern contains no wildcard; when its result cap withholds matches it reports the full match count, and when its workspace-discovery cap withholds matches it reports the shown count as a lower bound rather than presenting a truncated list as complete. File read returns the whole file as numbered lines under a header stating the served line range and the file's total length, and accepts an explicit start line and line count; a read exceeding the token ceiling fails with a structured error naming the file's length so the caller can narrow the range, a file exceeding the byte ceiling is readable at no range at all, and neither ever returns a truncated result as though it were complete. File mutation reports its change as a diff describing only what changed, so the reported size tracks the edit rather than the file.
- **FR-12** — Query file tools (find/search/read/scan) present a search-oriented contract; mutation file tools (edit/create/delete) present a targeting-oriented contract. The two are not unified merely because they share an engine.
- **FR-13** — AST-based structural code scanning and editing across supported source files; an edit against an unsupported file surfaces a structured error rather than a silent no-op.
- **FR-14** — Git tools: status, diff, log, show, add, commit.
- **FR-15** — GitHub tools (view/create/edit issues and pull requests), auto-enabled when the `gh` CLI is present and omitted otherwise.
- **FR-16** — Shell command execution and workspace test execution through the detected test command.
- **FR-17** — Web search and web fetch for external information.
- **FR-18** — Session search over the current conversation's history, available to the model on demand.
- **FR-19** — Skill activation/deactivation: a roster of skills is always advertised, and the model activates or deactivates them at runtime rather than all being injected upfront. Skills are discovered from `.agents/skills` in the workspace and in the home directory, and from installed plugins; a name claimed in both scopes resolves to the workspace copy, a hand-placed skill replaces a plugin skill of the same name, and a hand-placed or plugin skill replaces a bundled skill of the same name.
- **FR-20** — Inline multi-step task checklist the model maintains and the client renders.
- **FR-21** — MCP client: when enabled, external MCP servers (stdio or HTTP transport) are connected and their tools appear alongside native tools. Servers come from the workspace MCP configuration and from installed plugins; a plugin's servers are namespaced by plugin name so they cannot collide with workspace servers.
- **FR-49** — Agent Plugins: when enabled, plugins are discovered from `.agents/plugins` in the workspace and in the home directory, each a directory whose manifest declares the supported standard version, and each contributing skills and MCP servers from their fixed locations. A plugin's identity is its manifest name rather than its directory name, and a workspace plugin shadows a home plugin claiming the same name.
- **FR-50** — A plugin fault is contained to the smallest thing that failed: a plugin whose manifest is unreadable, invalid, or of an unsupported version is rejected whole; an unrecognized manifest field is reported and ignored; an unreadable or invalid MCP file drops that plugin's servers while its skills still load; and an individual server or skill that fails validation is skipped while its siblings still load. Every fault is counted in the diagnostics the status surface reports.

### 2.4 Feature coverage — CLI commands

- **FR-22** — `acolyte` (no command) starts interactive chat.
- **FR-23** — `acolyte run "<prompt>"` executes a one-shot task and exits; `--file <path>` adds file context.
- **FR-24** — `acolyte skill <name> [prompt]` runs a one-shot task with a named skill active.
- **FR-25** — `acolyte resume [id]` / `acolyte history` continue and list prior sessions; a session is resolvable by ID prefix.
- **FR-26** — `acolyte start|stop|restart|ps|status` manage and report daemon lifecycle; `status` also reports daemon health, including memory storage and size and known resource misconfiguration. When the daemon is not running, `status --json` emits a stopped-state JSON object and exits non-zero; the human start hint appears only in text mode.
- **FR-27** — `acolyte auth [provider]` authenticates a provider by API key or, where supported, subscription, and reports/removes credentials (see §5 SEC).
- **FR-28** — `acolyte config list|set|unset` reads and writes runtime configuration at user or project scope.
- **FR-29** — `acolyte memory list|add|restore` manages persistent memory notes and their archive (see §3 MEM).
- **FR-30** — `acolyte logs` tails and filters the daemon log by count, level, session, and time window.
- **FR-31** — `acolyte trace [list] | trace task <id>` inspects task timelines (see §8 OBS).
- **FR-32** — `acolyte tool <tool-id> ['<json-input>']` runs a single tool directly: input is an optional single JSON-object argument validated by the tool's input schema, and the run is still subject to the workspace boundary.
- **FR-33** — `acolyte update` forces an update check; `acolyte login` / `acolyte logout` manage cloud credentials when cloud sync is enabled, and `login` copies the machine's durable memories and sessions into the account.
- **FR-34** — All list-style commands accept `--json` for machine-readable output, and a `--json` invocation writes only parseable JSON records to stdout without startup notices, styling, or other human output before them. An empty result writes an empty stream.
- **FR-34a** — Errors and warnings are written to stderr, so a command's stdout carries only what the command was asked to produce.
- **FR-35** — `acolyte <command> help` (or `-h`/`--help`) prints detailed usage for that command.
- **FR-51** — Human-facing CLI output carries color only when its destination is a terminal and `NO_COLOR` is unset; redirected or piped output is plain text.

### 2.5 Options / configuration

- **FR-36** — Configuration merges a user-scoped source and a project-scoped source, with project overriding user; the resolved surface includes model, reasoning level, provider base URLs, locale, log format, embedding model and optional embedding base URL, distill model, reply timeout, daemon port, and feature flags. The full settable-key set is fixed by the configuration reference, and an unknown key is rejected.
- **FR-37** — Feature flags are opt-in and default off: syncing AGENTS.md into project memory, undo checkpoints, workspaces, cloud sync, MCP, and plugins. A disabled flag's surface (commands, tools, behavior) is absent, not merely inert.
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
- **FR-47** — An MCP server unreachable at task start is skipped with a warning and the request continues; it does not fail the task.
- **FR-48** — A tool call that exceeds its timeout is terminated and surfaced as a structured timeout error, not left hanging.

## 3. Memory requirements (MEM)

- **MEM-1** — Memory persists across sessions in three scopes: session, project, and user. A project is identified by the `owner/repo` its `origin` remote names, so every checkout and worktree of one repository shares one project scope however the remote is addressed and whichever forge hosts it. A workspace whose repository has no such `origin`, and a workspace that is not in a repository, has no project scope: session and user memory still work there, an explicit project-scoped write fails saying the workspace has no remote, and a background project-scoped commit is skipped and recorded in the trace.
- **MEM-2** — Memory is retrieved on demand through memory tools the model invokes when it needs context; durable memory is never injected wholesale into the system prompt.
- **MEM-3** — The model can search and add memory records at runtime.
- **MEM-4** — After each request, a background distillation step extracts durable observations from the conversation and from a record of the turn's own work — the files it changed, the commands it ran and whether they failed — and commits them at the appropriate scope, tagged with an optional single-word topic. An observation is one self-contained claim about the work that could not be recovered by reading the code; a turn that establishes nothing durable commits nothing.
- **MEM-5** — Recall is scope-guarded: a record is returned only if the caller's context could have written to its scope — session facts only to their own session, project facts only to the current project, user facts always visible.
- **MEM-6** — Recall ranks records by relevance combining semantic similarity and keyword overlap; when the query cannot be embedded, recall fails with a classified error naming the cause rather than returning results ranked on the remaining partial signal.
- **MEM-7** — Memory commit at finalize is best-effort background work; a commit failure is recorded observably and never fails or delays the user-facing response.
- **MEM-8** — Exact-duplicate observations are not stored twice.
- **MEM-9** — With the AGENTS.md-sync flag enabled, the project's AGENTS.md is committed as a deterministic project memory record and recalled on demand instead of being injected into the prompt.
- **MEM-10** — Retiring a record moves it to an archive rather than deleting it, and records why it left: superseded by named successor records, retired under capacity pressure, or judged not a fact. Retirement never destroys a record; explicit user removal is the only operation that does.
- **MEM-11** — Retirement carries lineage: a superseded record names every successor that replaced it, so merging many records into one and splitting one into many are both recoverable. Commits that can converge on a project or user scope are serialized for that scope.
- **MEM-12** — Archived records are excluded from recall and from the active listing, and can be inspected and restored on demand; a restored record is recallable again.
- **MEM-13** — Distillation sees the facts already held that are relevant to the turn, so a new observation can replace them instead of duplicating them: it may record nothing when a fact is already held, or record a sharper, corrected, merged, or split version that supersedes the records it replaces. Reading the corpus for this purpose does not count as recalling it.
- **MEM-14** — A supersession is honored only for records that distillation was shown and that share the scope being written to, and only when a successor record was actually stored.

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
- **LC-14** — A run-control object owns yield and cancellation for a run: a yield checkpoint is honored only between lifecycle decisions, never mid-step, and yielding skips result acceptance and memory commit. Cancellation stops the run rather than only discarding its outcome: it aborts the in-flight provider call, no further model step or tool call starts, and the run skips result acceptance and memory commit, so an undelivered result is neither produced at further cost nor distilled into memory.
- **LC-15** — Provider rate limits are respected with sliding-window pacing and backoff, and provider prompt-cache behavior is used where available with cached-input tokens reported.

## 5. Security & sandbox requirements (SEC)

- **SEC-1** — Tool filesystem access outside the sandbox boundary is denied; access within it is allowed. Enforcement applies on every tool entry path, including direct CLI tool mode.
- **SEC-2** — Path validation is fail-closed and resolves real paths so symlink escapes are blocked; for a not-yet-existing path, the nearest existing parent is validated against the same boundary.
- **SEC-3** — A boundary violation returns a structured tool error with a stable sandbox-violation code and kind, not a raw exception.
- **SEC-4** — Shell execution runs an argv command without shell-string evaluation, validates the command path and path-like arguments against the workspace boundary, and runs with a restricted environment allowlist. (This is command-level, not kernel-level, isolation.)
- **SEC-5** — There is no per-tool approval prompt; trust is granted in advance at task start, and the workspace boundary is the enforced limit.
- **SEC-6** — Provider API keys and the dedicated embedding API key are read from the process environment first, then a private credentials file with owner-only permissions; an environment value always overrides a stored key. Secrets are never configuration values.
- **SEC-7** — Subscription (OAuth) tokens are stored separately from API keys with owner-only permissions and refresh automatically; logout can remove a key, a subscription, or both for a provider, and replacing stored credentials asks for confirmation.
- **SEC-8** — MCP is disabled by default and opt-in per repository; HTTP MCP servers must use HTTPS except for localhost, and stdio MCP subprocesses receive only a minimal environment allowlist plus explicitly configured variables.
- **SEC-9** — Acolyte has no product telemetry: trace events, logs, and memory remain on the local machine (or the user's own cloud when cloud sync is enabled) and are never uploaded to Acolyte.
- **SEC-10** — When the workspace sits inside a git repository, the sandbox boundary is that repository's root — the outermost enclosing repository, so a worktree nested in a repository resolves to the primary checkout and project-owned paths reached from it, including through a symlink, stay inside the boundary. Otherwise the boundary is the workspace root, which also covers a worktree living outside its repository. The boundary never widens to a repository at or above the home directory, so a git-tracked home does not turn one project's grant into everything the user owns. File enumeration and search scoping stay keyed to the workspace root in every case.
- **SEC-11** — Plugins are disabled by default and opt-in per repository, and a plugin's MCP servers additionally require MCP to be enabled.
- **SEC-12** — A plugin-declared executable or working directory must resolve, through the filesystem, inside that plugin's own root or data directory; one that escapes disables that server rather than launching it.
- **SEC-13** — A cloud URL must use HTTPS except for localhost; `login` refuses a plaintext one and stores no credentials.

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
- **PR-10** — Stopping the daemon asks it to shut down before signalling it, and it refuses while any task is unfinished, naming each live task and its session, and reports that refusal as a failure. An explicit force flag stops it regardless. A restart that is refused starts no replacement, and a self-update never forces.
- **PR-11** — A turn whose transport dies mid-flight fails with a coded error stating that the server stopped, that the session survived, and that the message can be sent again. The turn is never reconstructed from partial output.

## 7. Terminal UI requirements (TUI)

- **TUI-1** — The chat client renders in the terminal through a custom React renderer with its own reconciler; it does not depend on a general-purpose terminal-UI framework.
- **TUI-2** — Completed transcript content is flushed once to terminal scrollback and never re-rendered; only the active region is repainted on updates.
- **TUI-3** — Erase-and-repaint of the active region is atomic within a synchronized-output block to prevent flicker, and a scrollback wipe reaches the terminal in the same block as the repaint that follows it, with a documented fallback where synchronized output is unsupported.
- **TUI-4** — When the active region overflows the viewport, top lines are frozen to scrollback and only the bottom portion re-renders; an appended line costs the same repaint whether or not the region overflows; terminal resize and focus-in invalidate frozen state and repaint cleanly.
- **TUI-5** — TUI state reads that depend on current state use the functional-update form so concurrent updates from streaming events and input handlers do not race on a stale value.
- **TUI-6** — Only active input handlers receive key events; terminal key parsing is centralized, with unambiguous modifier reporting on terminals that support the enhanced keyboard protocol.
- **TUI-7** — A live status line shows location, model, token usage, active skill, and PR context, updating token totals during a turn.
- **TUI-8** — Slash commands cover session control (new, clear, resume, sessions), model change, status, usage, memory management, skill run and skills picker, and exit; the workspaces commands appear only when that flag is enabled. A skill runs as `/skill:<name>`, so a skill and a built-in command of the same name each keep their own address.
- **TUI-9** — Fuzzy autocomplete is offered for file paths, sessions, commands, and skills.
- **TUI-10** — A queued message typed while a turn is running is handled cooperatively and processed in order rather than dropped or interleaved mid-step.
- **TUI-11** — A user message preserves its whitespace in the transcript: leading indentation and internal whitespace runs are kept (tabs expanded to fixed-width stops), and a wrapped line repeats its indentation on each continuation row. Inline markup — backtick `code`, bold, and file paths — renders styled, with its delimiters interpreted. A fenced code block renders syntax-highlighted like assistant output, its fence interpreted; unfenced text stays verbatim.
- **TUI-12** — Exiting the chat client releases its connection immediately, so an in-flight task is cancelled rather than left running to completion after the user has quit.
- **TUI-13** — A command, its subcommands, and its help text come from one descriptor, so the completion menu offers only what dispatch can run: it lists a command and its declared subcommands, while argument forms appear in the help pane. A command that accepts arguments on its bare root declares that form, and an unrecognized token names what was rejected and lists every form the command accepts.
- **TUI-14** — A typed prompt wraps inside the input box: no row exceeds the box interior, wrapping preserves every character, and a run too long for one row breaks across rows. Vertical cursor motion steps between visual rows at the caret's display column.
- **TUI-15** — Consecutive blocks of assistant prose render as one transcript row separated by a paragraph break, and that break is preserved in the answer text kept for model history; a row is sealed only by an interruption such as a tool call, and text resumed after a length cutoff continues the same block rather than opening a new one.
- **TUI-16** — Every turn closes with one footer line reporting elapsed time, tool count, and token counts, however fast the turn was. An interrupted turn closes with the same line and the same detail, labelled as interrupted in the text rather than in colour alone.
- **TUI-17** — A wrapped list item in assistant prose hangs its continuation rows under the item's text, so a continuation never reads as a new top-level line. Ordered and unordered markers are treated alike, and a list item keeps the indentation it was written with, so nesting survives rendering.
- **TUI-18** — A key sequence, a bracketed paste, or a multi-byte character split across terminal reads produces the single event it was sent as: never literal escape characters in the composer, and never a submit from a newline inside a paste. An escape byte arriving as a whole read acts as the escape key at once, and a held sequence is released by the first read that cannot continue it, so a following keystroke — interrupt included — is never absorbed into it. A paste whose terminator never arrives is released once it passes the paste limit, so later keystrokes reach their handlers.
- **TUI-19** — A tool call's output reaches the interactive transcript in the order the tool sent it, without altering or reshaping any part. Ending a turn — completed, interrupted, or cancelled — reveals whatever is still held. A row opening beneath either reveals what is held or waits for it, so nothing is committed below a row still holding content it has not shown. Output written to a stream that cannot revise a printed row is neither paced nor bounded: it carries every part the tool sent.
- **TUI-20** — A transcript row is eligible for scrollback only once all of its content is on screen and nothing can take that content away again.
- **TUI-21** — Output a tool call did not change the workspace with occupies a bounded window of rows in the interactive transcript, whatever the size of the result behind it, and states how many lines it left out. Which end it keeps follows how the output is read: a listing, a log, or a requested diff keeps its first rows; a command, read for how it ended, keeps its last. A mutation is not bounded that way — every row it sends stays.
- **TUI-21a** — A mutation's rows are revealed one at a time, as fast as the display can paint them. No other output is paced: a running tool's rows appear as they arrive, and the rest is shown in full the moment the tool returns. A mutation's reveal runs to completion, so a row opening after it waits and the transcript may trail the model by the length of that reveal.
- **TUI-22** — What a tool call reveals in the interactive transcript is what it keeps: no row is trimmed, replaced, or taken back once it has been shown, whatever the call's outcome and wherever it sat in the turn. The model receives the tool's full result regardless of what the transcript retains.
- **TUI-23** — A call's row is marked with its outcome as soon as its result arrives, while its output is still arriving. The row becomes eligible for scrollback once the last of that output is on screen.
- **TUI-24** — A tool call the turn ends without a result — interrupted, cancelled, or failed — is marked cancelled, so no row is left reading as live once the turn is over.
- **TUI-25** — A created file is shown as its content: every line verbatim and numbered, syntax-highlighted by the file's type, in the same shape a change's lines take but carrying no change marker and no change band, because nothing about a new file changed.

## 8. Observability requirements (OBS)

- **OBS-1** — Every request is recorded as an ordered, task-scoped trace covering lifecycle phases, tool calls with the arguments that determine what they return and with their results, errors, budget blocks, memory loads and commits, and a final summary. Recording is local.
- **OBS-2** — Traces are queryable after the fact: recent tasks are listable, and a single task's timeline and summary are renderable, with a machine-readable output mode.
- **OBS-2a** — A single task's timeline can be narrowed to named events, to one tool's events, or to both at once, in every output mode. A name outside the recorded event vocabulary is refused rather than silently matching nothing.
- **OBS-3** — Structured daemon logs are tailable and filterable by line count, level, session, and time window.

## 9. Non-functional requirements (NF)

- **NF-1** — The daemon starts automatically on client use and manages its own lifecycle; the CLI checks for a newer released binary at most once per startup-day, and on update downloads, verifies checksum, self-replaces, stops the running server, and re-execs.
- **NF-2** — Installation is a single released binary for macOS and Linux via a one-line install script; no runtime toolchain install is required for end users.
- **NF-3** — SQLite-backed stores (memory and trace) apply versioned forward migrations automatically and cumulatively on startup, within transactions.
- **NF-4** — Releases follow semantic versioning; patch and minor releases are always safe to apply.
- **NF-5** — Errors are classified by a structured code/kind, never by matching message strings; error messages are descriptive enough for the model to act on.
- **NF-6** — A failure in a non-critical subsystem does not fail the request: trace-store open/write failure warns once per session and continues; a memory commit failure is logged and swallowed; an effect (format/lint) failure is recorded and does not abort the tool result.
- **NF-7** — Sessions are bounded by per-call context pressure, not by a cumulative token cap, so long-lived sessions remain usable.
- **NF-8** — Each completed request reports input, output, total, and input-budget token counts with a prompt breakdown separating system, tools, skills, memory, and messages. An interrupted or failed request records the usage it streamed before it ended, so the session accounts for spend whether or not a turn completes.

### 9.1 Testing

- **NF-9** — A test suite ships and must pass before release, layered into unit (pure, boundary effects mocked), integration (real server/lifecycle/tool wiring with a fake model provider), and visual TUI snapshot suites, with the boundary between unit and integration enforced by file-suffix convention.
- **NF-10** — Each §2.7 and lifecycle edge case has a dedicated test: the terminal-step classification and single-reopen policy (LC-3, LC-4), the per-turn budget reset and notice (LC-6, LC-7), the tool-execution funnel (FR-4), the ignored-dirs precedence over gitignore (FR-45), symlink-escape denial (SEC-2, SEC-12), and TUI frozen-overflow rendering (TUI-4).
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
- **AC-7** — A tool attempting to read or write outside the sandbox boundary — including via a symlink and via `acolyte tool` — returns the structured sandbox-violation error and performs no I/O outside the boundary, while a worktree nested in its repository can reach project-owned paths in that repository. (FR-5, FR-32, SEC-1, SEC-2, SEC-3, SEC-4, SEC-10)
- **AC-9** — File discovery for find/search omits the always-ignored directories and honors nested gitignore, and a gitignore negation cannot re-include an always-ignored directory. (FR-11, FR-45)
- **AC-10** — The model retrieves relevant prior context via a memory search scoped so that no other session's or project's records appear, and user-scoped records are always visible; after the request, a durable observation is committed in the background without delaying the response. (MEM-2, MEM-4, MEM-5, MEM-7)
- **AC-11** — Each tracked task exposes its state transitions through the defined state machine, an abort moves an active/queued task to cancelled, and closing the connection cancels its outstanding tasks. (PR-4, PR-5, PR-7)
- **AC-12** — `acolyte trace task <id>` renders the task's ordered tool timeline and summary from local storage, and works with the daemon offline from any provider telemetry; a trace-store write failure did not fail the originating task. Narrowing the same task by event name, by tool, or by both yields only matching events in every output mode, and an unknown event name is refused. Piped human output carries no color. (FR-31, FR-51, OBS-1, OBS-2, OBS-2a, NF-6, SEC-9)
- **AC-13** — With MCP enabled, a reachable server's tools appear to the agent, and an unreachable server is skipped with a warning while the request still completes. (FR-21, FR-47, SEC-8)
- **AC-14** — In interactive chat, completed transcript rows move to scrollback and are not repainted, streaming and typed input update state without a lost or stale value, and a message typed mid-turn is queued and processed in order; a keystroke or paste delivered as two terminal reads still arrives as one event; a command revealing a result larger than its window never grows past that window and keeps what it showed, whether it succeeded or failed and wherever it sat in the turn, while an edit keeps its whole diff and a create shows every line of its content; interrupting or exiting while a turn is in flight cancels that task and stops it — no further model call or tool call runs. (TUI-2, TUI-5, TUI-10, TUI-12, TUI-18, TUI-19, TUI-20, TUI-21, TUI-21a, TUI-22, TUI-23, TUI-24, TUI-25, LC-14)
- **AC-15** — `acolyte auth <provider>` stores a key with owner-only permissions, an environment-provided key overrides it for that provider, and `--logout` removes the selected credential(s); a disabled feature flag leaves its commands and behavior entirely absent. (FR-27, FR-37, SEC-6, SEC-7)
- **AC-17** — With plugins enabled, an installed plugin's skills appear in the roster and its MCP servers' tools appear to the agent under plugin-qualified names; with plugins disabled both are absent, and with MCP disabled the plugin's servers are absent while its skills remain. A plugin carrying one invalid server or skill still contributes its valid ones. (FR-49, FR-50, FR-37, SEC-11)
- **AC-18** — `acolyte login` to an account copies durable memories with their embeddings and every stored session into it, leaves session-scoped memories and the archive on the machine, and exits non-zero when the cloud rejects the token; a plaintext non-localhost URL is refused before any credential is stored. (FR-33, SEC-13)
- **AC-16** — The project's full verification — lint, typecheck, all test suites, dependency audit — passes on a clean checkout, and the edge-case tests of NF-10 are present and passing. (NF-9, NF-10, NF-11)

## 12. Deliverables

- **D-1** — The `acolyte` CLI/daemon binary and its documented commands (§2.4).
- **D-2** — The one-line install script producing a self-updating macOS/Linux binary. (NF-2)
- **D-3** — The layered test suite (unit, integration, visual) and the perf/memory-benchmark harnesses. (NF-9)
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

- **Storage defaults** — SQLite for memory and trace and a JSON file for sessions are the defaults; Postgres/pgvector is selected only by the cloud-sync flag. (serves MEM-1, PR-8, NF-3, SEC-9)
- **Flat context ceiling** — the per-call input-token budget is a single fixed ceiling for all models rather than model-derived, because the product leans on on-demand memory over a large context window. (serves LC-8, LC-9, NF-7)
- **Native completion over forced completion** — the host never fabricates or forces turn completion; its only completion gate is the terminal-step finish-reason backstop. (serves LC-2, LC-3)
- **On-demand memory over context compaction** — durable and older context are retrieved by tool call, not injected or summarized into every prompt. (serves MEM-2, LC-13)
- **Per-turn (not session-wide) budget** — the tool-call ceiling bounds a single generation pass and resets each request. (serves LC-6)
- **No per-tool approval** — trust is granted in advance and bounded by the workspace sandbox rather than per-call prompts. (serves SEC-5)
- **Whole-file reads with fixed ceilings** — file read returns the entire file rather than a window, bounded by a fixed byte ceiling and a fixed ceiling on the estimated tokens of the returned text; both are chosen defaults, not user-configurable. (serves FR-11)
- **Git as the diff engine** — edit reporting delegates to Git rather than to an in-tree diff implementation, so one engine produces every diff Acolyte shows; Git is a runtime prerequisite and its absence is a stated error, not a fallback path. (serves FR-11, FR-13, FR-14)
- **Default daemon port and queue bounds** — a fixed default daemon port, one active task per connection, and a bounded per-connection queue are chosen defaults, the port being user-configurable. (serves FR-36, PR-5, PR-6)
