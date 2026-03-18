import React from "react";
import type { AgentMode } from "./agent-contract";
import { renderAssistantContent } from "./chat-content-render";
import type { ChatRow, CommandOutput } from "./chat-contract";
import { isCommandOutput, isToolOutput } from "./chat-contract";
import { COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH, formatTokenCount } from "./chat-format";
import { ShimmerText } from "./chat-shimmer";
import type { PendingState } from "./client-contract";
import { t } from "./i18n";
import { palette } from "./palette";
import { renderToolOutputPart as renderToolOutputText, type ToolOutputPart } from "./tool-output-content";
import { Box, Text } from "./tui";

const MODE_PENDING_TEXT: Record<AgentMode, string> = {
  work: t("agent.status.working"),
  verify: t("agent.status.verifying"),
};

const MARKERS: Record<ChatRow["kind"], string> = {
  user: "❯ ",
  assistant: "• ",
  tool: "• ",
  status: "• ",
  task: "• ",
  system: "  ",
};

function renderCommandOutput(output: CommandOutput): React.ReactNode {
  const allRows = output.sections.flat();
  const colWidth =
    allRows.length > 0
      ? Math.max(COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH, ...allRows.map(([key]) => `${key}:`.length + 1))
      : COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH;
  return (
    <>
      <Text>{output.header}</Text>
      {output.sections.map((section) => (
        <React.Fragment key={section.map(([k]) => k).join(",")}>
          {"\n\n"}
          {section.map(([key, value], ri) => (
            <React.Fragment key={key}>
              {ri > 0 ? "\n" : null}
              <Text dimColor>{`${key}:`.padEnd(colWidth)}</Text>
              <Text>{value}</Text>
            </React.Fragment>
          ))}
        </React.Fragment>
      ))}
      {output.list && output.list.length > 0 && (
        <>
          {"\n\n"}
          {output.list.map((line, i) => (
            <React.Fragment key={line}>
              {i > 0 ? "\n" : null}
              <Text>{line}</Text>
            </React.Fragment>
          ))}
        </>
      )}
    </>
  );
}

function renderSystemContent(content: string): React.ReactNode {
  return content;
}

function renderToolPart(
  part: ToolOutputPart,
  index: number,
  lineNumWidth: number,
  toolContentWidth: number,
): React.ReactNode {
  if (part.kind === "diff") {
    const num = String(part.lineNumber).padStart(lineNumWidth);
    const prefix = ` ${num} `;
    const marker = part.marker === "add" ? "+" : part.marker === "remove" ? "-" : " ";
    const content = `${part.text}`;
    const padWidth = Math.max(0, toolContentWidth - 2 - prefix.length - 1 - content.length);
    const padded = content + " ".repeat(padWidth);
    if (part.marker === "add")
      return (
        <Text key={`tool-${index}`}>
          {"\n  "}
          <Text backgroundColor={palette.diffAdd}>
            <Text color={palette.diffAddText}>
              {prefix}
              {marker}
            </Text>
            <Text color="white">{padded}</Text>
          </Text>
        </Text>
      );
    if (part.marker === "remove")
      return (
        <Text key={`tool-${index}`}>
          {"\n  "}
          <Text backgroundColor={palette.diffRemove}>
            <Text color={palette.diffRemoveText}>
              {prefix}
              {marker}
            </Text>
            <Text color="white">{padded}</Text>
          </Text>
        </Text>
      );
    return (
      <Text key={`tool-${index}`}>
        {"\n  "}
        <Text dimColor>{prefix} </Text>
        <Text color="white">{content}</Text>
      </Text>
    );
  }
  if (part.kind === "shell-output") {
    return (
      <Text key={`tool-${index}`}>
        {"\n  "}
        <Text dimColor color={part.stream === "stderr" ? palette.red : undefined}>
          {part.text}
        </Text>
      </Text>
    );
  }
  const text = renderToolOutputText(part);
  if (part.kind === "truncated" && lineNumWidth > 0) {
    return (
      <Text key={`tool-${index}`}>
        {"\n  "}
        <Text dimColor>{` ${"…".padStart(lineNumWidth)}  ${text.slice(2)}`}</Text>
      </Text>
    );
  }
  return (
    <Text key={`tool-${index}`}>
      {"\n  "}
      <Text dimColor>{text}</Text>
    </Text>
  );
}

