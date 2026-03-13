import React from "react";
import { sanitizeAssistantContent, tokenizeForHighlighting, wrapAssistantContent } from "./chat-content";
import { palette } from "./palette";
import { Text } from "./tui";

export function renderAssistantContent(content: string, wrapWidth: number): React.ReactNode {
  const cleaned = sanitizeAssistantContent(content);
  const wrapped = wrapAssistantContent(cleaned, wrapWidth);
  const lines = wrapped.split("\n");
  let lineOffset = 0;
  return (
    <>
      {lines.map((line) => {
        const lineKey = `assistant-line-${lineOffset}-${line}`;
        const showBreak = lineOffset > 0;
        const tokens = tokenizeForHighlighting(line);
        let tokenOffset = 0;
        const renderedTokens = tokens.map((token) => {
          const tokenKey = `${lineKey}-token-${tokenOffset}-${token.kind}-${token.text}`;
          tokenOffset += token.text.length;
          if (token.kind === "code") {
            return (
              <Text key={tokenKey} color={palette.textCode}>
                {token.text}
              </Text>
            );
          }
          if (token.kind === "path") {
            return (
              <Text key={tokenKey} underline color={palette.textPath}>
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
}
