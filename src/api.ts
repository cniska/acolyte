import type { Message } from "./types";

export interface ChatRequest {
  message: string;
  history: Message[];
  model: string;
  sessionId?: string;
}

export interface ChatResponse {
  output: string;
  model: string;
}
