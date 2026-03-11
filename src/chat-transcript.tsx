import { Box, Text } from "ink";
import React from "react";
import type { ChatRow } from "./chat-commands";
import { renderAssistantContent } from "./chat-content-render";
import { formatTokenCount } from "./chat-format";
import { ShimmerText } from "./chat-shimmer";
import { palette } from "./palette";
import { renderToolOutput as renderToolOutputText, type ToolOutput } from "./tool-output-content";

const MARKERS: Record<ChatRow["role"], string> = {
  user: "❯ ",
  assistant: "• ",
  tool: "• ",
  status: "• ",
  task: "• ",
  system: "  ",
};

type ChatTranscriptProps = {
  rows: ChatRow[];
  isWorking: boolean;
  progressText?: string | null;
  thinkingFrame: number;
  queuedMessages?: string[];
  thinkingStartedAt?: number | null;
  runningUsage?: { promptTokens: number; completionTokens: number } | null;
};

const MAX_TRANSCRIPT_WIDTH = 120;
const SESSION_STATUS_PREFIXES = ["Started new session: ", "Resumed session: "] as const;

export function parseStatusLine(line: string): { indent: string; key: string; value: string } | null {
  const match = line.match(/^(\s*)([a-zA-Z0-9_.-]+:\s*)(.*)$/);
  if (!match) return null;
  return {
    indent: match[1] ?? "",
    key: match[2] ?? "",
    value: match[3] ?? "",
  };
}

function renderSessionStatusLine(content: string): React.ReactNode {
  for (const prefix of SESSION_STATUS_PREFIXES) {
    if (!content.startsWith(prefix)) continue;
    const sessionId = content.slice(prefix.length).trim();
    if (sessionId.length === 0) return null;
    return (
      <Text>
        <Text dimColor>{prefix}</Text>
        <Text>{sessionId}</Text>
      </Text>
    );
  }
  return null;
}

function renderSessionsListContent(content: string): React.ReactNode {
  const [header, ...restLines] = content.split("\n");
  const match = header?.match(/^(Sessions\s+)(\d+)$/);
  if (!match) return null;
  return (
    <Text>
      <Text>{match[1] ?? "Sessions "}</Text>
      <Text dimColor>{match[2] ?? "0"}</Text>
      {restLines.length > 0
        ? restLines.map((line) => {
            const sessionMatch = line.match(/^(. )(sess_\S+)(\s.*)$/);
            if (!sessionMatch) {
              return (
                <Text key={line} dimColor>
                  {`\n${line}`}
                </Text>
              );
            }
            return (
              <React.Fragment key={line}>
                <Text dimColor>{`\n${sessionMatch[1]}`}</Text>
                <Text>{sessionMatch[2]}</Text>
                <Text dimColor>{sessionMatch[3]}</Text>
              </React.Fragment>
            );
          })
        : null}
    </Text>
  );
}

