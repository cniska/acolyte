import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { PromotedSliceView } from "./chat-promoted-slice";
import { type ChatAppProps, useChatState } from "./chat-state";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import { setLogSink } from "./log";
import { stateDir } from "./paths";
import { PromptInputHandler } from "./prompt-input";
import { layoutChatViewport, promptWrapWidth } from "./terminal-chat-layout";
import { terminalTheme } from "./terminal-theme";
import { Box, render, Static, TerminalSceneViewport, useApp } from "./tui";
import { DEFAULT_COLUMNS, DEFAULT_ROWS } from "./tui/constants";
import { useSyncEffect } from "./tui/effects";
import { planScenePromotion } from "./tui/scene-viewport";

const noop = (): void => {};

function ChatApp(props: ChatAppProps) {
  const { exit } = useApp();
  const state = useChatState(props, exit);

  const columns = process.stdout.columns ?? DEFAULT_COLUMNS;
  const constraints = { columns, rows: process.stdout.rows ?? DEFAULT_ROWS };
  const scene = layoutChatViewport({
    presentation: createChatViewportPresentation(state.presentationInput),
    constraints,
    theme: terminalTheme,
    now: Date.now(),
  });
  const promotedIds = new Set(state.promotedSlices.map((slice) => slice.id));
  const plan = planScenePromotion(scene, constraints, promotedIds);

  // Freeze the newly-committed slices and evict their rows in the same commit that renders
  // the live tail from the snapped boundary, so a scrolled-off row never renders twice.
  useSyncEffect(() => {
    state.commitPromotion(plan.slices, plan.committedSectionIds);
  }, [plan.committedSectionIds.join(","), plan.slices.length]);

  const scrollback = [...state.promotedSlices, ...plan.slices];

  return (
    <Box flexDirection="column">
      <Static items={scrollback}>{(slice) => <PromotedSliceView slice={slice} />}</Static>
      <TerminalSceneViewport scene={scene} constraints={constraints} liveLineStart={plan.liveLineStart} />
      {state.picker ? (
        state.picker.kind === "model" ? (
          <PromptInputHandler
            value={state.picker.input.text}
            cursor={state.picker.input.cursor}
            onAction={state.handlePickerAction}
            onSubmit={state.handlePickerSubmit}
            onCursorLine={noop}
          />
        ) : null
      ) : (
        <PromptInputHandler
          value={state.value}
          cursor={state.cursor}
          onAction={state.handleInputAction}
          onSubmit={state.handleInputSubmit}
          onCursorLine={state.onCursorLine}
          wrapWidth={promptWrapWidth(columns)}
        />
      )}
    </Box>
  );
}

export function installClientLogSink(): void {
  // The TUI owns stdout exclusively, so a sink is always installed to keep logs
  // off the frame; it writes to client.log under ACOLYTE_DEBUG, else swallows.
  if (!process.env.ACOLYTE_DEBUG) {
    setLogSink(() => {});
    return;
  }
  const logPath = join(stateDir(), "client.log");
  setLogSink((line) => {
    try {
      appendFileSync(logPath, line);
    } catch {
      // best-effort
    }
  });
}

export async function runChat(
  props: ChatAppProps,
  onMount?: (app: { flush: () => void; unmount: () => void }) => void,
  onFatalError?: (error: unknown) => void,
): Promise<void> {
  installClientLogSink();
  const app = render(<ChatApp {...props} />, { onFatalError });
  try {
    onMount?.(app);
    await app.waitUntilExit();
    // The last turn's turn-boundary persist ran before its transcript row
    // committed; catch it up here. Signal/fatal exits process.exit before this
    // resumes, so it stays clean-exit-only.
    await props.persist();
  } finally {
    setLogSink(null);
  }
}
