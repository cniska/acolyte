import React from "react";
import type { ChatRow } from "./chat-contract";
import { formatTokenCount } from "./chat-format";
import { ChatRowView } from "./chat-row";
import { ShimmerText } from "./chat-shimmer";
import { palette } from "./palette";
import { Box, Text } from "./tui";

export { parseStatusLine } from "./chat-row";

type ChatTranscriptProps = {
  rows: ChatRow[];
  isWorking: boolean;
  progressText?: string | null;
  thinkingFrame: number;
  queuedMessages?: string[];
  thinkingStartedAt?: number | null;
  runningUsage?: { inputTokens: number; outputTokens: number } | null;
};

const MAX_TRANSCRIPT_WIDTH = 120;

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
  const tokenText = runningUsage ? formatTokenCount(runningUsage.inputTokens + runningUsage.outputTokens) : "";
  const thinkingText = (() => {
    const timeText = elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`;
    if (stageMatch) {
      const stage = stageMatch[1]?.trim() ?? "";
      const model = stageMatch[2]?.trim() || "";
      const details = [timeText, model, tokenText].filter((part) => part.length > 0).join(" · ");
      return details.length > 0 ? `${stage} (${details})` : stage;
    }
    const parts = [trimmedProgressText, timeText, tokenText].filter((part) => part.length > 0);
    return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(" · ")})` : (parts[0] ?? "");
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
          <ChatRowView row={row} contentWidth={contentWidth} toolContentWidth={toolContentWidth} />
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
