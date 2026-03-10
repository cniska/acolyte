import type { ChatResponse } from "./api";
import type { ErrorId } from "./error-handling";
import type { StreamError } from "./stream-error";
import type { TaskId } from "./task-contract";

export type { StatusPayload } from "./status-contract";

export type StreamErrorPayload = {
  errorMessage: string;
  errorId?: ErrorId;
  errorCode?: string;
  error?: StreamError;
};

export type RunChatHandlers = {
  path: string;
  method: string;
  taskId?: TaskId;
  onEvent: (event: Record<string, unknown>) => void;
  onDone: (reply: ChatResponse) => void;
  onError: (payload: StreamErrorPayload) => void;
  isCancelled?: () => boolean;
  shouldYield?: () => boolean;
};
