import React from "react";
import type { ChatRow } from "./chat-contract";
import { isChecklistOutput } from "./chat-contract";
import type { ChecklistOutput } from "./checklist-contract";
import { formatChecklist } from "./checklist-format";
import { Box, Text } from "./tui";
import { DEFAULT_COLUMNS } from "./tui/styles";

function renderChecklist(output: ChecklistOutput): React.ReactNode {
  const { header, items } = formatChecklist(output);
  return (
    <>
      <Text bold>{header}</Text>
      {items.map((item) => (
        <React.Fragment key={item.id}>
          {"\n"}
          <Text dimColor>{`  ${item.marker} ${item.label}`}</Text>
        </React.Fragment>
      ))}
    </>
  );
}

type ChatChecklistProps = {
  rows: ChatRow[];
};

export function ChatChecklist({ rows }: ChatChecklistProps): React.ReactNode {
  if (rows.length === 0) return null;
  const columns = process.stdout.columns ?? DEFAULT_COLUMNS;
  const contentWidth = Math.max(24, columns - 2);
  return (
    <>
      {rows.map((row) => (
        <React.Fragment key={row.id}>
          <Text> </Text>
          <Box width={contentWidth}>
            {isChecklistOutput(row.content) ? <Text>{renderChecklist(row.content)}</Text> : null}
          </Box>
        </React.Fragment>
      ))}
    </>
  );
}
