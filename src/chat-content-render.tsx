import React from "react";
import { unreachable } from "./assert";
import { sanitizeAssistantContent, tokenize, wrapAssistantContent } from "./chat-content";
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
        const tokens = tokenize(line);
        let tokenOffset = 0;
        const renderedTokens = tokens.map((token) => {
          const tokenKey = `${lineKey}-token-${tokenOffset}-${token.kind}-${token.text}`;
          tokenOffset += token.text.length;
          switch (token.kind) {
            case "code":
              return (
                <Text key={tokenKey} dimColor>
                  {token.text.slice(1, -1)}
                </Text>
              );
            case "bold":
              return (
                <Text key={tokenKey} bold>
                  {token.text.slice(2, -2)}
                </Text>
              );
            case "path":
              return (
                <Text key={tokenKey} dimColor>
                  {token.text}
                </Text>
              );
            case "plain":
              return <Text key={tokenKey}>{token.text}</Text>;
            default:
              return unreachable(token.kind);
          }
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
