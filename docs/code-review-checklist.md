# Code Review Checklist

Review in this order.

## 1. Protocol and contracts

- [x] [`src/protocol.ts`](../src/protocol.ts)
- [x] [`src/rpc-protocol.ts`](../src/rpc-protocol.ts)
- [x] [`src/api.ts`](../src/api.ts)
- [x] [`src/types.ts`](../src/types.ts) deleted
- [x] [`src/task-state.ts`](../src/task-state.ts)
- [x] [`src/tool-error-codes.ts`](../src/tool-error-codes.ts)

## 2. Config and provider behavior

- [x] [`src/config.ts`](../src/config.ts)
- [x] [`src/config-modes.ts`](../src/config-modes.ts) config-contract
- [x] [`src/app-config.ts`](../src/app-config.ts)
- [x] [`src/env.ts`](../src/env.ts)
- [x] [`src/provider-config.ts`](../src/provider-config.ts)

## 3. Lifecycle and agent policy

- [x] [`src/lifecycle.ts`](../src/lifecycle.ts) split
- [x] [`src/lifecycle-evaluators.ts`](../src/lifecycle-evaluators.ts)
- [x] [`src/lifecycle-events.ts`](../src/lifecycle-events.ts)
- [x] [`src/agent.ts`](../src/agent.ts) split
- [x] [`src/agent-modes.ts`](../src/agent-modes.ts)

## 4. Tools and guardrails

- [x] [`src/mastra-tools.ts`](../src/mastra-tools.ts) split
- [x] [`src/tools.ts`](../src/tools.ts) core-tools
- [x] [`src/tool-guards.ts`](../src/tool-guards.ts)
- [x] [`src/tool-output.ts`](../src/tool-output.ts)
- [x] [`src/tool-output-format.ts`](../src/tool-output-format.ts)
- [x] [`src/tool-output-parser.ts`](../src/tool-output-parser.ts)
- [x] [`src/tool-summary-format.ts`](../src/tool-summary-format.ts)

## 5. RPC, task runtime, and server

- [x] [`src/server.ts`](../src/server.ts) split
- [x] [`src/client.ts`](../src/client.ts) split
- [x] [`src/rpc-queue.ts`](../src/rpc-queue.ts)
- [x] [`src/task-registry.ts`](../src/task-registry.ts)
- [x] [`src/server-daemon.ts`](../src/server-daemon.ts)

## 6. CLI command surface

- [x] [`src/cli.ts`](../src/cli.ts) split
- [ ] [`src/cli-commands.ts`](../src/cli-commands.ts)
- [ ] [`src/cli-format.ts`](../src/cli-format.ts)
- [ ] [`src/cli-tool-mode.ts`](../src/cli-tool-mode.ts)
- [ ] [`src/status-format.ts`](../src/status-format.ts)

## 7. Chat/TUI UX

- [ ] [`src/chat-ui.tsx`](../src/chat-ui.tsx)
- [ ] [`src/chat-message-handler.ts`](../src/chat-message-handler.ts)
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
