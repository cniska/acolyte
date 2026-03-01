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
  const title = lines.find((line) => line.id === "title");
  const session = lines.find((line) => line.id === "session");
  const context = lines.find((line) => line.id === "context");
  const logoColumnWidth = 11;
  const renderMetaLine = (text: string | undefined): React.ReactNode => {
    if (!text) return <Text dimColor />;
    const match = text.match(/^(\S+\s+)(.*)$/);
    if (!match) return <Text color="white">{text}</Text>;
    return (
      <>
        <Text dimColor>{match[1] ?? ""}</Text>
        <Text color="white">{match[2] ?? ""}</Text>
      </>
    );
  };

  const rows: { key: string; logo: React.ReactNode; text: React.ReactNode }[] = [
    {
      key: "title",
      logo: <Text color={logoColor}>{"  ▗█████▖  "}</Text>,
      text: (
        <>
          <Text color={brandColor}>
            {title?.text ?? ""}
          </Text>
          <Text color={brandColor} dimColor>
            {title?.suffix ?? ""}
          </Text>
        </>
      ),
    },
    {
      key: "session",
      logo: (
        <>
          <Text color={logoColor}>{" ▟█ "}</Text>
          <Text color={logoEyeColor}>{"● ●"}</Text>
          <Text color={logoColor}>{" █▙ "}</Text>
        </>
      ),
      text: renderMetaLine(session?.text),
    },
    {
      key: "context",
      logo: <Text color={logoColor}>{" ▜█▄▄▄▄▄█▛ "}</Text>,
      text: renderMetaLine(context?.text),
    },
  ];

  return (
    <>
      {rows.map((row) => (
        <Box key={row.key}>
          <Text> </Text>
          <Box width={logoColumnWidth}>{row.logo}</Box>
          <Text> </Text>
          {row.text}
        </Box>
      ))}
    </>
  );
}
