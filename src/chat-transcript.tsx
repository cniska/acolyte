import { Box, Text } from "ink";
import React from "react";
import type { ChatRow } from "./chat-commands";
import { renderAssistantContent } from "./chat-content-render";
import { palette } from "./palette";
import { parseToolProgressBlock, type ToolProgressBlock } from "./tool-progress";

type ChatTranscriptProps = {
  rows: ChatRow[];
  isWorking: boolean;
  progressText?: string | null;
  thinkingFrame: number;
  queuedMessages?: string[];
  thinkingStartedAt?: number | null;
};

const MAX_TRANSCRIPT_WIDTH = 100;
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
  const match = line.match(/^(\s*)([a-zA-Z0-9_]+:\s*)(.*)$/);
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

const FILE_HEADER_VERBS = ["Edit", "Create", "Read", "Delete", "Diff", "Status"];

function renderProgressHeader(header: { verb: string; path: string }): React.ReactNode {
  return (
    <>
      <Text bold>{`${header.verb} `}</Text>
      {FILE_HEADER_VERBS.includes(header.verb) ? (
        <Text underline color={palette.textPath}>
          {header.path}
        </Text>
      ) : (
        <Text dimColor>{header.path}</Text>
      )}
    </>
  );
}

function renderDiffBody(block: ToolProgressBlock): React.ReactNode {
  const { lines, lineNumberWidth } = block;

  return lines.map((parsed, index) => (
    <React.Fragment key={`diff-${index}`}>
      {"\n  "}
      {parsed.kind === "numberedDiff" ? (
        <>
          <Text dimColor>{parsed.lineNumber.padStart(lineNumberWidth, " ")}</Text>
          <Text color={parsed.marker === "+" ? palette.green : palette.red}>{`  ${parsed.text}`}</Text>
        </>
      ) : parsed.kind === "numberedContext" ? (
        <>
          <Text dimColor>{`${parsed.lineNumber.padStart(lineNumberWidth, " ")}  `}</Text>
          <Text>{parsed.text}</Text>
        </>
      ) : parsed.kind === "fileDiff" ? (
        <Text color={parsed.marker === "+" ? palette.green : palette.red}>{parsed.text}</Text>
      ) : parsed.kind === "meta" ? (
        <>
          <Text dimColor>{"…".padStart(lineNumberWidth, " ")}</Text>
          {parsed.text.length > 1 ? <Text dimColor>{parsed.text.slice(1)}</Text> : null}
        </>
      ) : (
        <Text>{parsed.kind === "text" ? parsed.text : ""}</Text>
      )}
    </React.Fragment>
  ));
}

function renderCommandBody(block: ToolProgressBlock): React.ReactNode {
  return block.lines.map((parsed, index) => (
    <React.Fragment key={`cmd-${index}`}>
      {"\n  "}
      {parsed.kind === "commandOutput" ? (
        parsed.stream === "err" && !parsed.text.startsWith("$ ") ? (
          <Text dimColor color={palette.red}>
            {parsed.text}
          </Text>
        ) : (
          <Text dimColor>{parsed.text}</Text>
        )
      ) : parsed.kind === "meta" ? (
        <Text dimColor>{parsed.text}</Text>
      ) : (
        <Text>{parsed.kind === "text" ? parsed.text : ""}</Text>
      )}
    </React.Fragment>
  ));
}

function renderPlainBody(block: ToolProgressBlock): React.ReactNode {
  return block.lines.map((parsed, index) => (
    <React.Fragment key={`plain-${index}`}>
      {"\n  "}
      {parsed.kind === "fileDiff" ? (
        <Text color={parsed.marker === "+" ? palette.green : palette.red}>{parsed.text}</Text>
      ) : (
        <Text dimColor>{parsed.kind === "text" || parsed.kind === "meta" ? parsed.text : ""}</Text>
      )}
    </React.Fragment>
  ));
}

function renderToolProgressContent(content: string): React.ReactNode {
  const block = parseToolProgressBlock(content);
  return (
    <>
      {block.header ? renderProgressHeader(block.header) : null}
      {block.kind === "diff"
        ? renderDiffBody(block)
        : block.kind === "command"
          ? renderCommandBody(block)
          : renderPlainBody(block)}
    </>
  );
}

export function ChatTranscript(props: ChatTranscriptProps): React.ReactNode {
  const { rows, isWorking, progressText, thinkingFrame, thinkingStartedAt } = props;
  const pulsePeriod = 16;
  const phase = ((Math.abs(thinkingFrame) % pulsePeriod) / pulsePeriod) * Math.PI * 2;
  const baseIntensity = (Math.cos(phase) + 1) / 2;
  const holdThreshold = 0.9;
  const heldIntensity = baseIntensity >= holdThreshold ? 1 : Math.max(0, Math.min(1, baseIntensity / holdThreshold));
  const easedIntensity = heldIntensity * heldIntensity * (3 - 2 * heldIntensity);
  const gray = Math.round(60 + easedIntensity * (140 - 60));
  const channel = gray.toString(16).padStart(2, "0");
  const pulseColor = `#${channel}${channel}${channel}`;
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
      const details = [timeText, model].filter((part) => part.length > 0).join(" · ");
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
              row.role === "assistant" && (row.style === "sessionStatus" || row.style === undefined)
                ? parseSessionStatus(row.content)
                : null;
            const sessionsListHeader = row.style === "sessionsList" ? parseSessionsHeader(row.content) : null;
            const dimMarker = Boolean(row.dim) || Boolean(sessionStatus);
            let marker = "  ";
            let markerColor: string | undefined;
            if (row.role === "user") {
              marker = "❯ ";
            } else if (row.role === "assistant") {
              marker = "• ";
            } else if (row.role === "system" && (row.style === "cancelled" || row.style === "error")) {
              marker = "• ";
            }
            if (row.style === "toolProgress" && row.toolStatus)
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
                <Box width={row.style === "toolProgress" ? toolContentWidth : contentWidth}>
                  {sessionStatus ? (
                    <Text>
                      <Text dimColor>{sessionStatus.prefix}</Text>
                      <Text>{sessionStatus.sessionId}</Text>
                    </Text>
                  ) : sessionsListHeader ? (
                    <Text>
                      <Text>{sessionsListHeader.prefix}</Text>
                      <Text dimColor>{sessionsListHeader.count}</Text>
                      {sessionsListHeader.rest.length > 0
                        ? sessionsListHeader.rest.split("\n").map((line, i) => {
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
                  ) : row.role === "assistant" && row.style === "toolProgress" ? (
                    <Text>{renderToolProgressContent(row.content)}</Text>
                  ) : row.style === "error" ? (
                    <Text dimColor color={palette.error}>
                      {row.content}
                    </Text>
                  ) : (
                    <Text dimColor={Boolean(row.dim)} italic={row.role === "assistant" && !row.dim}>
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
