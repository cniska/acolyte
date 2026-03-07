import { unreachable } from "./assert";
import type { StreamEvent } from "./client";
import type { StreamErrorDetail } from "./stream-error";
import type { ToolOutput } from "./tool-output-content";

export function createProgressTracker(options: {
  onStatus?: (message: string) => void;
  onAssistant?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onOutput?: (entry: { toolCallId: string; toolName: string; content: ToolOutput }) => void;
  onToolResult?: (entry: {
    toolCallId: string;
    toolName: string;
    isError?: boolean;
    errorCode?: string;
    errorDetail?: StreamErrorDetail;
  }) => void;
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
        break;
      case "tool-output":
        options.onOutput?.({
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
          errorCode: event.errorCode,
          errorDetail: event.errorDetail,
        });
        break;
      case "status":
        options.onStatus?.(event.message);
        break;
      case "error":
        options.onError?.(event.error);
        break;
      default:
        unreachable(event);
    }
  };

  return { apply };
}
