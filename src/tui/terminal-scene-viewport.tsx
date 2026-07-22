import React from "react";
import type { TerminalLine, TerminalScene } from "../terminal-scene-contract";
import { terminalTheme } from "../terminal-theme";
import { Text } from "./components";
import { fitSceneViewport, type SceneViewportConstraints } from "./scene-viewport";

/**
 * Shared scene-line renderer: turns styled lines into terminal Text, resolving each span's
 * role through the fixed theme and painting a line's `fill` role background across its
 * content region (from the first non-blank span to the line end). The live viewport and the
 * scrollback slice renderer both go through here so they can never drift.
 */
export function renderSceneLines(lines: readonly TerminalLine[]): React.ReactNode {
  const lineOccurrences = new Map<string, number>();
  return lines.map((line, lineIndex) => {
    const lineSignature = line.spans.map((span) => `${span.role}:${span.text}`).join("|");
    const lineOccurrence = lineOccurrences.get(lineSignature) ?? 0;
    lineOccurrences.set(lineSignature, lineOccurrence + 1);
    const spanOccurrences = new Map<string, number>();
    const fillBackground = line.fill ? terminalTheme.styles[line.fill]?.background : undefined;
    const fillStart = fillBackground ? line.spans.findIndex((span) => /\S/.test(span.text)) : -1;
    return (
      <React.Fragment key={`${lineSignature}:${lineOccurrence}`}>
        {lineIndex > 0 ? "\n" : null}
        {line.spans.map((span, spanIndex) => {
          const spanSignature = `${span.role}:${span.text}`;
          const spanOccurrence = spanOccurrences.get(spanSignature) ?? 0;
          spanOccurrences.set(spanSignature, spanOccurrence + 1);
          const style = terminalTheme.styles[span.role];
          const background =
            style.background ?? (fillStart >= 0 && spanIndex >= fillStart ? fillBackground : undefined);
          return (
            <Text
              key={`${spanSignature}:${spanOccurrence}`}
              color={style.foreground}
              backgroundColor={background}
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
  });
}

export function TerminalSceneViewport({
  scene,
  constraints,
  liveLineStart,
}: {
  scene: TerminalScene;
  constraints: SceneViewportConstraints;
  liveLineStart?: number;
}): React.ReactNode {
  const start = liveLineStart ?? fitSceneViewport(scene, constraints).liveLineStart;
  return <Text>{renderSceneLines(scene.lines.slice(start))}</Text>;
}
