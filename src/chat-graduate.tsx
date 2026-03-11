import { renderToString } from "ink";
import React from "react";
import type { HeaderLine } from "./chat-header";
import { ChatHeader } from "./chat-header";

export function graduateHeader(
  headerLines: HeaderLine[],
  brandColor: string,
  mascot: string,
  mascotEyes: string,
  columns: number,
): void {
  const ansi = renderToString(
    <ChatHeader lines={headerLines} brandColor={brandColor} mascot={mascot} mascotEyes={mascotEyes} />,
    { columns },
  );
  process.stdout.write(`\n${ansi}\n`);
}
