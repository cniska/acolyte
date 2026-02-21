import { Box, Text } from "ink";
import type React from "react";

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
        {logo.map((parts) => (
          <Text key={parts.map((part) => `${part.color}:${part.text}`).join("|")}>
            {parts.map((part) => (
              <Text key={`${part.color}:${part.text}`} color={part.color}>
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
