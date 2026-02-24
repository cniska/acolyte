import { Box, Text } from "ink";
import React from "react";
import type { ChatRow } from "./chat-commands";
import { renderAssistantContent } from "./chat-content-render";

type ChatTranscriptProps = {
  rows: ChatRow[];
  isThinking: boolean;
  thinkingLabel?: string | null;
  thinkingFrame: number;
  thinkingStartedAt?: number | null;
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

export function parseSessionsHeader(content: string): { prefix: string; count: string; rest: string } | null {
  const [header, ...restLines] = content.split("\n");
  const match = header?.match(/^(Sessions\s+)(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    prefix: match[1] ?? "Sessions ",
    count: match[2] ?? "0",
    rest: restLines.join("\n"),
  };
}

export function parseStatusLine(line: string): { indent: string; key: string; value: string } | null {
  const match = line.match(/^(\s*)([a-zA-Z0-9_]+:\s*)(.*)$/);
  if (!match) {
    return null;
  }
  return {
    indent: match[1] ?? "",
    key: match[2] ?? "",
    value: match[3] ?? "",
  };
}

function renderStatusContent(content: string): React.ReactNode {
  const lines = content.split("\n");
  return (
    <>
      {lines.map((line, index) => {
        const parsed = parseStatusLine(line);
        return (
          <React.Fragment key={`status-line-${index}-${line}`}>
            {index > 0 ? "\n" : null}
            {parsed ? (
              <>
                <Text>{parsed.indent}</Text>
                <Text dimColor>{parsed.key}</Text>
                <Text>{parsed.value}</Text>
              </>
            ) : (
              <Text>{line}</Text>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

export function ChatTranscript(props: ChatTranscriptProps): React.ReactNode {
  const { rows, isThinking, thinkingLabel, thinkingFrame, thinkingStartedAt } = props;
  const pulsePeriod = 16;
  const phase = ((Math.abs(thinkingFrame) % pulsePeriod) / pulsePeriod) * Math.PI * 2;
  const baseIntensity = (Math.cos(phase) + 1) / 2;
  const holdThreshold = 0.9;
  const heldIntensity = baseIntensity >= holdThreshold ? 1 : Math.max(0, Math.min(1, baseIntensity / holdThreshold));
  const easedIntensity = heldIntensity * heldIntensity * (3 - 2 * heldIntensity);
  const gray = Math.round(24 + easedIntensity * (255 - 24));
  const channel = gray.toString(16).padStart(2, "0");
  const pulseColor = `#${channel}${channel}${channel}`;
  const pulseGlyph = "●";
  const hasContent = rows.length > 0 || isThinking;
  const elapsedSec =
    isThinking && typeof thinkingStartedAt === "number"
      ? Math.max(0, Math.floor((Date.now() - thinkingStartedAt) / 1000))
      : 0;
  const trimmedThinkingLabel = thinkingLabel?.trim() ?? "";
  const stageMatch = trimmedThinkingLabel.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const thinkingText = (() => {
    const timeText = `${elapsedSec}s`;
    if (stageMatch) {
      const stage = stageMatch[1]?.trim() || "Thinking…";
      const model = stageMatch[2]?.trim() || "";
      const details = [model, timeText].filter((part) => part.length > 0).join(" · ");
      return details.length > 0 ? `${stage} (${details})` : stage;
    }
    const base = trimmedThinkingLabel.length > 0 ? trimmedThinkingLabel : "Thinking…";
    return `${base} (${timeText})`;
  })();
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
            const sessionsListHeader =
              row.role === "assistant" && row.style === "sessionsList" ? parseSessionsHeader(row.content) : null;
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
                  ) : sessionsListHeader ? (
                    <Text>
                      <Text>{sessionsListHeader.prefix}</Text>
                      <Text dimColor>{sessionsListHeader.count}</Text>
                      {sessionsListHeader.rest.length > 0 ? <Text dimColor>{`\n${sessionsListHeader.rest}`}</Text> : null}
                    </Text>
                  ) : row.role === "system" && (row.style === "statusOutput" || row.style === "tokenOutput") ? (
                    <Text>{renderStatusContent(row.content)}</Text>
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
          <Box>
            <Box width={2}>
              <Text color={pulseColor}>{`${pulseGlyph} `}</Text>
            </Box>
            <Box width={contentWidth}>
              <Text dimColor>{thinkingText}</Text>
            </Box>
          </Box>
        </>
      ) : null}
    </>
  );
}
