# Context Budgeting

Acolyte plans each model call before assembly. It reserves known prompt costs first, fits the remaining context deliberately, and reports the resulting token use back to the user.

## Per-call input limit

Before generation, Acolyte accounts for the system prompt, tool definitions, current user message, active skills, available-skill roster, suggestions, and history. The configured input limit applies to each model call, not to a cumulative turn total.

If the final composition exceeds the limit, the request fails with a breakdown of system, tool, and message token counts. This catches an oversized prompt before it reaches the provider.

## Context window behavior

The runtime maintains a running context window: recent conversational turns are kept newest-first within the remaining budget. It limits the active-skill roster by a fixed fraction of the context window and drops whole entries instead of emitting malformed partial skill descriptions.

When earlier history cannot fit, the model receives an explicit gap notice and can use `session-search` to retrieve it. The runtime records `lifecycle.window.drop` with the number of omitted turns, their estimated tokens, and the retained history size. Tool results are also capped individually when they are written, preventing one large result from consuming the next call's context.

## On-demand retrieval

The running window carries the current conversation. It does not inject all prior session history or durable memory into every prompt. When the model needs older conversation context, it uses `session-search`. When it needs durable context across sessions, projects, or user preferences, it uses the memory toolkit's `memory-search` tool.

Rather than compacting the live conversation into a summary, Acolyte keeps the running window bounded and retrieves earlier or durable context on demand. The same toolkit also provides `memory-add` and `memory-remove` for explicit memory management.

## Usage reporting

Each completed request returns input, output, total, and input-budget token counts. Its prompt breakdown separates system instructions, tools, skills, memory, and messages. The TUI updates token totals during a turn and `/usage` shows the last turn alongside session totals when more than one turn exists.

## Key files

- `src/agent-input.ts` — prompt assembly and rolling history fitting
- `src/prompt-size.ts` — prompt-size estimates and budget errors
- `src/lifecycle-generate.ts` — per-call input limits passed to the agent
- `src/lifecycle-finalize.ts` — request usage and prompt-breakdown reporting

## Further reading

- [Lifecycle](./lifecycle.md) — pre-call input limits and tool-result caps
- [Memory](./memory.md) — on-demand retrieval instead of upfront memory injection
- [Configuration](./configuration.md) — runtime limits and model settings
