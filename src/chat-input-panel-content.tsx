import { Text } from "ink";
import React from "react";
import { formatShortcutRows } from "./chat-layout";

type SuggestionContentInput = {
  brandColor: string;
  atQuery: string | null;
  atSuggestions: string[];
  atSuggestionIndex: number;
  slashSuggestions: string[];
  slashSuggestionIndex: number;
  showShortcuts: boolean;
  queuedInput: string | null;
};

export function renderInputPanelContent(input: SuggestionContentInput): React.ReactNode {
  const {
    brandColor,
    atQuery,
    atSuggestions,
    atSuggestionIndex,
    slashSuggestions,
    slashSuggestionIndex,
    showShortcuts,
    queuedInput,
  } = input;

  let suggestions: React.ReactNode;
  if (atQuery !== null && atSuggestions.length > 0) {
    suggestions = (
      <>
        {atSuggestions.map((item) => (
          <Text
            key={`at-suggestion-${item}`}
            color={item === atSuggestions[atSuggestionIndex] ? brandColor : undefined}
          >
            {`  ${item}`}
          </Text>
        ))}
      </>
    );
  } else if (atQuery !== null) {
    suggestions = <Text dimColor> No file or folder matches.</Text>;
  } else if (slashSuggestions.length > 0) {
    suggestions = (
      <>
        {slashSuggestions.map((item, index) => (
          <Text
            key={`slash-suggestion-${item}`}
            color={index === slashSuggestionIndex ? brandColor : undefined}
            dimColor={index !== slashSuggestionIndex}
          >{`  ${item}`}</Text>
        ))}
      </>
    );
  } else if (showShortcuts) {
    suggestions = (
      <>
        {formatShortcutRows().map((line, index) => (
          <Text key={`shortcut-row-${index}`} dimColor>
            {line}
          </Text>
        ))}
      </>
    );
  } else {
    suggestions = <Text dimColor> ? for shortcuts</Text>;
  }

  return (
    <>
      {suggestions}
      {queuedInput ? <Text dimColor>{` queued: ${queuedInput}`}</Text> : null}
    </>
  );
}
