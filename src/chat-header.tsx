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
  logoColor: string;
  logoEyeColor: string;
};

export function ChatHeader(props: ChatHeaderProps): React.ReactNode {
  const { lines, brandColor, logoColor, logoEyeColor } = props;
  const logo = [
    [{ text: "   ▗████▖", color: logoColor }],
    [
      { text: "  ▟█", color: logoColor },
      { text: "●  ●", color: logoEyeColor },
      { text: "█▙", color: logoColor },
    ],
    [{ text: "  ▜█▄▄▄▄█▛", color: logoColor }],
  ] as const;

  return (
    <Box>
      <Box flexDirection="column" marginRight={2}>
        {logo.map((parts, index) => (
          <Text key={`logo-${index}`}>
            {parts.map((part, partIndex) => (
              <Text key={`logo-${index}-${partIndex}`} color={part.color}>
                {part.text}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
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
    </Box>
  );
}
