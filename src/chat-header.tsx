import type React from "react";
import { palette } from "./palette";
import { Box, Text } from "./tui";

export type HeaderLine = {
  id: string;
  text: string;
  suffix?: string;
};

type ChatHeaderProps = {
  lines: HeaderLine[];
  brandColor: string;
  mascot: string;
  mascotEyes: string;
};

export function ChatHeader(props: ChatHeaderProps): React.ReactNode {
  const { lines, brandColor, mascot, mascotEyes } = props;
  const title = lines.find((line) => line.id === "title");
  const session = lines.find((line) => line.id === "session");
  const context = lines.find((line) => line.id === "context");
  const logoColumnWidth = 11;
  const renderMetaLine = (text: string | undefined): React.ReactNode => {
    if (!text) return <Text dimColor />;
    const [key, ...rest] = text.split(" ");
    if (rest.length === 0) return <Text color={palette.text}>{text}</Text>;
    return (
      <>
        <Text dimColor>{key} </Text>
        <Text color={palette.text}>{rest.join(" ")}</Text>
      </>
    );
  };

  const rows: { key: string; logo: React.ReactNode; text: React.ReactNode }[] = [
    {
      key: "title",
      logo: <Text color={mascot}>{"  ▗█████▖  "}</Text>,
      text: (
        <>
          <Text color={brandColor}>{title?.text ?? ""}</Text>
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
          <Text color={mascot}>{" ▟█ "}</Text>
          <Text color={mascotEyes}>{"● ●"}</Text>
          <Text color={mascot}>{" █▙ "}</Text>
        </>
      ),
      text: renderMetaLine(session?.text),
    },
    {
      key: "context",
      logo: <Text color={mascot}>{" ▜█▄▄▄▄▄█▛ "}</Text>,
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
