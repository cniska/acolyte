import { Box, Text } from "ink";
import React from "react";
import { borderLine, formatShortcutRows } from "./chat-layout";
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

      {atQuery !== null && atSuggestions.length > 0 ? (
        <>
          {atSuggestions.map((item) => (
            <Text
              key={`at-suggestion-${item}`}
              color={item === atSuggestions[atSuggestionIndex] ? brandColor : undefined}
            >{`  ${item}`}</Text>
          ))}
        </>
      ) : atQuery !== null ? (
        <Text dimColor> No file or folder matches.</Text>
      ) : slashSuggestions.length > 0 ? (
        <>
          {slashSuggestions.map((item, index) => (
            <Text
              key={`slash-suggestion-${item}`}
              color={index === slashSuggestionIndex ? brandColor : undefined}
              dimColor={index !== slashSuggestionIndex}
            >{`  ${item}`}</Text>
          ))}
        </>
      ) : showShortcuts ? (
        <>
          {formatShortcutRows().map((line, index) => (
            <Text key={`shortcut-row-${index}`} dimColor>
              {line}
            </Text>
          ))}
        </>
      ) : (
        <Text dimColor> ? for shortcuts</Text>
      )}
      {queuedInput ? <Text dimColor>{` queued: ${queuedInput}`}</Text> : null}
    </>
  );
}
