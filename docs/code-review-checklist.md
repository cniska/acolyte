# Code Review Checklist

Review in this order.

## 1. Protocol and contracts

- [x] [`src/protocol.ts`](../src/protocol.ts)
- [x] [`src/rpc-protocol.ts`](../src/rpc-protocol.ts)
- [x] [`src/api.ts`](../src/api.ts)
- [x] [`src/id-contract.ts`](../src/id-contract.ts)
- [x] [`src/stream-error.ts`](../src/stream-error.ts)
- [x] [`src/tool-error-codes.ts`](../src/tool-error-codes.ts)
- [x] [`src/tool-contract.ts`](../src/tool-contract.ts)
- [x] [`src/agent-contract.ts`](../src/agent-contract.ts)
- [x] [`src/provider-contract.ts`](../src/provider-contract.ts)
- [x] [`src/error-handling.ts`](../src/error-handling.ts)
- [x] [`src/error-messages.ts`](../src/error-messages.ts)

## 2. Config and provider behavior

- [x] [`src/config.ts`](../src/config.ts)
- [x] [`src/config-contract.ts`](../src/config-contract.ts)
- [x] [`src/app-config.ts`](../src/app-config.ts)
- [x] [`src/env.ts`](../src/env.ts)
- [x] [`src/debug-flags.ts`](../src/debug-flags.ts)
- [x] [`src/provider-config.ts`](../src/provider-config.ts)
- [x] [`src/model-factory.ts`](../src/model-factory.ts)

## 3. Lifecycle and agent policy

- [x] [`src/lifecycle.ts`](../src/lifecycle.ts)
- [x] [`src/lifecycle-contract.ts`](../src/lifecycle-contract.ts)
- [x] [`src/lifecycle-classify.ts`](../src/lifecycle-classify.ts)
- [x] [`src/lifecycle-constants.ts`](../src/lifecycle-constants.ts)
- [x] [`src/lifecycle-evaluate.ts`](../src/lifecycle-evaluate.ts)
- [x] [`src/lifecycle-evaluators.ts`](../src/lifecycle-evaluators.ts)
- [x] [`src/lifecycle-events.ts`](../src/lifecycle-events.ts)
- [x] [`src/lifecycle-finalize.ts`](../src/lifecycle-finalize.ts)
- [x] [`src/lifecycle-generate.ts`](../src/lifecycle-generate.ts)
- [x] [`src/lifecycle-policy.ts`](../src/lifecycle-policy.ts)
- [x] [`src/lifecycle-prepare.ts`](../src/lifecycle-prepare.ts)
- [x] [`src/agent-modes.ts`](../src/agent-modes.ts)
- [x] [`src/agent-stream.ts`](../src/agent-stream.ts)
- [x] [`src/agent-factory.ts`](../src/agent-factory.ts)
- [x] [`src/agent-instructions.ts`](../src/agent-instructions.ts)
- [x] [`src/agent-input.ts`](../src/agent-input.ts)
- [x] [`src/agent-model.ts`](../src/agent-model.ts)
- [x] [`src/agent-output.ts`](../src/agent-output.ts)

## 4. Tools and guardrails

- [x] [`src/tool-registry.ts`](../src/tool-registry.ts)
- [x] [`src/core-toolkit.ts`](../src/core-toolkit.ts)
- [x] [`src/git-toolkit.ts`](../src/git-toolkit.ts)
- [x] [`src/core-tools.ts`](../src/core-tools.ts)
- [x] [`src/tool-guards.ts`](../src/tool-guards.ts)
- [x] [`src/tool-groups.ts`](../src/tool-groups.ts)
- [x] [`src/tool-arg-paths.ts`](../src/tool-arg-paths.ts)
- [x] [`src/tool-execution.ts`](../src/tool-execution.ts)
- [x] [`src/tool-output.ts`](../src/tool-output.ts)
- [x] [`src/tool-output-content.ts`](../src/tool-output-content.ts)
- [x] [`src/tool-output-format.ts`](../src/tool-output-format.ts)

## 5. RPC, task runtime, and server

- [x] [`src/server.ts`](../src/server.ts)
- [x] [`src/server-app.ts`](../src/server-app.ts)
- [x] [`src/server-contract.ts`](../src/server-contract.ts)
- [x] [`src/server-http.ts`](../src/server-http.ts)
- [x] [`src/server-rpc.ts`](../src/server-rpc.ts)
- [x] [`src/server-chat-runtime.ts`](../src/server-chat-runtime.ts)
- [x] [`src/server-daemon.ts`](../src/server-daemon.ts)
- [x] [`src/client.ts`](../src/client.ts)
- [x] [`src/client-contract.ts`](../src/client-contract.ts)
- [x] [`src/client-rpc.ts`](../src/client-rpc.ts)
- [x] [`src/rpc-queue.ts`](../src/rpc-queue.ts)
- [x] [`src/task-registry.ts`](../src/task-registry.ts)
- [x] [`src/task-contract.ts`](../src/task-contract.ts)
- [x] [`src/task-store.ts`](../src/task-store.ts)
- [ ] [`src/task-queue.ts`](../src/task-queue.ts)
- [x] [`src/network-host.ts`](../src/network-host.ts)
- [x] [`src/wait-server.ts`](../src/wait-server.ts)

