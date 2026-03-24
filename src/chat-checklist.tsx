import React from "react";
import type { ChatRow } from "./chat-contract";
import { isChecklistOutput } from "./chat-contract";
import { type ChecklistOutput, checklistMarker, checklistProgress } from "./checklist-contract";
import { Box, Text } from "./tui";
import { DEFAULT_COLUMNS } from "./tui/styles";

function renderChecklist(output: ChecklistOutput): React.ReactNode {
  const sorted = [...output.items].sort((a, b) => a.order - b.order);
  const { done, total } = checklistProgress(sorted);
  return (
    <>
      <Text bold>{`${output.groupTitle} (${done}/${total})`}</Text>
      {sorted.map((item) => (
        <React.Fragment key={item.id}>
          {"\n"}
          <Text dimColor>{`  ${checklistMarker(item.status)} ${item.label}`}</Text>
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
          <Box>
            <Box width={2}>
              <Text>{"  "}</Text>
            </Box>
            <Box width={contentWidth}>
              {isChecklistOutput(row.content) ? <Text>{renderChecklist(row.content)}</Text> : null}
            </Box>
          </Box>
        </React.Fragment>
      ))}
    </>
  );
}
