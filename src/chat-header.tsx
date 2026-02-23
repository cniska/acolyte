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
  const logoColumnWidth = 10;
  const logoTop = "  ▗████▖  ";
  const logoMiddleLeft = " ▟█";
  const logoMiddleEyes = "●  ●";
  const logoMiddleRight = "█▙ ";
  const logoBottom = " ▜█▄▄▄▄█▛ ";

  return (
    <>
      <Box>
        <Box width={logoColumnWidth}>
          <Text color={logoColor}>{logoTop}</Text>
        </Box>
        <Text>  </Text>
        <Text color={brandColor} bold>{`${title?.text ?? ""}${title?.suffix ?? ""}`}</Text>
      </Box>
      <Box>
        <Box width={logoColumnWidth}>
          <Text color={logoColor}>{logoMiddleLeft}</Text>
          <Text color={logoEyeColor}>{logoMiddleEyes}</Text>
          <Text color={logoColor}>{logoMiddleRight}</Text>
        </Box>
        <Text>  </Text>
        <Text dimColor={Boolean(session?.dim)}>{session?.text ?? ""}</Text>
      </Box>
      <Box>
        <Box width={logoColumnWidth}>
          <Text color={logoColor}>{logoBottom}</Text>
        </Box>
        <Text>  </Text>
        <Text dimColor={Boolean(cwd?.dim)}>{cwd?.text ?? ""}</Text>
      </Box>
    </>
  );
}
