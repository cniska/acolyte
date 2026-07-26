---
name: dogfood
description: Drive the live Acolyte chat TUI through a real multi-turn session to catch behavior and transcript regressions. Use when verifying a change against the running app or reproducing a chat bug.
---

# Dogfood

Launch the chat TUI on current source, drive real multi-turn work through tmux, and watch for regressions the automated suites miss — completion, tool firing, and transcript order across turns. This is the structural half of dogfooding; the qualitative feel (voice, pacing) stays a manual read.

## Workflow

1. Isolate the run in a dedicated worktree before starting anything. Create a unique branch/worktree (for example, `wt dogfood-<topic>`), enter it, and use a matching unique tmux session name. Never dogfood from the primary checkout or reuse another worktree's tmux session.
2. Allocate a free port, then set it in the dogfood worktree only: `bun run src/cli.ts config set --project port <port>`. Use fresh temporary `XDG_DATA_HOME` and `XDG_STATE_HOME` roots for every command in this run. Keep `XDG_CONFIG_HOME` unset so existing provider credentials remain readable. This isolates the daemon PID, logs, sessions, traces, cache, and port without modifying the primary worktree or its daemon.
3. Confirm the driver: `command -v tmux`. The custom renderer needs a real PTY, and `send-keys`/`capture-pane` drive it. Stop and ask the user to install tmux via their platform's package manager if it is missing.
4. Launch the TUI from the dogfood worktree in tmux, with the isolated roots: `tmux kill-session -t <session> 2>/dev/null; tmux new-session -d -s <session> -x 120 -y 40; tmux send-keys -t <session> "XDG_DATA_HOME=<data-root> XDG_STATE_HOME=<state-root> bun run dogfood" Enter`. `bun run dogfood` stops only the isolated daemon, then starts current source with debug logging. Cold start takes ~20s; poll `tmux capture-pane -t <session> -p` until the `❯ Ask anything…` prompt appears.
5. Drive turns: `tmux send-keys -t <session> "<prompt>"; tmux send-keys -t <session> Enter`, then poll `tmux capture-pane -t <session> -p -S -80` until the turn's `• Worked …` footer appears. Use real work across several turns, not synthetic warmups.
6. Read the transcript in the captured pane: each turn is `❯ prompt` → narration → tool rows → answer → `• Worked`, and every turn sits strictly below the previous one.
7. Watch the signals: tasks that stop without completing the work; repeated identical tool calls; excessive discovery before the first write; window drops while token budget sits idle; missing or corrupted transcript content; failures that leave no trace.
8. On surprise, capture the trace with the same XDG roots: `XDG_DATA_HOME=<data-root> XDG_STATE_HOME=<state-root> bun run src/cli.ts trace` for the latest task, or `XDG_DATA_HOME=<data-root> XDG_STATE_HOME=<state-root> bun run src/cli.ts trace task <id>`.
9. Tear down with the same XDG roots: `tmux kill-session -t <session>; XDG_DATA_HOME=<data-root> XDG_STATE_HOME=<state-root> bun run src/cli.ts stop`. Remove the temporary roots only after capturing any needed trace.

## Rules

- Record a finding only when it is reproducible or trace-backed; every fix ships a regression test.
- tmux is a driver dependency, not a product one — never add it to the app's install or setup.
- The scope is structural and behavioral, not qualitative — do not conclude an answer "feels right" from a capture.
- Keep the dogfood worktree until its finding is resolved or explicitly discarded; remove it only after teardown.

## Red flags

- Concluding a bug is fixed from `acolyte run` (single-turn) instead of a real multi-turn TUI session
- Reading a capture before the `• Worked` footer lands and calling the turn done
- Recording a one-off observation as a finding without a reproduction
- Leaving the tmux session and daemon running after the run
- Starting or stopping a dogfood daemon from the primary checkout
