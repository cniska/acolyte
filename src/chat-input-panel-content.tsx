import { Text } from "ink";
import type React from "react";
import { formatShortcutRows } from "./chat-layout";
import { slashCommandHelp } from "./chat-slash";

const SLASH_COMMAND_COLUMN_WIDTH = 16;

type SuggestionContentInput = {
  brandColor: string;
  atQuery: string | null;
  atSuggestions: string[];
  atSuggestionIndex: number;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
  showHelp: boolean;
};

export function renderInputPanelContent(input: SuggestionContentInput): React.ReactNode {
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
    suggestions = <Text dimColor> No file or folder matches.</Text>;
  } else if (slashSuggestions.length > 0) {
    const selectedIndex = Math.max(0, Math.min(slashSuggestionIndex, slashSuggestions.length - 1));
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
      <Text key={`shortcut-row-${line}`} dimColor>
        {line}
      </Text>
    ));
  }

  return suggestions;
}
