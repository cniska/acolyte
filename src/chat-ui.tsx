import { isHeaderItem } from "./chat-graduation";
import { ChatHeader } from "./chat-header";
import { ChatInputPanel } from "./chat-input-panel";
import { type ChatAppProps, useChatState } from "./chat-state";
import { ChatTranscript, ChatTranscriptRow } from "./chat-transcript";
import { palette } from "./palette";
import { Box, render, Static, Text, useApp } from "./tui";

function ChatApp(props: ChatAppProps) {
  const { exit } = useApp();
  const state = useChatState(props, exit);

  return (
    <Box flexDirection="column">
      <Static items={state.graduatedRows}>
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
          const columns = process.stdout.columns ?? 120;
          const contentWidth = Math.max(24, Math.min(120, columns - 2));
          const toolContentWidth = Math.max(24, columns - 2);
          return (
            <Box key={item.id} flexDirection="column">
              <Text> </Text>
              <ChatTranscriptRow row={item} contentWidth={contentWidth} toolContentWidth={toolContentWidth} />
            </Box>
          );
        }}
      </Static>
      <ChatTranscript
        rows={state.rows}
        pendingState={state.pendingState}
        thinkingFrame={state.thinkingFrame}
        thinkingStartedAt={state.thinkingStartedAt}
        queuedMessages={state.queuedMessages}
        runningUsage={state.runningUsage}
      />

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
      />
    </Box>
  );
}

export async function runChat(props: ChatAppProps): Promise<void> {
  const app = render(<ChatApp {...props} />);
  await app.waitUntilExit();
}
