import { Box, Text } from "ink";
import React from "react";
import type { ChatRow } from "./chat-commands";
import { renderAssistantContent } from "./chat-content-render";
import { palette } from "./palette";
import { renderToolOutput as renderToolOutputText, type ToolOutput } from "./tool-output-content";

type ChatTranscriptProps = {
  rows: ChatRow[];
  isWorking: boolean;
  progressText?: string | null;
  thinkingFrame: number;
  queuedMessages?: string[];
  thinkingStartedAt?: number | null;
};

const MAX_TRANSCRIPT_WIDTH = 120;
const SESSION_STATUS_PREFIXES = ["Started new session: ", "Resumed session: "] as const;

function parseSessionStatus(content: string): { prefix: string; sessionId: string } | null {
  for (const prefix of SESSION_STATUS_PREFIXES) {
    if (!content.startsWith(prefix)) continue;
    const sessionId = content.slice(prefix.length).trim();
    if (sessionId.length === 0) return null;
    return { prefix, sessionId };
  }
  return null;
}

export function parseSessionsHeader(content: string): { prefix: string; count: string; rest: string } | null {
  const [header, ...restLines] = content.split("\n");
  const match = header?.match(/^(Sessions\s+)(\d+)$/);
  if (!match) return null;
  return {
    prefix: match[1] ?? "Sessions ",
    count: match[2] ?? "0",
    rest: restLines.join("\n"),
  };
}

