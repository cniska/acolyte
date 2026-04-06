import { ChatChecklist } from "./chat-checklist";
import type { ChatRow } from "./chat-contract";
import { isChecklistOutput } from "./chat-contract";
import { ChatHeader } from "./chat-header";
import { ChatInputPanel } from "./chat-input-panel";
import { isHeaderItem } from "./chat-promotion";
import { type ChatAppProps, useChatState } from "./chat-state";
import { ChatTranscript, ChatTranscriptRow } from "./chat-transcript";
import { palette } from "./palette";
import { Box, render, Static, Text, useApp } from "./tui";
import { DEFAULT_COLUMNS } from "./tui/styles";

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
              <ChatTranscriptRow row={item} contentWidth={contentWidth} toolContentWidth={contentWidth} />
            </Box>
          );
        }}
      </Static>
      <ChatTranscript
        rows={transcriptRows}
        pendingState={state.pendingState}
        pendingFrame={state.pendingFrame}
        pendingStartedAt={state.pendingStartedAt}
        queuedMessages={state.queuedMessages}
        runningUsage={state.runningUsage}
      />
      <ChatChecklist rows={checklistRows} />

      <Text> </Text>
      <ChatInputPanel
        picker={state.picker}
        onPickerQueryChange={state.handlePickerQueryChange}
        onPickerSubmit={state.handlePickerSubmit}
        activeSessionId={state.activeSessionId}
        brandColor={palette.brand}
        footerContext={state.footerContext}
        value={state.value}
        inputRevision={state.inputRevision}
        onChange={state.handleInputChange}
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

export async function runChat(props: ChatAppProps): Promise<void> {
  const app = render(<ChatApp {...props} />);
  await app.waitUntilExit();
}
