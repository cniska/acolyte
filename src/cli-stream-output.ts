export function missingAssistantStreamTail(streamed: string, finalOutput: string): string {
  if (streamed.length === 0) return finalOutput;
  if (finalOutput === streamed) return "";
  if (finalOutput.startsWith(streamed)) return finalOutput.slice(streamed.length);
  return "";
}
