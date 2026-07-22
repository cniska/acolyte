import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { ChatHeader } from "./chat-header";
import { isHeaderItem } from "./chat-promotion";
import { type ChatAppProps, useChatState } from "./chat-state";
import { ChatTranscriptRow } from "./chat-transcript";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import { setLogSink } from "./log";
import { palette } from "./palette";
import { stateDir } from "./paths";
import { PromptInputHandler } from "./prompt-input";
import { layoutChatViewport } from "./terminal-chat-layout";
import { terminalTheme } from "./terminal-theme";
import { Box, render, Static, TerminalSceneViewport, Text, useApp } from "./tui";
import { DEFAULT_COLUMNS } from "./tui/constants";

const noop = (): void => {};

function ChatApp(props: ChatAppProps) {
  const { exit } = useApp();
  const state = useChatState(props, exit);

  const columns = process.stdout.columns ?? DEFAULT_COLUMNS;
  const constraints = { columns, rows: process.stdout.rows ?? 40 };
  const scene = layoutChatViewport({
    presentation: createChatViewportPresentation(state.presentationInput),
    constraints,
    theme: terminalTheme,
    now: Date.now(),
  });
  const liveLineStart = scene.sections?.find((section) => section.id === "header")?.lineEnd ?? 0;

  return (
    <Box flexDirection="column">
      <Static items={state.promotedRows}>
        {(item) => {
          if (isHeaderItem(item)) {
            return (
              <Box key={item.id} flexDirection="column">
                <Text> </Text>
                <ChatHeader
                  lines={item.lines}
                  brandColor={palette.brand}
                  mascot={palette.mascot}
                  mascotEyes={palette.mascotEyes}
                />
              </Box>
            );
          }
          const contentWidth = Math.max(24, columns - 2);
          return (
            <Box key={item.id} flexDirection="column">
              <Text> </Text>
              <ChatTranscriptRow
                row={item}
                contentWidth={contentWidth}
                toolContentWidth={contentWidth}
                presentation={state.transcriptPresentation.find((row) => row.id === item.id)}
              />
            </Box>
          );
        }}
      </Static>
      <TerminalSceneViewport scene={scene} constraints={constraints} liveLineStart={liveLineStart} />
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
          wrapWidth={Math.max(24, columns) - 2}
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
