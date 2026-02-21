import { Box, Text } from "ink";
import React from "react";
import { renderInputPanelContent } from "./chat-input-panel-content";
import { borderLine } from "./chat-layout";
import { type PickerState, pickerHint, pickerTitle, renderPickerItems } from "./chat-picker";
import { PromptInput } from "./prompt-input";

type ChatInputPanelProps = {
  picker: PickerState | null;
  activeSessionId: string | undefined;
  brandColor: string;
  value: string;
  inputRevision: number;
  onChange: (next: string) => void;
  onSubmit: (next: string) => void;
  atQuery: string | null;
  atSuggestions: string[];
  atSuggestionIndex: number;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
  showShortcuts: boolean;
  queuedInput: string | null;
};

export function ChatInputPanel(props: ChatInputPanelProps): React.ReactNode {
  const {
    picker,
    activeSessionId,
    brandColor,
    value,
    inputRevision,
    onChange,
    onSubmit,
    atQuery,
    atSuggestions,
    atSuggestionIndex,
    slashSuggestions,
    slashSuggestionIndex,
    showShortcuts,
    queuedInput,
  } = props;

  if (picker) {
    return (
      <>
        <Text dimColor>{borderLine()}</Text>
        <Text>{pickerTitle(picker)}</Text>
        <Text> </Text>
        {renderPickerItems(picker, activeSessionId, brandColor)}
        <Text> </Text>
        <Text dimColor>{pickerHint(picker)}</Text>
        <Text dimColor>{borderLine()}</Text>
      </>
    );
  }

  return (
    <>
      <Text dimColor>{borderLine()}</Text>
      <Box>
        <Text>❯ </Text>
        <PromptInput
          value={value}
          placeholder="Ask something…"
          onChange={onChange}
          onSubmit={onSubmit}
          key={`chat-input-${inputRevision}`}
        />
      </Box>
      <Text dimColor>{borderLine()}</Text>
      {renderInputPanelContent({
        brandColor,
        atQuery,
        atSuggestions,
        atSuggestionIndex,
        slashSuggestions,
        slashSuggestionIndex,
        showShortcuts,
        queuedInput,
      })}
    </>
  );
}
