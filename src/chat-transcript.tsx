import { Box, Text } from "ink";
import React from "react";
import type { ChatRow } from "./chat-commands";
import { renderAssistantContent } from "./chat-content-render";

type ChatTranscriptProps = {
  rows: ChatRow[];
  isThinking: boolean;
  thinkingFrame: string;
};

const MAX_TRANSCRIPT_WIDTH = 100;

export function ChatTranscript(props: ChatTranscriptProps): React.ReactNode {
  const { rows, isThinking, thinkingFrame } = props;
  const hasContent = rows.length > 0 || isThinking;
  const columns = process.stdout.columns ?? 120;
  const contentWidth = Math.max(24, Math.min(MAX_TRANSCRIPT_WIDTH, columns - 2));
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
            <Box width={contentWidth}>
              <Text dimColor={Boolean(row.dim)}>
                {row.role === "assistant" ? renderAssistantContent(row.content, contentWidth) : row.content}
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
