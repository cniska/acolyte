import React from "react";
import { wrapText } from "./chat-content";
import { renderAssistantContent } from "./chat-content-render";
import type { ChatRow, CommandOutput } from "./chat-contract";
import { isCommandOutput, isToolOutput } from "./chat-contract";
import { commandOutputColWidth, formatCompactNumber } from "./chat-format";
import { ShimmerText } from "./chat-shimmer";
import type { PendingState } from "./client-contract";
import { t } from "./i18n";
import { palette } from "./palette";
import type { ToolOutputPart } from "./tool-output-contract";
import { renderToolOutput as renderToolOutputText, resolveHeader } from "./tool-output-render";
import { truncateToWidth } from "./truncate-text";
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

// Columns of the leading "\n  " indent every tool body line renders with; width budgets
// subtract it so a truncated line plus its indent still fits toolContentWidth.
const TOOL_LINE_INDENT = 2;

function renderToolPart(
  part: ToolOutputPart,
  index: number,
  lineNumWidth: number,
  toolContentWidth: number,
  diffIndent: string,
): React.ReactNode {
  if (part.kind === "diff") {
    const num = String(part.lineNumber).padStart(lineNumWidth);
    const prefix = ` ${num} `;
    const marker = part.marker === "add" ? "+" : part.marker === "remove" ? "-" : " ";
    // Cut the content to the display budget (indent + gutter prefix + 1-col marker) before
    // padding, so the colored bar still fills the width but the line never overflows and wraps.
    const budget = Math.max(0, toolContentWidth - TOOL_LINE_INDENT - diffIndent.length - prefix.length - 1);
    const content = truncateToWidth(part.text, budget);
    const padWidth = Math.max(0, budget - Bun.stringWidth(content));
    const padded = content + " ".repeat(padWidth);
    if (part.marker === "add" || part.marker === "remove") {
      const bg = part.marker === "add" ? palette.diffAdd : palette.diffRemove;
      const fg = part.marker === "add" ? palette.diffAddText : palette.diffRemoveText;
      return (
        <Text key={`tool-${index}`}>
          {`\n  ${diffIndent}`}
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
        {`\n  ${diffIndent}`}
        <Text dimColor>{prefix} </Text>
        <Text color={palette.text}>{content}</Text>
      </Text>
    );
  }
  if (part.kind === "shell-output") {
    return (
      <Text key={`tool-${index}`}>
        {"\n  "}
        <Text dimColor>{truncateToWidth(part.text, toolContentWidth - TOOL_LINE_INDENT)}</Text>
      </Text>
    );
  }
  const text = renderToolOutputText(part);
  if (lineNumWidth > 0) {
    if (part.kind === "text") {
      return (
        <Text key={`tool-${index}`}>
          {"\n  "}
          <Text dimColor>{truncateToWidth(text, toolContentWidth - TOOL_LINE_INDENT)}</Text>
        </Text>
      );
    }
    const indent = part.kind === "truncated" ? diffIndent : "";
    const display =
      part.kind === "truncated"
        ? `${"⋮".padStart(lineNumWidth)}  ${text.slice(2)}`
        : `${" ".repeat(lineNumWidth + 2)}${text}`;
    return (
      <Text key={`tool-${index}`}>
        {"\n  "}
        <Text dimColor>{truncateToWidth(`${indent} ${display}`, toolContentWidth - TOOL_LINE_INDENT)}</Text>
      </Text>
    );
  }
  return (
    <Text key={`tool-${index}`}>
      {"\n  "}
      <Text dimColor>{truncateToWidth(text, toolContentWidth - TOOL_LINE_INDENT)}</Text>
    </Text>
  );
}

function renderHeaderMeta(meta: Record<string, unknown>): React.ReactNode {
  if ("added" in meta && "removed" in meta) {
    return (
      <>
        <Text dimColor> (</Text>
        <Text color={palette.diffAddText}>{`+${meta.added}`}</Text>
        <Text dimColor> </Text>
        <Text color={palette.diffRemoveText}>{`-${meta.removed}`}</Text>
        <Text dimColor>)</Text>
      </>
    );
  }
  return null;
}

function renderHeader(part: ToolOutputPart): React.ReactNode {
  const header = resolveHeader(part);
  if (!header) return null;
  return (
    <>
      <Text bold>{header.label}</Text>
      {header.detail ? <Text dimColor>{` ${header.detail}`}</Text> : null}
      {header.meta ? renderHeaderMeta(header.meta) : null}
    </>
  );
}

function renderToolOutput(parts: ToolOutputPart[], toolContentWidth: number): React.ReactNode {
  const [first, ...rest] = parts;
  if (!first) return null;
  const lineNumWidth = parts.reduce(
    (max, part) => (part.kind === "diff" ? Math.max(max, String(part.lineNumber).length) : max),
    0,
  );
  // Multi-file edits interleave per-file sub-headers (text) with diff lines; nest the
  // diffs 2 columns under their sub-header, mirroring the CLI's 2-col nest (tool-output-render
  // `hasFileHeaders`). The absolute column still differs by chat's leading-space gutter.
  const diffIndent = lineNumWidth > 0 && rest.some((part) => part.kind === "text") ? "  " : "";
  return (
    <>
      {renderHeader(first)}
      {rest.map((part, i) => renderToolPart(part, i, lineNumWidth, toolContentWidth, diffIndent))}
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
  const isAnimated = kind === "running";
  const blinkOn = Math.abs(pendingFrame) % pulsePeriod < pulsePeriod / 2;
  const marker = isAnimated && !blinkOn ? " " : "•";
  const markerColor = kind ? PENDING_MARKER_COLORS[kind] : "";
  const tokenText = runningUsage
    ? t("unit.token.arrows", {
        input: formatCompactNumber(runningUsage.inputTokens),
        output: formatCompactNumber(runningUsage.outputTokens),
      })
    : "";
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
