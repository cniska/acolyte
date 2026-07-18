import type React from "react";
import { unreachable } from "./assert";
import { palette } from "./palette";
import type { ToolOutputPart } from "./tool-output-contract";
import { fitLine, type LayoutLine, type LayoutSegment, layoutToolOutput, segmentsWidth } from "./tool-output-layout";
import { Text } from "./tui";

function styledSegment(segment: LayoutSegment, key: string): React.ReactNode {
  switch (segment.role) {
    case "label":
      return (
        <Text key={key} bold>
          {segment.text}
        </Text>
      );
    case "meta-add":
      return (
        <Text key={key} color={palette.diffAddText}>
          {segment.text}
        </Text>
      );
    case "meta-remove":
      return (
        <Text key={key} color={palette.diffRemoveText}>
          {segment.text}
        </Text>
      );
    case "diff-text":
      return (
        <Text key={key} color={palette.text}>
          {segment.text}
        </Text>
      );
    case "detail":
    case "meta-punct":
    case "dim":
    case "diff-gutter":
      return (
        <Text key={key} dimColor>
          {segment.text}
        </Text>
      );
    case "stream-tag":
      return null;
    default:
      return unreachable(segment.role);
  }
}

function renderFilledLine(line: LayoutLine, index: number, width: number): React.ReactNode {
  const fill = line.fill;
  if (!fill) return null;
  const bg = fill === "diff-add" ? palette.diffAdd : palette.diffRemove;
  const fg = fill === "diff-add" ? palette.diffAddText : palette.diffRemoveText;
  const pad = " ".repeat(Math.max(0, width - line.indent - segmentsWidth(line.segments)));
  return (
    <Text key={`tool-${index}`}>
      {`\n${" ".repeat(line.indent)}`}
      <Text backgroundColor={bg}>
        {line.segments.map((segment) => (
          <Text
            key={`${index}-${segment.role}-${segment.text}`}
            color={segment.role === "diff-gutter" ? fg : palette.text}
          >
            {segment.text}
          </Text>
        ))}
        <Text color={palette.text}>{pad}</Text>
      </Text>
    </Text>
  );
}

function renderLine(line: LayoutLine, index: number, width: number): React.ReactNode {
  const visible = { ...line, segments: line.segments.filter((segment) => segment.role !== "stream-tag") };
  const fitted = fitLine(visible, width);
  if (fitted.fill) return renderFilledLine(fitted, index, width);
  return (
    <Text key={`tool-${index}`}>
      {index === 0 ? "" : `\n${" ".repeat(fitted.indent)}`}
      {fitted.segments.map((segment) => styledSegment(segment, `${index}-${segment.role}-${segment.text}`))}
    </Text>
  );
}

export function renderToolOutputTui(parts: ToolOutputPart[], width: number): React.ReactNode {
  const lines = layoutToolOutput(parts);
  if (lines.length === 0) return null;
  return <>{lines.map((line, index) => renderLine(line, index, width))}</>;
}