## 6. CLI command surface

- [x] [`src/cli.ts`](../src/cli.ts)
- [x] [`src/cli-chat.ts`](../src/cli-chat.ts)
- [x] [`src/cli-command-registry.ts`](../src/cli-command-registry.ts)
- [x] [`src/cli-command-suggest.ts`](../src/cli-command-suggest.ts)
- [x] [`src/cli-commands.ts`](../src/cli-commands.ts)
- [x] [`src/cli-config.ts`](../src/cli-config.ts)
- [x] [`src/cli-contract.ts`](../src/cli-contract.ts)
- [x] [`src/cli-format.ts`](../src/cli-format.ts)
- [x] [`src/cli-help.ts`](../src/cli-help.ts)
- [x] [`src/cli-history.ts`](../src/cli-history.ts)
- [x] [`src/cli-init.ts`](../src/cli-init.ts)
- [x] [`src/cli-memory.ts`](../src/cli-memory.ts)
- [x] [`src/cli-prompt.ts`](../src/cli-prompt.ts)
- [x] [`src/cli-run.ts`](../src/cli-run.ts)
- [x] [`src/cli-serve.ts`](../src/cli-serve.ts)
- [x] [`src/cli-server.ts`](../src/cli-server.ts)
- [x] [`src/cli-status.ts`](../src/cli-status.ts)
- [x] [`src/cli-stream-output.ts`](../src/cli-stream-output.ts)
- [x] [`src/cli-tool-mode.ts`](../src/cli-tool-mode.ts)
- [x] [`src/cli-version.ts`](../src/cli-version.ts)
- [x] [`src/status-contract.ts`](../src/status-contract.ts)
- [x] [`src/status-format.ts`](../src/status-format.ts)

## 7. Chat/TUI UX

- [ ] [`src/chat-ui.tsx`](../src/chat-ui.tsx)
- [ ] [`src/chat-message-handler.ts`](../src/chat-message-handler.ts)
- [ ] [`src/chat-message-handler-helpers.ts`](../src/chat-message-handler-helpers.ts)
- [ ] [`src/chat-message-handler-stream.ts`](../src/chat-message-handler-stream.ts)
- [ ] [`src/chat-message-handler-task-followup.ts`](../src/chat-message-handler-task-followup.ts)
- [ ] [`src/chat-commands.ts`](../src/chat-commands.ts)
- [ ] [`src/chat-content.ts`](../src/chat-content.ts)
- [ ] [`src/chat-content-render.tsx`](../src/chat-content-render.tsx)
- [ ] [`src/chat-effects.ts`](../src/chat-effects.ts)
- [ ] [`src/chat-file-ref.ts`](../src/chat-file-ref.ts)
- [ ] [`src/chat-format.ts`](../src/chat-format.ts)
- [ ] [`src/chat-header.tsx`](../src/chat-header.tsx)
- [ ] [`src/chat-input-handlers.ts`](../src/chat-input-handlers.ts)
- [ ] [`src/chat-input-panel.tsx`](../src/chat-input-panel.tsx)
- [ ] [`src/chat-input-panel-content.tsx`](../src/chat-input-panel-content.tsx)
- [ ] [`src/chat-keybindings.ts`](../src/chat-keybindings.ts)
- [ ] [`src/chat-layout.tsx`](../src/chat-layout.tsx)
- [ ] [`src/chat-message.ts`](../src/chat-message.ts)
- [ ] [`src/chat-picker.tsx`](../src/chat-picker.tsx)
- [ ] [`src/chat-picker-actions.ts`](../src/chat-picker-actions.ts)
- [ ] [`src/chat-picker-handlers.ts`](../src/chat-picker-handlers.ts)
- [ ] [`src/chat-session.ts`](../src/chat-session.ts)
- [ ] [`src/chat-slash.ts`](../src/chat-slash.ts)
- [ ] [`src/chat-submit.ts`](../src/chat-submit.ts)
- [ ] [`src/chat-transcript.tsx`](../src/chat-transcript.tsx)
- [ ] [`src/chat-turn.ts`](../src/chat-turn.ts)
- [ ] [`src/ui.ts`](../src/ui.ts)
- [ ] [`src/prompt-input.tsx`](../src/prompt-input.tsx)
- [ ] [`src/prompt-keymap.ts`](../src/prompt-keymap.ts)
- [ ] [`src/palette.ts`](../src/palette.ts)

