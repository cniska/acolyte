import React from "react";
import { renderAssistantContent } from "./chat-content-render";
import type { ChatRow } from "./chat-contract";
import { palette } from "./palette";
import { renderToolOutput as renderToolOutputText, type ToolOutput } from "./tool-output-content";
import { Box, Text } from "./tui";

const MARKERS: Record<ChatRow["role"], string> = {
  user: "❯ ",
  assistant: "• ",
  tool: "• ",
  status: "• ",
  task: "• ",
  system: "  ",
};

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

export function parseStatusLine(line: string): { indent: string; key: string; value: string } | null {
  const match = line.match(/^(\s*)([a-zA-Z0-9_.-]+:\s*)(.*)$/);
  if (!match) return null;
  return {
    indent: match[1] ?? "",
    key: match[2] ?? "",
    value: match[3] ?? "",
  };
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
  return renderSessionsListContent(content) ?? renderKeyValueContent(content) ?? content;
}

function renderToolLine(
  item: ToolOutput,
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

function renderHeaderDetail(item: ToolOutput, detail: string): React.ReactNode {
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

function renderToolBlock(items: ToolOutput[], toolContentWidth: number): React.ReactNode {
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

type ChatRowViewProps = {
  row: ChatRow;
  contentWidth: number;
  toolContentWidth: number;
};

export function ChatRowView({ row, contentWidth, toolContentWidth }: ChatRowViewProps): React.ReactNode {
  const marker = MARKERS[row.role];
  const markerColor = row.style?.marker ?? (row.role === "assistant" ? palette.brand : undefined);
  const textColor = row.style?.text ?? (row.role === "assistant" && !row.style?.dim ? palette.brand : undefined);
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
}
