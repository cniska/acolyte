export function missingAssistantStreamTail(streamed: string, finalOutput: string): string {
  if (streamed.length === 0) return finalOutput;
  if (finalOutput === streamed) return "";
  if (finalOutput.startsWith(streamed)) return finalOutput.slice(streamed.length);
  return "";
}

export function mergeAssistantStreamOutput(streamed: string, finalOutput: string): string {
  if (streamed.length === 0) return finalOutput;
  if (finalOutput.length === 0) return streamed;
  if (finalOutput === streamed) return finalOutput;
  if (finalOutput.startsWith(streamed)) return finalOutput;
  if (streamed.startsWith(finalOutput)) return streamed;
  const maxOverlap = Math.min(streamed.length, finalOutput.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (streamed.endsWith(finalOutput.slice(0, overlap))) return streamed + finalOutput.slice(overlap);
  }
  return streamed;
}
