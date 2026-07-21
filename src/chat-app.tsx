import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { ChatChecklist } from "./chat-checklist";
import type { ChatRow } from "./chat-contract";
import { isChecklistOutput } from "./chat-contract";
import { ChatHeader } from "./chat-header";
import { ChatInputPanel } from "./chat-input-panel";
import { isHeaderItem } from "./chat-promotion";
import { type ChatAppProps, useChatState } from "./chat-state";
import { ChatTranscript, ChatTranscriptRow } from "./chat-transcript";
import { setLogSink } from "./log";
import { palette } from "./palette";
import { stateDir } from "./paths";
import { Box, render, Static, Text, useApp } from "./tui";
import { DEFAULT_COLUMNS } from "./tui/constants";

function ChatApp(props: ChatAppProps) {
  const { exit } = useApp();
  const state = useChatState(props, exit);

  const transcriptRows: ChatRow[] = [];
  const checklistRows: ChatRow[] = [];
  for (const row of state.rows) {
    (isChecklistOutput(row.content) ? checklistRows : transcriptRows).push(row);
  }

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
          const columns = process.stdout.columns ?? DEFAULT_COLUMNS;
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
      <ChatTranscript
        rows={transcriptRows}
        presentation={state.transcriptPresentation}
        pendingState={state.pendingState}
        pendingFrame={state.pendingFrame}
        pendingStartedAt={state.pendingStartedAt}
        queuedMessages={state.queuedMessages}
        runningUsage={state.runningUsage}
      />
      <ChatChecklist rows={checklistRows} presentation={state.transcriptPresentation} />

      <Text> </Text>
      <ChatInputPanel
        picker={state.picker}
        onPickerQueryChange={state.handlePickerQueryChange}
        onPickerSubmit={state.handlePickerSubmit}
        activeSessionId={state.activeSessionId}
        brandColor={palette.brand}
        statusLine={state.statusLine}
        value={state.value}
        cursor={state.cursor}
        onAction={state.handleInputAction}
        onSubmit={state.handleInputSubmit}
        atQuery={state.atQuery}
        atSuggestions={state.atSuggestions}
        atSuggestionIndex={state.atSuggestionIndex}
        slashSuggestions={state.slashSuggestions}
        slashSuggestionIndex={state.slashSuggestionIndex}
        showHelp={state.showHelp}
        ctrlCPending={state.ctrlCPending}
        onCursorLine={state.onCursorLine}
      />
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
