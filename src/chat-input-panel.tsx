import { Text } from "ink";
import type React from "react";
import { clampSuggestionIndex, useCaretBlink } from "./chat-effects";
import { borderLine, formatShortcutRows, justifyLineSpaceBetween } from "./chat-layout";
import { type PickerState, pickerHint, pickerTitle, renderPickerItems } from "./chat-picker";
import { slashCommandHelp } from "./chat-slash";
import { t } from "./i18n";
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

const SLASH_COMMAND_COLUMN_WIDTH = 16;

function resolveFooterVisible(input: { showHelp: boolean; hasSuggestions: boolean; hasPicker: boolean }): boolean {
  if (input.showHelp) return false;
  if (input.hasSuggestions) return false;
  if (input.hasPicker) return false;
  return true;
}

function renderInputPanelContent(input: {
  brandColor: string;
  atQuery: string | null;
  atSuggestions: string[];
  atSuggestionIndex: number;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
  showHelp: boolean;
}): React.ReactNode {
  const { brandColor, atQuery, atSuggestions, atSuggestionIndex, slashSuggestions, slashSuggestionIndex, showHelp } =
    input;

  let suggestions: React.ReactNode = null;
  if (atQuery !== null && atSuggestions.length > 0) {
    suggestions = atSuggestions.map((item) => (
      <Text key={`at-suggestion-${item}`} color={item === atSuggestions[atSuggestionIndex] ? brandColor : undefined}>
        {`  ${item}`}
      </Text>
    ));
  } else if (atQuery !== null) {
    suggestions = <Text dimColor> {t("chat.at_ref.no_matches")}</Text>;
  } else if (slashSuggestions.length > 0) {
    const selectedIndex = clampSuggestionIndex(slashSuggestionIndex, slashSuggestions.length);
    const selected = slashSuggestions[selectedIndex] ?? "";
    const selectedHelp = slashCommandHelp(selected);
    suggestions = (
      <>
        {slashSuggestions.map((item, index) => (
          <Text
            key={`slash-suggestion-${item}`}
            color={index === selectedIndex ? brandColor : undefined}
            dimColor={index !== selectedIndex}
          >
            {`  ${item.padEnd(SLASH_COMMAND_COLUMN_WIDTH)}`}
          </Text>
        ))}
        {selectedHelp ? <Text dimColor>{`\n  ${selectedHelp}`}</Text> : null}
      </>
    );
  } else if (showHelp) {
    suggestions = formatShortcutRows().map((line, index) => (
      <Text key={`shortcut-row-${index}`} dimColor>
        {line}
      </Text>
    ));
  }

  return suggestions;
}

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
  const caretVisible = useCaretBlink(true);
  const hasSuggestions = atQuery !== null || slashSuggestions.length > 0;
  const showFooter = resolveFooterVisible({ showHelp, hasSuggestions, hasPicker: Boolean(picker) });

  if (picker) {
    return (
      <>
        <Text dimColor>{borderLine()}</Text>
        <Text>{pickerTitle(picker, caretVisible)}</Text>
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
      <PromptInput
        value={value}
        placeholder={t("chat.input.placeholder")}
        caretVisible={caretVisible}
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
      {showFooter ? <Text dimColor>{justifyLineSpaceBetween(t("chat.input.help_hint"), footerContext, 2)}</Text> : null}
    </>
  );
}
