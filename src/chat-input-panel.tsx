import { Box, Text } from "ink";
import type React from "react";
import { renderInputPanelContent } from "./chat-input-panel-content";
import { borderLine, justifyLineSpaceBetween } from "./chat-layout";
import { PICKER_LABEL_WIDTH, type PickerState, pickerHint, pickerTitle, renderPickerItems } from "./chat-picker";
import { PromptInput } from "./prompt-input";

type ChatInputPanelProps = {
  picker?: PickerState | null;
  activeSessionId?: string | undefined;
  brandColor?: string;
  footerContext?: string;
  value?: string;
  inputRevision?: number;
  onChange?: (next: string) => void;
  onSubmit?: (next: string) => void;
  atQuery?: string | null;
  atSuggestions?: string[];
  atSuggestionIndex?: number;
  slashSuggestions?: string[];
  slashSuggestionIndex?: number;
  showHelp?: boolean;
};

const noop = (): void => {};

export function ChatInputPanel(props: ChatInputPanelProps): React.ReactNode {
  const {
    picker = null,
    activeSessionId,
    brandColor = "white",
    footerContext = "",
    value = "",
    inputRevision = 0,
    onChange = noop,
    onSubmit = noop,
    atQuery = null,
    atSuggestions = [],
    atSuggestionIndex = 0,
    slashSuggestions = [],
    slashSuggestionIndex = 0,
    showHelp = false,
  } = props;

  if (picker && picker.kind !== "writeConfirm") {
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

  if (picker?.kind === "writeConfirm") {
    return (
      <>
        <Text dimColor>{borderLine()}</Text>
        <Text>{pickerTitle(picker)}</Text>
        <Text> </Text>
        {picker.items.map((item, index) => {
          const selected = index === picker.index;
          return (
            <Box key={item.value}>
              <Text>{selected ? "› " : "  "}</Text>
              <Text color={selected ? brandColor : undefined}>{item.value.padEnd(PICKER_LABEL_WIDTH, " ")}</Text>
              <Text> </Text>
              <Text dimColor>{item.description}</Text>
            </Box>
          );
        })}
        <Text> </Text>
        <Text dimColor>{pickerHint(picker)}</Text>
        <Text dimColor>{borderLine()}</Text>
      </>
    );
  }

  return (
    <>
      <Text dimColor>{borderLine()}</Text>
      <PromptInput
        value={value}
        placeholder="Ask anything…"
        linePrefixFirst="❯ "
        linePrefixRest="  "
        onChange={onChange}
        onSubmit={onSubmit}
        key={`chat-input-${inputRevision}`}
      />
      <Text dimColor>{borderLine()}</Text>
      {renderInputPanelContent({
        brandColor,
        atQuery,
        atSuggestions,
        atSuggestionIndex,
        slashSuggestions,
        slashSuggestionIndex,
        showHelp,
      })}
      {!showHelp ? <Text dimColor>{justifyLineSpaceBetween("? help", footerContext, 2)}</Text> : null}
    </>
  );
}
