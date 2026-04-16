import React from "react";
import { wrapText } from "./chat-content";
import { renderAssistantContent } from "./chat-content-render";
import type { ChatRow, CommandOutput } from "./chat-contract";
import { isCommandOutput, isToolOutput } from "./chat-contract";
import { commandOutputColWidth, formatTokenCount } from "./chat-format";
import { ShimmerText } from "./chat-shimmer";
import type { PendingState } from "./client-contract";
import { t, tDynamic } from "./i18n";
import { palette } from "./palette";
import type { ToolOutputPart } from "./tool-output-contract";
import { renderToolOutputPart as renderToolOutputText } from "./tool-output-render";
import { Box, Text } from "./tui";
import { DEFAULT_COLUMNS } from "./tui/constants";

const MARKERS: Record<ChatRow["kind"], string> = {
  user: "❯ ",
  assistant: "• ",
  tool: "• ",
  status: "• ",
  task: "• ",
  system: "  ",
};

const PENDING_MARKER_COLORS: Record<PendingState["kind"], string> = {
  "awaiting-input": palette.brand,
  queued: palette.queued,
  accepted: palette.accepted,
  running: palette.running,
};

function renderCommandOutput(output: CommandOutput): React.ReactNode {
  const colWidth = commandOutputColWidth(output.sections);
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
    if (part.marker === "add" || part.marker === "remove") {
      const bg = part.marker === "add" ? palette.diffAdd : palette.diffRemove;
      const fg = part.marker === "add" ? palette.diffAddText : palette.diffRemoveText;
      return (
        <Text key={`tool-${index}`}>
          {"\n  "}
          <Text backgroundColor={bg}>
            <Text color={fg}>
              {prefix}
              {marker}
            </Text>
            <Text color={palette.text}>{padded}</Text>
          </Text>
        </Text>
      );
    }
    return (
      <Text key={`tool-${index}`}>
        {"\n  "}
        <Text dimColor>{prefix} </Text>
        <Text color={palette.text}>{content}</Text>
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
  if (lineNumWidth > 0) {
    if (part.kind === "text") {
      return (
        <Text key={`tool-${index}`}>
          {"\n  "}
          <Text dimColor>{text}</Text>
        </Text>
      );
    }
    const display =
      part.kind === "truncated"
        ? `${"⋮".padStart(lineNumWidth)}  ${text.slice(2)}`
        : `${" ".repeat(lineNumWidth + 2)}${text}`;
    return (
      <Text key={`tool-${index}`}>
        {"\n  "}
        <Text dimColor>{` ${display}`}</Text>
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
    const path = part.path === "." ? "" : part.path;
    return (
      <>
        <Text bold>{tDynamic(part.labelKey)}</Text>
        <Text dimColor>{path ? ` ${path}` : ""} (</Text>
        <Text color={palette.diffAddText}>{`+${part.added}`}</Text>
        <Text dimColor> </Text>
        <Text color={palette.diffRemoveText}>{`-${part.removed}`}</Text>
        <Text dimColor>)</Text>
      </>
    );
  }
  if (part.kind === "tool-header") {
    const detail = part.detail === "." ? undefined : part.detail;
    return (
      <>
        <Text bold>{tDynamic(part.labelKey)}</Text>
        {detail ? <Text dimColor>{` ${detail}`}</Text> : null}
      </>
    );
  }
  if (part.kind === "file-header") {
    const detail =
      part.count === 1 && part.targets.length === 1
        ? ` ${part.targets[0]}`
        : ` ${t("unit.file", { count: part.count })}`;
    return (
      <>
        <Text bold>{tDynamic(part.labelKey)}</Text>
        <Text dimColor>{detail}</Text>
      </>
    );
  }
  if (part.kind === "scope-header") {
    const scopeSuffix = part.scope !== "workspace" ? ` in ${part.scope}` : "";
    const detail =
      part.patterns.length === 1
        ? ` ${part.patterns[0]}${scopeSuffix}`
        : ` ${t("unit.pattern", { count: part.patterns.length })}${scopeSuffix}`;
    return (
      <>
        <Text bold>{tDynamic(part.labelKey)}</Text>
        <Text dimColor>{detail}</Text>
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
  const markerColor = row.style?.marker ?? (row.kind === "assistant" ? palette.text : undefined);
  const textColor = row.style?.text;
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
        ) : row.kind === "assistant" && typeof row.content === "string" ? (
          <Text dimColor={dim} color={textColor}>
            {renderAssistantContent(row.content, contentWidth)}
          </Text>
        ) : typeof row.content === "string" ? (
          <Text dimColor={dim} color={textColor}>
            {wrapText(row.content, contentWidth)}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

type ChatTranscriptProps = {
  rows: ChatRow[];
  pendingState?: PendingState | null;
  pendingFrame: number;
  queuedMessages?: string[];
  pendingStartedAt?: number | null;
  runningUsage?: { inputTokens: number; outputTokens: number } | null;
};

export function ChatTranscript(props: ChatTranscriptProps): React.ReactNode {
  const { rows, pendingState, pendingFrame, pendingStartedAt, runningUsage } = props;
  const pulsePeriod = 16;
  const kind = pendingState?.kind;
  const isPending = kind !== undefined;
  const hasContent = rows.length > 0 || isPending;
  const elapsedSec =
    kind === "running" && typeof pendingStartedAt === "number"
      ? Math.max(0, Math.floor((Date.now() - pendingStartedAt) / 1000))
      : 0;
  const isAnimated = kind === "running" || kind === "awaiting-input";
  const blinkOn = Math.abs(pendingFrame) % pulsePeriod < pulsePeriod / 2;
  const marker = isAnimated && !blinkOn ? " " : "•";
  const markerColor = kind ? PENDING_MARKER_COLORS[kind] : "";
  const tokenText = runningUsage ? formatTokenCount(runningUsage.inputTokens + runningUsage.outputTokens) : "";
  const pendingText = (() => {
    if (!pendingState) return "";
    const timeText = elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`;
    if (pendingState.kind === "running") {
      const stage = t("agent.status.working");
      const toolText =
        pendingState.toolCalls && pendingState.toolCalls > 0 ? t("unit.tool", { count: pendingState.toolCalls }) : "";
      const details = [timeText, toolText, tokenText].filter((part) => part.length > 0).join(" · ");
      return details.length > 0 ? `${stage} (${details})` : stage;
    }
    if (pendingState.kind === "queued") {
      const pos = pendingState.position;
      return typeof pos === "number" ? t("rpc.status.queued", { position: pos }) : t("rpc.status.queued.unknown");
    }
    if (pendingState.kind === "accepted") {
      return t("rpc.status.accepted");
    }
    if (pendingState.kind === "awaiting-input") {
      return t("chat.awaiting_input");
    }
    return "";
  })();
  const columns = process.stdout.columns ?? DEFAULT_COLUMNS;
  const contentWidth = Math.max(24, columns - 2);
  const toolContentWidth = contentWidth;
  return (
    <>
      {hasContent ? <Text> </Text> : null}
      {rows.map((row, index) => (
        <React.Fragment key={row.id}>
          {index > 0 ? <Text> </Text> : null}
          <ChatTranscriptRow row={row} contentWidth={contentWidth} toolContentWidth={toolContentWidth} />
        </React.Fragment>
      ))}
      {isPending ? (
        <>
          {rows.length > 0 ? <Text> </Text> : null}
          <Box>
            <Box width={2}>
              <Text color={markerColor}>{`${marker} `}</Text>
            </Box>
            <Box width={contentWidth}>
              {isAnimated ? (
                <ShimmerText text={pendingText} frame={pendingFrame} totalFrames={16} />
              ) : (
                <Text dimColor>{pendingText}</Text>
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
