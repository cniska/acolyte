import type React from "react";
import { clampSuggestionIndex } from "./chat-effects";
import { borderLine, formatShortcutRows } from "./chat-layout";
import { type PickerState, pickerHint, pickerLabel, renderPickerItems } from "./chat-picker";
import { slashCommandHelp } from "./chat-slash";
import { t } from "./i18n";
import { PromptInput } from "./prompt-input";
import { Box, Text } from "./tui";

type ChatInputPanelProps = {
  picker?: PickerState | null;
  onPickerQueryChange?: (query: string) => void;
  onPickerSubmit?: () => void;
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
  ctrlCPending?: boolean;
};

const noop = (): void => {};

const SLASH_COMMAND_COLUMN_WIDTH = 16;

const DEFAULT_TERMINAL_WIDTH = 96;

function resolveFooterVisible(input: { hasSuggestions: boolean; hasPicker: boolean }): boolean {
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
    suggestions = formatShortcutRows().map((line) => (
      <Text key={line} dimColor>
        {line}
      </Text>
    ));
  }

  return suggestions;
}

export function ChatInputPanel(props: ChatInputPanelProps): React.ReactNode {
  const {
    picker = null,
    onPickerQueryChange = noop,
    onPickerSubmit = noop,
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
    ctrlCPending = false,
  } = props;
  const caretVisible = true;
  const hasSuggestions = atQuery !== null || slashSuggestions.length > 0;
  const showFooter = resolveFooterVisible({ hasSuggestions, hasPicker: Boolean(picker) });
  const termWidth = process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH;

  if (picker) {
    return (
      <>
        <Text dimColor>{borderLine()}</Text>
        {picker.kind === "model" ? (
          <PromptInput
            value={picker.query}
            linePrefixFirst={pickerLabel(picker)}
            onChange={onPickerQueryChange}
            onSubmit={onPickerSubmit}
          />
        ) : (
          <Text>{pickerLabel(picker)}</Text>
        )}
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
      {showFooter ? (
        <Box justifyContent="space-between" width={termWidth}>
          <Text dimColor>
            {`  ${ctrlCPending ? t("chat.input.ctrl_c_hint") : showHelp ? "" : value.length > 0 ? "" : `? ${t("chat.input.help_hint")}`}`}
          </Text>
          <Text dimColor>{`${footerContext}  `}</Text>
        </Box>
      ) : null}
    </>
  );
}
