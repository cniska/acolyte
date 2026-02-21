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
const SESSION_STATUS_PREFIXES = ["Started new session: ", "Resumed session: "] as const;

function parseSessionStatus(content: string): { prefix: string; sessionId: string } | null {
  for (const prefix of SESSION_STATUS_PREFIXES) {
    if (!content.startsWith(prefix)) {
      continue;
    }
    const sessionId = content.slice(prefix.length).trim();
    if (sessionId.length === 0) {
      return null;
    }
    return { prefix, sessionId };
  }
  return null;
}

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
          {(() => {
            const sessionStatus =
              row.role === "assistant" && (row.style === "sessionStatus" || row.style === undefined)
                ? parseSessionStatus(row.content)
                : null;
            const dimMarker = Boolean(row.dim) || Boolean(sessionStatus);
            return (
              <Box>
                <Box width={2}>
                  <Text dimColor={dimMarker}>
                    {row.role === "user" ? "❯ " : row.role === "assistant" ? "• " : "  "}
                  </Text>
                </Box>
                <Box width={contentWidth}>
                  {sessionStatus ? (
                    <Text>
                      <Text dimColor>{sessionStatus.prefix}</Text>
                      <Text>{sessionStatus.sessionId}</Text>
                    </Text>
                  ) : (
                    <Text dimColor={Boolean(row.dim)}>
                      {row.role === "assistant" ? renderAssistantContent(row.content, contentWidth) : row.content}
                    </Text>
                  )}
                </Box>
              </Box>
            );
          })()}
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