export function parseStatusLine(line: string): { indent: string; key: string; value: string } | null {
  const match = line.match(/^(\s*)([a-zA-Z0-9_.-]+:\s*)(.*)$/);
  if (!match) return null;
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
          <React.Fragment key={`status-line-${index}`}>
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

function renderToolLine(item: ToolOutput, index: number, lineNumWidth: number): React.ReactNode {
  if (item.kind === "diff") {
    const num = String(item.lineNumber).padStart(lineNumWidth);
    if (item.marker === "add")
      return (
        <Text key={`tool-${index}`}>
          {"\n  "}
          <Text dimColor>{num}</Text> <Text color="green">{item.text}</Text>
        </Text>
      );
    if (item.marker === "remove")
      return (
        <Text key={`tool-${index}`}>
          {"\n  "}
          <Text dimColor>{num}</Text> <Text color="red">{item.text}</Text>
        </Text>
      );
    return (
      <Text key={`tool-${index}`}>
        {"\n  "}
        <Text dimColor>{num}</Text> {item.text}
      </Text>
    );
  }
  if (item.kind === "command-output") {
    return (
      <Text key={`tool-${index}`}>
        {"\n  "}
        <Text dimColor color={item.stream === "stderr" ? "red" : undefined}>
          {item.text}
        </Text>
      </Text>
    );
  }
  const text = renderToolOutputText(item);
  if (item.kind === "truncated" && lineNumWidth > 0) {
    return (
      <Text key={`tool-${index}`}>
        {"\n  "}
        <Text dimColor>{"…".padStart(lineNumWidth)}</Text> <Text dimColor>{text.slice(2)}</Text>
      </Text>
    );
  }
  return (
    <Text key={`tool-${index}`}>
      {"\n  "}
      {text}
    </Text>
  );
}

function renderToolBlock(items: ToolOutput[]): React.ReactNode {
  if (items.length === 0) return null;
  const first = items[0];
  if (!first) return null;
  const text = renderToolOutputText(first);
  const label = "label" in first && typeof first.label === "string" ? first.label : undefined;
  const lineNumWidth = items.reduce(
    (max, item) => (item.kind === "diff" ? Math.max(max, String(item.lineNumber).length) : max),
    0,
  );
  return (
    <>
      {label && text.startsWith(label) ? (
        <>
          <Text bold>{label}</Text>
          <Text>{text.slice(label.length)}</Text>
        </>
      ) : (
        <Text>{text}</Text>
      )}
      {items.slice(1).map((item, i) => renderToolLine(item, i, lineNumWidth))}
    </>
  );
}

export function ChatTranscript(props: ChatTranscriptProps): React.ReactNode {
  const { rows, isWorking, progressText, thinkingFrame, thinkingStartedAt } = props;
  const pulsePeriod = 16;
  const hasContent = rows.length > 0 || isWorking;
  const elapsedSec =
    isWorking && typeof thinkingStartedAt === "number"
      ? Math.max(0, Math.floor((Date.now() - thinkingStartedAt) / 1000))
      : 0;
  const trimmedProgressText = progressText?.trim() ?? "";
  const stageMatch = trimmedProgressText.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const normalizedProgress = trimmedProgressText.toLowerCase();
  const isQueued = normalizedProgress.startsWith("queued");
  const isAccepted = normalizedProgress.startsWith("accepted");
  const isRunning = isWorking && !isQueued && !isAccepted;
  const runningBlinkOn = Math.abs(thinkingFrame) % pulsePeriod < pulsePeriod / 2;
  const pulseGlyph = isRunning ? (runningBlinkOn ? "•" : " ") : "•";
  const indicatorColor: string = isQueued ? palette.queued : isAccepted ? palette.accepted : palette.running;
  const thinkingText = (() => {
    const timeText = `${elapsedSec}s`;
    if (stageMatch) {
      const stage = stageMatch[1]?.trim() ?? "";
      const model = stageMatch[2]?.trim() || "";
      const details = [timeText, model].filter((part) => part.length > 0).join(" • ");
      return details.length > 0 ? `${stage} (${details})` : stage;
    }
    return `${trimmedProgressText} (${timeText})`;
  })();
  const columns = process.stdout.columns ?? 120;
  const contentWidth = Math.max(24, Math.min(MAX_TRANSCRIPT_WIDTH, columns - 2));
  const toolContentWidth = Math.max(24, columns - 2);
  return (
    <>
      {hasContent ? <Text> </Text> : null}
      {rows.map((row, index) => (
        <React.Fragment key={row.id}>
          {index > 0 ? <Text> </Text> : null}
          {(() => {
            const sessionStatus =
              row.role === "assistant" && (row.style === "sessionStatusOutput" || row.style === undefined)
                ? parseSessionStatus(row.content)
                : null;
            const sessionsOutputHeader = row.style === "sessionsOutput" ? parseSessionsHeader(row.content) : null;
            const dimMarker = Boolean(row.dim) || Boolean(sessionStatus);
            let marker = "  ";
            let markerColor: string | undefined;
            if (row.role === "user") {
              marker = "❯ ";
            } else if (row.role === "assistant") {
              marker = "• ";
            } else if (row.role === "system" && (row.style === "cancelled" || row.style === "error")) {
              marker = "· ";
            }
            if (row.style === "toolOutput") marker = "· ";
            if (row.style === "toolOutput" && row.toolStatus)
              markerColor = row.toolStatus === "ok" ? palette.success : palette.error;
            if (row.style === "worked") markerColor = palette.success;
            if (row.style === "error") markerColor = palette.error;
            if (row.style === "cancelled") markerColor = palette.cancelled;
            return (
              <Box>
                <Box width={2}>
                  <Text dimColor={!markerColor && dimMarker} color={markerColor}>
                    {marker}
                  </Text>
                </Box>
                <Box width={row.style === "toolOutput" ? toolContentWidth : contentWidth}>
                  {sessionStatus ? (
                    <Text>
                      <Text dimColor>{sessionStatus.prefix}</Text>
                      <Text>{sessionStatus.sessionId}</Text>
                    </Text>
                  ) : sessionsOutputHeader ? (
                    <Text>
                      <Text>{sessionsOutputHeader.prefix}</Text>
                      <Text dimColor>{sessionsOutputHeader.count}</Text>
                      {sessionsOutputHeader.rest.length > 0
                        ? sessionsOutputHeader.rest.split("\n").map((line, i) => {
                            const match = line.match(/^(. )(sess_\S+)(\s.*)$/);
                            if (!match) {
                              return (
                                <Text key={`sl-${i}`} dimColor>
                                  {`\n${line}`}
                                </Text>
                              );
                            }
                            return (
                              <React.Fragment key={`sl-${i}`}>
                                <Text dimColor>{`\n${match[1]}`}</Text>
                                <Text>{match[2]}</Text>
                                <Text dimColor>{match[3]}</Text>
                              </React.Fragment>
                            );
                          })
                        : null}
                    </Text>
                  ) : row.role === "system" && (row.style === "statusOutput" || row.style === "tokenOutput") ? (
                    <Text>{renderStatusContent(row.content)}</Text>
                  ) : row.role === "assistant" && row.style === "toolOutput" && row.toolOutput ? (
                    <Text>{renderToolBlock(row.toolOutput)}</Text>
                  ) : row.style === "error" ? (
                    <Text dimColor color={palette.error}>
                      {row.content}
                    </Text>
                  ) : (
                    <Text
                      dimColor={Boolean(row.dim)}
                      color={row.role === "assistant" && !row.dim ? palette.brand : undefined}
                    >
                      {row.role === "assistant" ? renderAssistantContent(row.content, contentWidth) : row.content}
                    </Text>
                  )}
                </Box>
              </Box>
            );
          })()}
        </React.Fragment>
      ))}
      {isWorking ? (
        <>
          {rows.length > 0 ? <Text> </Text> : null}
          <Box>
            <Box width={2}>
              <Text color={indicatorColor}>{`${pulseGlyph} `}</Text>
            </Box>
            <Box width={contentWidth}>
              <Text dimColor>{thinkingText}</Text>
            </Box>
          </Box>
          {props.queuedMessages?.map((msg, i) => (
            <React.Fragment key={`queued-${i}`}>
              <Text> </Text>
              <Box>
                <Box width={2}>
                  <Text dimColor>{"❯ "}</Text>
                </Box>
                <Box width={contentWidth}>
                  <Text dimColor>{msg}</Text>
                </Box>
              </Box>
            </React.Fragment>
          ))}
        </>
      ) : null}
    </>
  );
}
