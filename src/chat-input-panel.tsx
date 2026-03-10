import { Text } from "ink";
import type React from "react";
import { useCaretBlink } from "./chat-effects";
import { renderInputPanelContent } from "./chat-input-panel-content";
import { borderLine, justifyLineSpaceBetween } from "./chat-layout";
import { t } from "./i18n";
import { type PickerState, pickerHint, pickerTitle, renderPickerItems } from "./chat-picker";
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

function resolveFooterVisible(input: { showHelp: boolean; hasSuggestions: boolean; hasPicker: boolean }): boolean {
  if (input.showHelp) return false;
  if (input.hasSuggestions) return false;
  if (input.hasPicker) return false;
  return true;
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
