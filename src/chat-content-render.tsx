import React from "react";
import { Text } from "ink";
import { sanitizeAssistantContent, tokenizeForHighlighting } from "./chat-content";

const TOOL_LABELS = ["Run", "Search", "Read", "Diff", "Edit", "Update", "Status"] as const;
const COLORS = {
  highlightCode: "#B7C0CC",
  highlightPath: "#A8B1BC",
} as const;

export function renderAssistantContent(content: string): React.ReactNode {
  const cleaned = sanitizeAssistantContent(content);

  const renderHighlighted = (value: string, keyPrefix: string): React.ReactNode => {
    const lines = value.split("\n");
    return (
      <>
        {lines.map((line, lineIndex) => (
          <React.Fragment key={`${keyPrefix}-line-${lineIndex}`}>
            {lineIndex > 0 ? "\n" : null}
            {tokenizeForHighlighting(line).map((token, tokenIndex) => {
              if (token.kind === "code") {
                return (
                  <Text key={`${keyPrefix}-token-${lineIndex}-${tokenIndex}`} color={COLORS.highlightCode}>
                    {token.text}
                  </Text>
                );
              }
              if (token.kind === "command") {
                return (
                  <Text key={`${keyPrefix}-token-${lineIndex}-${tokenIndex}`} bold>
                    {token.text}
                  </Text>
                );
              }
              if (token.kind === "path") {
                return (
                  <Text key={`${keyPrefix}-token-${lineIndex}-${tokenIndex}`} underline color={COLORS.highlightPath}>
                    {token.text}
                  </Text>
                );
              }
              return <Text key={`${keyPrefix}-token-${lineIndex}-${tokenIndex}`}>{token.text}</Text>;
            })}
          </React.Fragment>
        ))}
      </>
    );
  };

  for (const label of TOOL_LABELS) {
    if (cleaned.startsWith(`${label} `) || cleaned.startsWith(`${label}(`) || cleaned.startsWith(`${label}:`)) {
      return (
        <>
          <Text bold>{label}</Text>
          {renderHighlighted(cleaned.slice(label.length), `tool-${label}`)}
        </>
      );
    }
  }

  return renderHighlighted(cleaned, "assistant");
}
