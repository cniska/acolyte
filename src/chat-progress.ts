import type { StreamEvent } from "./backend";

export function createProgressTracker(options: {
  onStatus?: (message: string) => void;
  onAssistant?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onToolCall?: (entry: { toolCallId: string; toolName: string; args: Record<string, unknown> }) => void;
  onToolOutput?: (entry: { toolCallId: string; toolName: string; content: string }) => void;
  onToolResult?: (entry: { toolCallId: string; toolName: string; isError?: boolean }) => void;
  onError?: (error: string) => void;
}): {
  apply: (event: StreamEvent) => void;
} {
  const apply = (event: StreamEvent): void => {
    switch (event.type) {
      case "text-delta":
        options.onAssistant?.(event.text);
        break;
      case "reasoning":
        options.onReasoning?.(event.text);
        break;
      case "tool-call":
        options.onToolCall?.({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
        break;
      case "tool-output":
        options.onToolOutput?.({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          content: event.content,
        });
        break;
      case "tool-result":
        options.onToolResult?.({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
        });
        break;
      case "status":
        options.onStatus?.(event.message);
        break;
      case "error":
        options.onError?.(event.error);
        break;
    }
  };

  return { apply };
}
