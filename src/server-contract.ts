import type { z } from "zod";
import type { ChatResponse } from "./api";
import type { statusPayloadSchema } from "./rpc-protocol";
import type { StreamErrorDetail } from "./stream-error";

export type StatusPayload = z.infer<typeof statusPayloadSchema>;

export type StreamErrorPayload = {
  error: string;
  errorCode?: string;
  errorDetail?: StreamErrorDetail;
};

export type RunChatHandlers = {
  path: string;
  method: string;
  taskId?: string;
  onEvent: (event: Record<string, unknown>) => void;
  onDone: (reply: ChatResponse) => void;
  onError: (payload: StreamErrorPayload) => void;
  isCancelled?: () => boolean;
  shouldYield?: () => boolean;
};
