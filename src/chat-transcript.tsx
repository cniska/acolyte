import React from "react";
import { wrapText } from "./chat-content";
import { renderAssistantContent } from "./chat-content-render";
import type { ChatRow, CommandOutput } from "./chat-contract";
import { isCommandOutput, isToolOutput } from "./chat-contract";
import { commandOutputColWidth, formatCommandOutput, formatCompactNumber } from "./chat-format";
import { rowMarker } from "./chat-row-marker";
import { ShimmerText } from "./chat-shimmer";
import type { TranscriptRow } from "./chat-transcript-contract";
import type { PendingState } from "./client-contract";
import { t } from "./i18n";
import { palette } from "./palette";
import {
  layoutTranscriptMessage,
  layoutTranscriptText,
  layoutTranscriptTool,
  transcriptOutcomeRole,
} from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { renderToolOutputTui } from "./tool-output-tui";
import { Box, Text } from "./tui";
import { DEFAULT_COLUMNS } from "./tui/constants";

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

type ChatTranscriptRowProps = {
  row: ChatRow;
  contentWidth: number;
  toolContentWidth: number;
  presentation?: TranscriptRow;
};

export function ChatTranscriptRow({
  row,
  contentWidth,
  toolContentWidth,
  presentation,
}: ChatTranscriptRowProps): React.ReactNode {
  if (
    presentation &&
    (presentation.kind === "user" || presentation.kind === "assistant") &&
    presentation.content.kind === "message"
  ) {
    return (
      <TerminalSceneRender
        scene={layoutTranscriptMessage({
          text: presentation.content.text,
          kind: presentation.kind,
          columns: contentWidth + 2,
        })}
      />
    );
  }
  if (presentation?.kind === "tool" && presentation.content.kind === "tool-output") {
    return (
      <TerminalSceneRender
        scene={layoutTranscriptTool({
          parts: presentation.content.output.parts,
          lifecycle: presentation.lifecycle,
          columns: contentWidth + 2,
        })}
      />
    );
  }
  if (presentation?.content.kind === "command-output") {
    const body = formatCommandOutput(presentation.content.output);
    return (
      <TerminalSceneRender
        scene={layoutTranscriptText({
          text: body ? `${presentation.content.output.header}\n\n${body}` : presentation.content.output.header,
          marker: presentation.kind === "system" ? "  " : "• ",
          markerRole: presentation.kind === "system" ? "muted" : "plain",
          textRole: presentation.kind === "system" ? "muted" : "plain",
          columns: contentWidth + 2,
        })}
      />
    );
  }
  if (presentation && presentation.content.kind === "message") {
    const marker =
      presentation.kind === "system"
        ? "  "
        : presentation.kind === "status" || presentation.kind === "task"
          ? "• "
          : null;
    if (marker) {
      return (
        <TerminalSceneRender
          scene={layoutTranscriptText({
            text: presentation.content.text,
            marker,
            markerRole: presentation.kind === "system" ? "muted" : transcriptOutcomeRole(presentation.lifecycle),
            textRole: "muted",
            columns: contentWidth + 2,
          })}
        />
      );
    }
  }
  const { glyph, color } = rowMarker(row);
  const textColor = row.style?.text;
  const dim = row.style?.dim ?? false;
  return (
    <Box>
      <Box width={2}>
        <Text color={color}>{glyph}</Text>
      </Box>
      <Box width={row.kind === "tool" ? toolContentWidth : contentWidth}>
        {isToolOutput(row.content) ? (
          <Text>{renderToolOutputTui(row.content.parts, toolContentWidth)}</Text>
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
  presentation?: TranscriptRow[];
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
          <ChatTranscriptRow
            row={row}
            contentWidth={contentWidth}
            toolContentWidth={toolContentWidth}
            presentation={props.presentation?.find((presentation) => presentation.id === row.id)}
          />
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
