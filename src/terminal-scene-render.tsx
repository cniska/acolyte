import React from "react";
import type { TerminalScene } from "./terminal-scene-contract";
import { terminalTheme } from "./terminal-theme";
import { Text } from "./tui";

export function TerminalSceneRender({ scene }: { scene: TerminalScene }): React.ReactNode {
  return scene.lines.map((line, lineIndex) => (
    <React.Fragment key={line.spans.map((span) => `${span.role}:${span.text}`).join("|")}>
      {lineIndex > 0 ? "\n" : null}
      {line.spans.map((span) => {
        const style = terminalTheme.styles[span.role];
        return (
          <Text
            key={`${span.role}:${span.text}`}
            color={style.foreground}
            backgroundColor={style.background}
            bold={style.bold}
            dimColor={style.dim}
            inverse={style.inverse}
          >
            {span.text}
          </Text>
        );
      })}
    </React.Fragment>
  ));
}
