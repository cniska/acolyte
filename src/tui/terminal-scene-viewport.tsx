import React from "react";
import type { TerminalScene } from "../terminal-scene-contract";
import { terminalTheme } from "../terminal-theme";
import { Text } from "./components";
import { fitSceneViewport, type SceneViewportConstraints, sceneCursorPlacement } from "./scene-viewport";

export function TerminalSceneViewport({
  scene,
  constraints,
}: {
  scene: TerminalScene;
  constraints: SceneViewportConstraints;
}): React.ReactNode {
  const viewport = fitSceneViewport(scene, constraints);
  sceneCursorPlacement(scene, viewport.liveLineStart);
  const lines = scene.lines.slice(viewport.liveLineStart);
  return (
    <Text>
      {lines.map((line, lineIndex) => (
        <React.Fragment key={line.spans.map((span) => `${span.role}:${span.text}`).join("|")}>
          {lineIndex > 0 ? "\n" : null}
          {line.spans.map((span) => {
            const style = terminalTheme.styles[span.role];
            return (
              <Text
                key={`${span.role}-${span.text}`}
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
      ))}
    </Text>
  );
}
