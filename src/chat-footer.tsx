import type React from "react";
import { unreachable } from "./assert";
import type { PrInfo, PrState } from "./gh-contract";
import { Text } from "./tui";

export type FooterState = {
  workspace: string;
  branch: string | null;
  pr: PrInfo | null;
  model: string;
};

function prColor(state: PrState): string {
  switch (state) {
    case "open":
      return "green";
    case "merged":
      return "magenta";
    case "closed":
      return "red";
    default:
      return unreachable(state);
  }
}

export function FooterContext({ workspace, branch, pr, model }: FooterState): React.ReactNode {
  return (
    <Text>
      <Text dimColor>{workspace}</Text>
      <Text dimColor>{" · "}</Text>
      <Text dimColor>{branch}</Text>
      {pr ? (
        <>
          <Text dimColor>{" · PR "}</Text>
          <Text color={prColor(pr.state)}>#{pr.number}</Text>
        </>
      ) : null}
      <Text dimColor>{" · "}</Text>
      <Text dimColor>{model}</Text>
      {"  "}
    </Text>
  );
}
