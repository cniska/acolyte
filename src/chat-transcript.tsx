import { Box, Text } from "ink";
import React from "react";
import type { ChatRow } from "./chat-commands";
import { renderAssistantContent } from "./chat-content-render";

type ChatTranscriptProps = {
  rows: ChatRow[];
  isThinking: boolean;
  thinkingFrame: string;
};

export function ChatTranscript(props: ChatTranscriptProps): React.ReactNode {
  const { rows, isThinking, thinkingFrame } = props;
  const hasContent = rows.length > 0 || isThinking;
  return (
    <>
      {hasContent ? <Text> </Text> : null}
      {rows.map((row, index) => (
        <React.Fragment key={row.id}>
          {index > 0 ? <Text> </Text> : null}
          <Box>
            <Box width={2}>
              <Text dimColor={Boolean(row.dim)}>
                {row.role === "user" ? "❯ " : row.role === "assistant" ? "• " : "  "}
              </Text>
            </Box>
            <Box flexGrow={1}>
              <Text dimColor={Boolean(row.dim)}>
                {row.role === "assistant" ? renderAssistantContent(row.content) : row.content}
              </Text>
            </Box>
          </Box>
        </React.Fragment>
      ))}
      {isThinking ? (
        <>
          {rows.length > 0 ? <Text> </Text> : null}
          <Text dimColor>{`  ${thinkingFrame} thinking…`}</Text>
        </>
      ) : null}
    </>
  );
}
