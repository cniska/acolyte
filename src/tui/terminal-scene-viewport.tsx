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
  const lineOccurrences = new Map<string, number>();
  return (
    <Text>
      {lines.map((line, lineIndex) => {
        const lineSignature = line.spans.map((span) => `${span.role}:${span.text}`).join("|");
        const lineOccurrence = lineOccurrences.get(lineSignature) ?? 0;
        lineOccurrences.set(lineSignature, lineOccurrence + 1);
        const spanOccurrences = new Map<string, number>();
        return (
          <React.Fragment key={`${lineSignature}:${lineOccurrence}`}>
            {lineIndex > 0 ? "\n" : null}
            {line.spans.map((span) => {
              const spanSignature = `${span.role}:${span.text}`;
              const spanOccurrence = spanOccurrences.get(spanSignature) ?? 0;
              spanOccurrences.set(spanSignature, spanOccurrence + 1);
              const style = terminalTheme.styles[span.role];
              return (
                <Text
                  key={`${spanSignature}:${spanOccurrence}`}
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
        );
      })}
    </Text>
  );
}
