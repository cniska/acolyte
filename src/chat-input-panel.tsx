import type React from "react";
import { clampSuggestionIndex } from "./chat-effects";
import { FooterContext, type FooterState } from "./chat-footer";
import { BREAKPOINT_TWO_COLUMN, borderLine, SHORTCUT_ITEMS } from "./chat-layout";
import { type PickerState, pickerHint, pickerLabel, renderPickerItems } from "./chat-picker";
import { slashCommandHelp } from "./chat-slash";
import { t } from "./i18n";
import { PromptInput } from "./prompt-input";
import { Box, Text } from "./tui";
import { DEFAULT_TERMINAL_WIDTH } from "./tui/constants";

type ChatInputPanelProps = {
  picker?: PickerState | null;
  onPickerQueryChange?: (query: string) => void;
  onPickerSubmit?: () => void;
  activeSessionId?: string | undefined;
  brandColor?: string;
  footer?: FooterState;
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
  onCursorLine: (line: number) => void;
};

const noop = (): void => {};

const SLASH_COMMAND_COLUMN_WIDTH = 16;

function resolveFooterVisible(input: { hasSuggestions: boolean; hasPicker: boolean }): boolean {
  if (input.hasSuggestions) return false;
  if (input.hasPicker) return false;
  return true;
}

function ShortcutItem({ label, description }: { label: string; description: string }): React.ReactNode {
  return (
    <Box width={44}>
      <Text dimColor>{"  "}</Text>
      <Box width={20}>
        <Text dimColor>{label}</Text>
      </Box>
      <Text dimColor>{description}</Text>
    </Box>
  );
}

function renderShortcutGrid(termWidth: number): React.ReactNode {
  const useTwoColumns = termWidth >= BREAKPOINT_TWO_COLUMN;
  const rowsPerColumn = useTwoColumns ? Math.ceil(SHORTCUT_ITEMS.length / 2) : SHORTCUT_ITEMS.length;
  const rows: React.ReactNode[] = [];

  for (let row = 0; row < rowsPerColumn; row++) {
    const left = SHORTCUT_ITEMS[row];
    const right = useTwoColumns ? SHORTCUT_ITEMS[row + rowsPerColumn] : undefined;
    rows.push(
      <Box key={left?.key ?? row}>
        {left ? <ShortcutItem label={left.key} description={left.description} /> : null}
        {right ? <ShortcutItem label={right.key} description={right.description} /> : null}
      </Box>,
    );
  }

  return rows;
}

function renderInputPanelContent(input: {
  brandColor: string;
  atQuery: string | null;
  atSuggestions: string[];
  atSuggestionIndex: number;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
}): React.ReactNode {
  const { brandColor, atQuery, atSuggestions, atSuggestionIndex, slashSuggestions, slashSuggestionIndex } = input;

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
          <Box key={`slash-suggestion-${item}`}>
            <Text color={index === selectedIndex ? brandColor : undefined} dimColor={index !== selectedIndex}>
              {"  "}
            </Text>
            <Box width={SLASH_COMMAND_COLUMN_WIDTH}>
              <Text color={index === selectedIndex ? brandColor : undefined} dimColor={index !== selectedIndex}>
                {item}
              </Text>
            </Box>
          </Box>
        ))}
        {selectedHelp ? <Text dimColor>{`\n  ${selectedHelp}`}</Text> : null}
      </>
    );
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
    footer,
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
    onCursorLine,
  } = props;
  const caretVisible = true;
  const hasSuggestions = atQuery !== null || slashSuggestions.length > 0;
  const showFooter = resolveFooterVisible({ hasSuggestions, hasPicker: Boolean(picker) });
  const termWidth = process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH;

  if (picker) {
    return (
      <>
        <Text color={brandColor} dimColor>
          {borderLine()}
        </Text>
        {picker.kind === "model" ? (
          <PromptInput
            value={picker.query}
            linePrefixFirst={pickerLabel(picker)}
            onChange={onPickerQueryChange}
            onSubmit={onPickerSubmit}
            onCursorLine={noop}
          />
        ) : (
          <Text>{pickerLabel(picker)}</Text>
        )}
        <Text> </Text>
        {renderPickerItems(picker, activeSessionId, brandColor)}
        <Text> </Text>
        <Text dimColor>{pickerHint(picker)}</Text>
        <Text color={brandColor} dimColor>
          {borderLine()}
        </Text>
      </>
    );
  }

  return (
    <>
      <Text color={brandColor} dimColor>
        {borderLine()}
      </Text>
      <PromptInput
        value={value}
        placeholder={t("chat.input.placeholder")}
        caretVisible={caretVisible}
        linePrefixFirst="❯ "
        linePrefixRest="  "
        wrapWidth={termWidth - 2}
        onChange={onChange}
        onSubmit={onSubmit}
        onCursorLine={onCursorLine}
        key={`chat-input-${inputRevision}`}
      />
      <Text color={brandColor} dimColor>
        {borderLine()}
      </Text>
      {showHelp ? (
        <Box flexDirection="column">{renderShortcutGrid(termWidth)}</Box>
      ) : (
        renderInputPanelContent({
          brandColor,
          atQuery,
          atSuggestions,
          atSuggestionIndex,
          slashSuggestions,
          slashSuggestionIndex,
        })
      )}
      {showFooter && !showHelp && value.length === 0 && footer ? (
        <Box justifyContent="space-between" width={termWidth}>
          <Text dimColor>{`  ${ctrlCPending ? t("chat.input.ctrl_c_hint") : `? ${t("chat.input.help_hint")}`}`}</Text>
          <FooterContext {...footer} />
        </Box>
      ) : null}
    </>
  );
}
