import bundledSoul from "../docs/soul.md" with { type: "text" };

export function loadSoulPrompt(): string {
  return (bundledSoul as string).trim();
}
