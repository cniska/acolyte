# Code Review Checklist

Review in this order.

## 1. Protocol and contracts

- [ ] [`src/protocol.ts`](../src/protocol.ts)
- [ ] [`src/rpc-protocol.ts`](../src/rpc-protocol.ts)
- [ ] [`src/api.ts`](../src/api.ts)
- [ ] [`src/types.ts`](../src/types.ts)
- [ ] [`src/task-state.ts`](../src/task-state.ts)
- [ ] [`src/tool-error-codes.ts`](../src/tool-error-codes.ts)

## 2. Config and provider behavior

- [ ] [`src/config.ts`](../src/config.ts)
- [ ] [`src/config-modes.ts`](../src/config-modes.ts)
- [ ] [`src/app-config.ts`](../src/app-config.ts)
- [ ] [`src/env.ts`](../src/env.ts)
- [ ] [`src/provider-config.ts`](../src/provider-config.ts)

## 3. Lifecycle and agent policy

- [ ] [`src/lifecycle.ts`](../src/lifecycle.ts)
- [ ] [`src/lifecycle-evaluators.ts`](../src/lifecycle-evaluators.ts)
- [ ] [`src/lifecycle-events.ts`](../src/lifecycle-events.ts)
- [ ] [`src/agent.ts`](../src/agent.ts)
- [ ] [`src/agent-modes.ts`](../src/agent-modes.ts)

## 4. Tools and guardrails

- [ ] [`src/mastra-tools.ts`](../src/mastra-tools.ts)
- [ ] [`src/tools.ts`](../src/tools.ts)
- [ ] [`src/tool-guards.ts`](../src/tool-guards.ts)
- [ ] [`src/tool-output.ts`](../src/tool-output.ts)
- [ ] [`src/tool-output-format.ts`](../src/tool-output-format.ts)
- [ ] [`src/tool-output-parser.ts`](../src/tool-output-parser.ts)
- [ ] [`src/tool-summary-format.ts`](../src/tool-summary-format.ts)

## 5. RPC, task runtime, and server

- [ ] [`src/server.ts`](../src/server.ts)
- [ ] [`src/client.ts`](../src/client.ts)
- [ ] [`src/rpc-queue.ts`](../src/rpc-queue.ts)
- [ ] [`src/task-registry.ts`](../src/task-registry.ts)
- [ ] [`src/server-daemon.ts`](../src/server-daemon.ts)

## 6. CLI command surface

- [ ] [`src/cli.ts`](../src/cli.ts)
- [ ] [`src/cli-commands.ts`](../src/cli-commands.ts)
- [ ] [`src/cli-format.ts`](../src/cli-format.ts)
- [ ] [`src/cli-tool-mode.ts`](../src/cli-tool-mode.ts)
- [ ] [`src/status-format.ts`](../src/status-format.ts)

## 7. Chat/TUI UX

- [ ] [`src/chat-ui.tsx`](../src/chat-ui.tsx)
- [ ] [`src/chat-submit-handler.ts`](../src/chat-submit-handler.ts)
- [ ] [`src/chat-commands.ts`](../src/chat-commands.ts)
- [ ] [`src/chat-layout.tsx`](../src/chat-layout.tsx)
- [ ] [`src/chat-transcript.tsx`](../src/chat-transcript.tsx)
- [ ] [`src/chat-picker.tsx`](../src/chat-picker.tsx)
- [ ] [`src/ui.ts`](../src/ui.ts)

## 8. Memory, storage, and local state

- [ ] [`src/storage.ts`](../src/storage.ts)
- [ ] [`src/memory.ts`](../src/memory.ts)
- [ ] [`src/soul.ts`](../src/soul.ts)
- [ ] [`src/skills.ts`](../src/skills.ts)
- [ ] [`src/session-lock.ts`](../src/session-lock.ts)

## 9. Tests and CI/perf plumbing

- [ ] [`src/client.test.ts`](../src/client.test.ts)
- [ ] [`src/rpc-server.int.test.ts`](../src/rpc-server.int.test.ts)
- [ ] [`src/tool-guards.int.test.ts`](../src/tool-guards.int.test.ts)
- [ ] [`scripts/run-perf.ts`](../scripts/run-perf.ts)
- [ ] [`scripts/fake-provider-server.ts`](../scripts/fake-provider-server.ts)
- [ ] [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
