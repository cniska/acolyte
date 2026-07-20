---
name: dogfood
description: Drive the live Acolyte chat TUI through a real multi-turn session to catch behavior and transcript regressions. Use when verifying a change against the running app or reproducing a chat bug.
---

# Dogfood

Launch the chat TUI on current source, drive real multi-turn work through tmux, and watch for regressions the automated suites miss — completion, tool firing, and transcript order across turns. This is the structural half of dogfooding; the qualitative feel (voice, pacing) stays a manual read.

## Workflow

1. Confirm the driver: `command -v tmux`. The custom renderer needs a real PTY, and `send-keys`/`capture-pane` drive it. Stop and ask the user to install tmux via their platform's package manager if it is missing.
2. Serve current code: `bun run dogfood` restarts the daemon against source with debug logging.
3. Launch the TUI in tmux: `tmux kill-session -t dogfood 2>/dev/null; tmux new-session -d -s dogfood -x 120 -y 40; tmux send-keys -t dogfood "bun run src/cli.ts" Enter`. Cold start takes ~20s; poll `tmux capture-pane -t dogfood -p` until the `❯ Ask anything…` prompt appears.
4. Drive turns: `tmux send-keys -t dogfood "<prompt>"; tmux send-keys -t dogfood Enter`, then poll `tmux capture-pane -t dogfood -p -S -80` until the turn's `• Worked …` footer appears. Use real work across several turns, not synthetic warmups.
5. Read the transcript in the captured pane: each turn is `❯ prompt` → narration → tool rows → answer → `• Worked`, and every turn sits strictly below the previous one.
6. Watch the signals: tasks that stop without completing the work; repeated identical tool calls; excessive discovery before the first write; window drops while token budget sits idle; missing or corrupted transcript content; failures that leave no trace.
7. On surprise, capture the trace: `acolyte trace` for the latest task, or `acolyte trace task <id>`.
8. Tear down: `tmux kill-session -t dogfood; bun run src/cli.ts stop`.

## Rules

- Record a finding only when it is reproducible or trace-backed; every fix ships a regression test.
- tmux is a driver dependency, not a product one — never add it to the app's install or setup.
- The scope is structural and behavioral, not qualitative — do not conclude an answer "feels right" from a capture.

## Red flags

- Concluding a bug is fixed from `acolyte run` (single-turn) instead of a real multi-turn TUI session
- Reading a capture before the `• Worked` footer lands and calling the turn done
- Recording a one-off observation as a finding without a reproduction
- Leaving the tmux session and daemon running after the run