## 8. Memory, storage, and local state

- [ ] [`src/storage.ts`](../src/storage.ts)
- [ ] [`src/memory.ts`](../src/memory.ts)
- [ ] [`src/memory-contract.ts`](../src/memory-contract.ts)
- [ ] [`src/memory-registry.ts`](../src/memory-registry.ts)
- [ ] [`src/memory-source-stored.ts`](../src/memory-source-stored.ts)
- [ ] [`src/memory-source-distill.ts`](../src/memory-source-distill.ts)
- [ ] [`src/memory-distill-store.ts`](../src/memory-distill-store.ts)
- [ ] [`src/memory-distill-prompts.ts`](../src/memory-distill-prompts.ts)
- [ ] [`src/memory-pipeline.ts`](../src/memory-pipeline.ts)
- [ ] [`src/soul.ts`](../src/soul.ts)
- [ ] [`src/skills.ts`](../src/skills.ts)
- [ ] [`src/file-context.ts`](../src/file-context.ts)
- [ ] [`src/session-contract.ts`](../src/session-contract.ts)
- [ ] [`src/session-lock.ts`](../src/session-lock.ts)
- [ ] [`src/session-store.ts`](../src/session-store.ts)
- [ ] [`src/resource-diagnostics.ts`](../src/resource-diagnostics.ts)
- [ ] [`src/resource-id.ts`](../src/resource-id.ts)

## 9. Shared utilities

- [ ] [`src/assert.ts`](../src/assert.ts)
- [ ] [`src/compact-text.ts`](../src/compact-text.ts)
- [ ] [`src/datetime.ts`](../src/datetime.ts)
- [ ] [`src/i18n.ts`](../src/i18n.ts)
- [ ] [`src/log.ts`](../src/log.ts)
- [ ] [`src/short-id.ts`](../src/short-id.ts)

## 10. Tests, CI, and scripts

### Unit tests

- [ ] [`src/client.test.ts`](../src/client.test.ts)

### Integration tests

- [ ] [`src/server-rpc.int.test.ts`](../src/server-rpc.int.test.ts)
- [ ] [`src/server-daemon.int.test.ts`](../src/server-daemon.int.test.ts)
- [ ] [`src/tool-guards.int.test.ts`](../src/tool-guards.int.test.ts)
- [ ] [`src/chat-message-handler.int.test.ts`](../src/chat-message-handler.int.test.ts)
- [ ] [`src/chat-message-handler-stream.int.test.ts`](../src/chat-message-handler-stream.int.test.ts)
- [ ] [`src/chat-ui.int.test.ts`](../src/chat-ui.int.test.ts)
- [ ] [`src/cli-init.int.test.ts`](../src/cli-init.int.test.ts)
- [ ] [`src/cli-subcommand-help.int.test.ts`](../src/cli-subcommand-help.int.test.ts)
- [ ] [`src/cli-visual.int.test.ts`](../src/cli-visual.int.test.ts)

### Test utilities

- [ ] [`src/int-test-utils.ts`](../src/int-test-utils.ts)
- [ ] [`src/tui-test-utils.ts`](../src/tui-test-utils.ts)

### Performance and benchmarks

- [ ] [`scripts/benchmark.ts`](../scripts/benchmark.ts)
- [ ] [`scripts/run-perf.ts`](../scripts/run-perf.ts)
- [ ] [`scripts/perf-scenarios.ts`](../scripts/perf-scenarios.ts)
- [ ] [`scripts/perf-utils.ts`](../scripts/perf-utils.ts)
- [ ] [`scripts/perf-test-utils.ts`](../scripts/perf-test-utils.ts)

### Scripts and tools

- [ ] [`scripts/run-unit-tests.ts`](../scripts/run-unit-tests.ts)
- [ ] [`scripts/run-unit-coverage.ts`](../scripts/run-unit-coverage.ts)
- [ ] [`scripts/fake-provider-server.ts`](../scripts/fake-provider-server.ts)
- [ ] [`scripts/lifecycle-trace.ts`](../scripts/lifecycle-trace.ts)
- [ ] [`scripts/om-admin.ts`](../scripts/om-admin.ts)
- [ ] [`scripts/om-soak.ts`](../scripts/om-soak.ts)
- [ ] [`scripts/codemod-single-line-if.ts`](../scripts/codemod-single-line-if.ts)

### CI workflows

- [ ] [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
- [ ] [`.github/workflows/release.yml`](../.github/workflows/release.yml)