function renderKeyValueContent(content: string): React.ReactNode {
  const lines = content.split("\n");
  const hasKeyValue = lines.some((line) => parseStatusLine(line) !== null);
  if (!hasKeyValue) return null;
  return (
    <>
      {lines.map((line, index) => {
        const parsed = parseStatusLine(line);
        return (
          <React.Fragment key={line}>
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

function renderSystemContent(content: string): React.ReactNode {
  return (
    renderSessionStatusLine(content) ?? renderSessionsListContent(content) ?? renderKeyValueContent(content) ?? content
  );
}

function renderToolLine(
  item: ToolOutput,
  index: number,
  lineNumWidth: number,
  diffTextWidth?: number,
): React.ReactNode {
  if (item.kind === "diff") {
    const num = String(item.lineNumber).padStart(lineNumWidth);
    const padded = diffTextWidth ? item.text.padEnd(diffTextWidth) : item.text;
    if (item.marker === "add")
      return (
        <Text key={`tool-${index}`}>
          {"\n  "}
          <Text color={palette.green}>{num} </Text>
          <Text backgroundColor={palette.diffAdd}>{padded}</Text>
        </Text>
      );
    if (item.marker === "remove")
      return (
        <Text key={`tool-${index}`}>
          {"\n  "}
          <Text color={palette.red}>{num} </Text>
          <Text backgroundColor={palette.diffRemove}>{padded}</Text>
        </Text>
      );
    return (
      <Text key={`tool-${index}`}>
        {"\n  "}
        <Text dimColor>
          {num} {item.text}
        </Text>
      </Text>
    );
  }
  if (item.kind === "command-output") {
    return (
      <Text key={`tool-${index}`}>
        {"\n  "}
        <Text dimColor color={item.stream === "stderr" ? palette.red : undefined}>
          {item.text}
        </Text>
      </Text>
    );
  }
  const text = renderToolOutputText(item);
  return (
    <Text key={`tool-${index}`}>
      {"\n  "}
      <Text dimColor>{text}</Text>
    </Text>
  );
}

function renderToolBlock(items: ToolOutput[], contentWidth: number): React.ReactNode {
  if (items.length === 0) return null;
  const first = items[0];
  if (!first) return null;
  const text = renderToolOutputText(first);
  const label = "label" in first && typeof first.label === "string" ? first.label : undefined;
  const lineNumWidth = items.reduce(
    (max, item) => (item.kind === "diff" ? Math.max(max, String(item.lineNumber).length) : max),
    0,
  );
  const diffTextWidth = lineNumWidth > 0 ? Math.max(0, contentWidth - 2 - lineNumWidth - 1) : undefined;
  return (
    <>
      {label && text.startsWith(label) ? (
        <>
          <Text bold>{label}</Text>
          <Text dimColor>{text.slice(label.length)}</Text>
        </>
      ) : (
        <Text>{text}</Text>
      )}
      {items.slice(1).map((item, i) => renderToolLine(item, i, lineNumWidth, diffTextWidth))}
    </>
  );
}

export function ChatTranscript(props: ChatTranscriptProps): React.ReactNode {
  const { rows, isWorking, progressText, thinkingFrame, thinkingStartedAt, runningUsage } = props;
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
  const tokenText = runningUsage ? formatTokenCount(runningUsage.promptTokens + runningUsage.completionTokens) : "";
  const thinkingText = (() => {
    const timeText = elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`;
    if (stageMatch) {
      const stage = stageMatch[1]?.trim() ?? "";
      const model = stageMatch[2]?.trim() || "";
      const details = [timeText, model, tokenText].filter((part) => part.length > 0).join(" • ");
      return details.length > 0 ? `${stage} (${details})` : stage;
    }
    const parts = [trimmedProgressText, timeText, tokenText].filter((part) => part.length > 0);
    return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(" • ")})` : (parts[0] ?? "");
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
            const marker = MARKERS[row.role];
            const markerColor = row.style?.marker ?? (row.role === "assistant" ? palette.brand : undefined);
            const textColor =
              row.style?.text ?? (row.role === "assistant" && !row.style?.dim ? palette.brand : undefined);
            const dim = row.style?.dim ?? false;
            return (
              <Box>
                <Box width={2}>
                  <Text color={markerColor}>{marker}</Text>
                </Box>
                <Box width={row.role === "tool" ? toolContentWidth : contentWidth}>
                  {row.role === "tool" && row.toolOutput ? (
                    <Text>{renderToolBlock(row.toolOutput, toolContentWidth)}</Text>
                  ) : row.role === "assistant" ? (
                    <Text dimColor={dim} color={textColor}>
                      {renderAssistantContent(row.content, contentWidth)}
                    </Text>
                  ) : (
                    <Text dimColor={dim} color={textColor}>
                      {renderSystemContent(row.content)}
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
              {isRunning ? (
                <ShimmerText text={thinkingText} frame={thinkingFrame} totalFrames={16} />
              ) : (
                <Text dimColor>{thinkingText}</Text>
              )}
            </Box>
          </Box>
          {props.queuedMessages?.map((msg) => (
            <React.Fragment key={msg}>
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
