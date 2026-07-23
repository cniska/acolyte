import type React from "react";
import type { TerminalScene } from "./terminal-scene-contract";
import { Text } from "./tui";
import { renderSceneLines } from "./tui/terminal-scene-viewport";

export function TerminalSceneRender({ scene }: { scene: TerminalScene }): React.ReactNode {
  return <Text>{renderSceneLines(scene.lines)}</Text>;
}
