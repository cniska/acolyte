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
  const cwd = lines.find((line) => line.id === "cwd");
  const logoColumnWidth = 11;

  const rows: { key: string; logo: React.ReactNode; text: React.ReactNode }[] = [
    {
      key: "title",
      logo: <Text color={logoColor}>{"  ▗█████▖  "}</Text>,
      text: (
        <>
          <Text color={brandColor} bold>
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
      text: <Text dimColor={Boolean(session?.dim)}>{session?.text ?? ""}</Text>,
    },
    {
      key: "cwd",
      logo: <Text color={logoColor}>{" ▜█▄▄▄▄▄█▛ "}</Text>,
      text: <Text dimColor={Boolean(cwd?.dim)}>{cwd?.text ?? ""}</Text>,
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
