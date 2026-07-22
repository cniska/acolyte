import type React from "react";
import { TerminalSceneRender } from "./terminal-scene-render";
import { Box, Text } from "./tui";
import type { PromotedSceneSlice } from "./tui/scene-viewport";

// The blank leads each slice to reproduce the scene's inter-section separator, which the
// slice's own line range excludes; it matches the per-item spacing of the legacy Static.
export function PromotedSliceView({ slice }: { slice: PromotedSceneSlice }): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <TerminalSceneRender scene={{ lines: slice.lines }} />
    </Box>
  );
}
