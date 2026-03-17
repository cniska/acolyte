import React from "react";
import { renderAssistantContent } from "./chat-content-render";
import type { ChatEntry, CommandOutput } from "./chat-contract";
import { isCommandOutput, isToolOutput } from "./chat-contract";
import { COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH } from "./chat-format";
import { palette } from "./palette";
import { renderToolOutputPart as renderToolOutputText, type ToolOutputPart } from "./tool-output-content";
import { Box, Text } from "./tui";

const MARKERS: Record<ChatEntry["kind"], string> = {
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

function renderToolLine(
  item: ToolOutputPart,
  index: number,
  lineNumWidth: number,
  toolContentWidth: number,
): React.ReactNode {
  if (item.kind === "diff") {
    const num = String(item.lineNumber).padStart(lineNumWidth);
    const prefix = ` ${num} `;
    const marker = item.marker === "add" ? "+" : item.marker === "remove" ? "-" : " ";
    const content = `${item.text}`;
    const padWidth = Math.max(0, toolContentWidth - 2 - prefix.length - 1 - content.length);
    const padded = content + " ".repeat(padWidth);
    if (item.marker === "add")
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
    if (item.marker === "remove")
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
  if (item.kind === "shell-output") {
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
  if (item.kind === "truncated" && lineNumWidth > 0) {
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

function renderHeaderDetail(item: ToolOutputPart, detail: string): React.ReactNode {
  if (item.kind === "edit-header") {
    const match = detail.match(/^(.*)\((\+\d+) (-\d+)\)$/);
    if (match) {
      return (
        <>
          <Text dimColor>{match[1]}(</Text>
          <Text color={palette.diffAddText}>{match[2]}</Text>
          <Text dimColor> </Text>
          <Text color={palette.diffRemoveText}>{match[3]}</Text>
          <Text dimColor>)</Text>
        </>
      );
    }
  }
  return <Text dimColor>{detail}</Text>;
}

function renderToolOutput(items: ToolOutputPart[], toolContentWidth: number): React.ReactNode {
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
          {renderHeaderDetail(first, text.slice(label.length))}
        </>
      ) : (
        <Text>{text}</Text>
      )}
      {items.slice(1).map((item, i) => renderToolLine(item, i, lineNumWidth, toolContentWidth))}
    </>
  );
}

type ChatRowProps = {
  row: ChatEntry;
  contentWidth: number;
  toolContentWidth: number;
};

export function ChatRow({ row, contentWidth, toolContentWidth }: ChatRowProps): React.ReactNode {
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