function renderHeader(part: ToolOutputPart): React.ReactNode {
  if (part.kind === "edit-header") {
    return (
      <>
        <Text bold>{part.label} </Text>
        <Text dimColor>{part.path} (</Text>
        <Text color={palette.diffAddText}>{`+${part.added}`}</Text>
        <Text dimColor> </Text>
        <Text color={palette.diffRemoveText}>{`-${part.removed}`}</Text>
        <Text dimColor>)</Text>
      </>
    );
  }
  const text = renderToolOutputText(part);
  return <Text dimColor>{text}</Text>;
}

function renderToolOutput(parts: ToolOutputPart[], toolContentWidth: number): React.ReactNode {
  const [first, ...rest] = parts;
  if (!first) return null;
  const lineNumWidth = parts.reduce(
    (max, part) => (part.kind === "diff" ? Math.max(max, String(part.lineNumber).length) : max),
    0,
  );
  return (
    <>
      {renderHeader(first)}
      {rest.map((part, i) => renderToolPart(part, i, lineNumWidth, toolContentWidth))}
    </>
  );
}

type ChatTranscriptRowProps = {
  row: ChatRow;
  contentWidth: number;
  toolContentWidth: number;
};

export function ChatTranscriptRow({ row, contentWidth, toolContentWidth }: ChatTranscriptRowProps): React.ReactNode {
  const marker = MARKERS[row.kind];
  const markerColor = row.style?.marker ?? (row.kind === "assistant" ? palette.brand : undefined);
  const textColor = row.style?.text ?? (row.kind === "assistant" && !row.style?.dim ? palette.brand : undefined);
  const dim = row.style?.dim ?? false;
  return (
    <Box>
      <Box width={2}>
        <Text color={markerColor}>{marker}</Text>
      </Box>
      <Box width={row.kind === "tool" ? toolContentWidth : contentWidth}>
        {isToolOutput(row.content) ? (
          <Text>{renderToolOutput(row.content.parts, toolContentWidth)}</Text>
        ) : isCommandOutput(row.content) ? (
          <Text>{renderCommandOutput(row.content)}</Text>
        ) : row.kind === "assistant" ? (
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
}

type ChatTranscriptProps = {
  rows: ChatRow[];
  pendingState?: PendingState | null;
  thinkingFrame: number;
  queuedMessages?: string[];
  thinkingStartedAt?: number | null;
  runningUsage?: { inputTokens: number; outputTokens: number } | null;
};

const MAX_TRANSCRIPT_WIDTH = 120;

export function ChatTranscript(props: ChatTranscriptProps): React.ReactNode {
  const { rows, pendingState, thinkingFrame, thinkingStartedAt, runningUsage } = props;
  const pulsePeriod = 16;
  const hasContent = rows.length > 0 || (pendingState !== null && pendingState !== undefined);
  const isQueued = pendingState?.kind === "queued";
  const isAccepted = pendingState?.kind === "accepted";
  const isRunning = pendingState?.kind === "running";
  const isWorking = pendingState !== null && pendingState !== undefined;
  const elapsedSec =
    isRunning && typeof thinkingStartedAt === "number"
      ? Math.max(0, Math.floor((Date.now() - thinkingStartedAt) / 1000))
      : 0;
  const runningBlinkOn = Math.abs(thinkingFrame) % pulsePeriod < pulsePeriod / 2;
  const pulseGlyph = isRunning ? (runningBlinkOn ? "•" : " ") : "•";
  const indicatorColor: string = isQueued ? palette.queued : isAccepted ? palette.accepted : palette.running;
  const tokenText = runningUsage ? formatTokenCount(runningUsage.inputTokens + runningUsage.outputTokens) : "";
  const thinkingText = (() => {
    if (!pendingState) return "";
    const timeText = elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`;
    if (pendingState.kind === "running") {
      const stage = pendingState.skill
        ? `${t("chat.skill.label")}: ${pendingState.skill}`
        : MODE_PENDING_TEXT[pendingState.mode];
      const model = pendingState.model ?? "";
      const details = [timeText, model, tokenText].filter((part) => part.length > 0).join(" · ");
      return details.length > 0 ? `${stage} (${details})` : stage;
    }
    if (pendingState.kind === "queued") {
      const pos = pendingState.position;
      return typeof pos === "number" ? t("rpc.status.queued", { position: pos }) : t("rpc.status.queued.unknown");
    }
    if (pendingState.kind === "accepted") {
      return t("rpc.status.accepted");
    }
    return "";
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
          <ChatTranscriptRow row={row} contentWidth={contentWidth} toolContentWidth={toolContentWidth} />
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
