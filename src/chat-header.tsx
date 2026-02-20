import { Box, Text } from "ink";
import React from "react";

type HeaderLine = {
  id: string;
  text: string;
  suffix?: string;
  dim: boolean;
  brand: boolean;
};

type ChatHeaderProps = {
  lines: HeaderLine[];
  brandColor: string;
};

export function ChatHeader(props: ChatHeaderProps): React.ReactNode {
  const { lines, brandColor } = props;
  return (
    <Box flexDirection="column">
      {lines.map((line) => (
        <Text key={line.id} dimColor={line.dim} color={line.brand ? brandColor : undefined}>
          {line.id === "title" ? (
            <>
              <Text bold>{line.text}</Text>
              <Text dimColor>{line.suffix}</Text>
            </>
          ) : (
            line.text
          )}
        </Text>
      ))}
    </Box>
  );
}
