import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { PromotedSliceView } from "./chat-promoted-slice";
import { type ChatAppProps, useChatState } from "./chat-state";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import { type LogLevel, log, setLogSink } from "./log";
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
    held: state.heldRowIds,
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

/** Every console method that writes output, mapped to the level it logs at. `console.*` in Bun
 *  writes straight to the file descriptor, so a method left out here still reaches the frame. */
const CONSOLE_LEVELS = {
  debug: "debug",
  dir: "debug",
  dirxml: "debug",
  error: "error",
  group: "debug",
  groupCollapsed: "debug",
  info: "info",
  log: "debug",
  table: "debug",
  timeEnd: "debug",
  timeLog: "debug",
  trace: "debug",
  warn: "warn",
} as const satisfies Record<string, LogLevel>;

type CapturedConsoleMethod = keyof typeof CONSOLE_LEVELS;

/** Route console output through the log sink for as long as the TUI owns the terminal. A
 *  dependency that writes a diagnostic — React prints its nested-update warning this way —
 *  otherwise lands mid-frame and shifts the cursor the renderer is tracking. Returns the
 *  restore for the caller's teardown. */
function captureConsole(): () => void {
  // The per-method signatures (`dir`, `table`) differ, and every capture takes the same shape.
  const target = console as unknown as Record<CapturedConsoleMethod, (...args: unknown[]) => void>;
  const originals = new Map<CapturedConsoleMethod, (...args: unknown[]) => void>();
  for (const method of Object.keys(CONSOLE_LEVELS) as CapturedConsoleMethod[]) {
    originals.set(method, target[method]);
    target[method] = (...args: unknown[]): void => {
      // Newlines collapse so a component stack stays one logfmt record.
      const message = args
        .map(String)
        .join(" ")
        .replace(/\s*\n\s*/g, " ");
      log[CONSOLE_LEVELS[method]](message, { source: `console.${method}` });
    };
  }
  return () => {
    for (const [method, original] of originals) target[method] = original;
  };
}

export function installClientLogSink(): () => void {
  // The TUI owns stdout exclusively, so a sink is always installed to keep logs
  // off the frame; it writes to client.log under ACOLYTE_DEBUG, else swallows.
  const logPath = process.env.ACOLYTE_DEBUG ? join(stateDir(), "client.log") : null;
  setLogSink(
    logPath === null
      ? () => {}
      : (line) => {
          try {
            appendFileSync(logPath, line);
          } catch {
            // best-effort
          }
        },
  );
  return captureConsole();
}

export async function runChat(
  props: ChatAppProps,
  onMount?: (app: { flush: () => void; unmount: () => void }) => void,
  onFatalError?: (error: unknown) => void,
): Promise<void> {
  const restoreConsole = installClientLogSink();
  const app = render(<ChatApp {...props} />, { onFatalError });
  try {
    onMount?.(app);
    await app.waitUntilExit();
    // Release before persisting: the daemon cancels this connection's tasks on close, and
    // a stalled disk write must not hold a cancelled turn open.
    props.client.close();
    // The last turn's turn-boundary persist ran before its transcript row
    // committed; catch it up here. Signal/fatal exits process.exit before this
    // resumes, so it stays clean-exit-only.
    await props.persist();
  } finally {
    // Idempotent; repeated here so a throw above still releases the connection.
    props.client.close();
    restoreConsole();
    setLogSink(null);
  }
}
