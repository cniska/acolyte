import { Text } from "ink";
import React from "react";
import { sanitizeAssistantContent, tokenizeForHighlighting, wrapAssistantContent } from "./chat-content";

const TOOL_LABELS = ["Run", "Search", "Fetch", "Read", "Diff", "Edit", "Git Status"] as const;
const COLORS = {
  highlightCode: "#B7C0CC",
  highlightPath: "#A8B1BC",
} as const;

export function renderAssistantContent(content: string, wrapWidth: number): React.ReactNode {
  const cleaned = sanitizeAssistantContent(content);
  const wrapped = wrapAssistantContent(cleaned, wrapWidth);

  const renderHighlighted = (value: string, keyPrefix: string): React.ReactNode => {
    const lines = value.split("\n");
    let lineOffset = 0;
    return (
      <>
        {lines.map((line) => {
          const lineKey = `${keyPrefix}-line-${lineOffset}-${line}`;
          const showBreak = lineOffset > 0;
          const tokens = tokenizeForHighlighting(line);
          let tokenOffset = 0;
          const renderedTokens = tokens.map((token) => {
            const tokenKey = `${lineKey}-token-${tokenOffset}-${token.kind}-${token.text}`;
            tokenOffset += token.text.length;
            if (token.kind === "code") {
              return (
                <Text key={tokenKey} color={COLORS.highlightCode}>
                  {token.text}
                </Text>
              );
            }
            if (token.kind === "command") {
              return (
                <Text key={tokenKey} bold>
                  {token.text}
                </Text>
              );
            }
            if (token.kind === "path") {
              return (
                <Text key={tokenKey} underline color={COLORS.highlightPath}>
                  {token.text}
                </Text>
              );
            }
            return <Text key={tokenKey}>{token.text}</Text>;
          });
          lineOffset += line.length + 1;
          return (
            <React.Fragment key={lineKey}>
              {showBreak ? "\n" : null}
              {renderedTokens}
            </React.Fragment>
          );
        })}
      </>
    );
  };

  for (const label of TOOL_LABELS) {
    if (wrapped.startsWith(`${label} `) || wrapped.startsWith(`${label}(`) || wrapped.startsWith(`${label}:`)) {
      return (
        <>
          <Text bold>{label}</Text>
          {renderHighlighted(wrapped.slice(label.length), `tool-${label}`)}
        </>
      );
    }
  }

  return renderHighlighted(wrapped, "assistant");
}
