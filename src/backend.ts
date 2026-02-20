import type { ChatRequest, ChatResponse } from "./api";
import { appConfig } from "./app-config";

export interface BackendOptions {
  apiUrl?: string;
  apiKey?: string;
}

export interface Backend {
  reply(input: ChatRequest): Promise<ChatResponse>;
  status(): Promise<string>;
}

class LocalBackend implements Backend {
  async reply(input: ChatRequest): Promise<ChatResponse> {
    const trimmed = input.message.trim();
    const lc = trimmed.toLowerCase();

    if (lc.includes("summarize") && input.history.length > 0) {
      const userMessages = input.history.filter((m) => m.role === "user").length;
      const assistantMessages = input.history.filter((m) => m.role === "assistant").length;
      return {
        model: input.model,
        output: `Session so far: ${userMessages} user messages, ${assistantMessages} assistant messages. Ask me to /history for full local transcript.`,
      };
    }

    return {
      model: input.model,
      output: [
        "Local backend is active.",
        "Set ACOLYTE_API_URL to route CLI requests to your hosted Mastra backend.",
        "I can still track your session context, memory notes, and command history locally.",
        `You said: ${trimmed}`,
      ].join(" "),
    };
  }

  async status(): Promise<string> {
    return "mode=local-mock backend=embedded";
  }
}

class RemoteBackend implements Backend {
  constructor(private readonly apiUrl: string, private readonly apiKey?: string) {}

  async reply(input: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.apiUrl.replace(/\/$/, "")}/v1/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Remote backend error (${response.status}): ${body || "no body"}`);
    }

    const json = (await response.json()) as Partial<ChatResponse>;
    if (typeof json.output !== "string") {
      throw new Error("Remote backend returned invalid payload: missing output");
    }

    return {
      output: json.output,
      model: typeof json.model === "string" ? json.model : input.model,
    };
  }

  async status(): Promise<string> {
    const response = await fetch(`${this.apiUrl.replace(/\/$/, "")}/healthz`, {
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : undefined,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Backend health check failed (${response.status}): ${body || "no body"}`);
    }

    const json = (await response.json()) as { mode?: unknown; service?: unknown };
    const mode = typeof json.mode === "string" ? json.mode : "unknown";
    const service = typeof json.service === "string" ? json.service : "unknown";
    return `mode=${mode} service=${service} url=${this.apiUrl}`;
  }
}

export function createBackend(options?: BackendOptions): Backend {
  const apiUrl = options?.apiUrl ?? appConfig.server.apiUrl;
  const apiKey = options?.apiKey ?? appConfig.server.apiKey;

  if (!apiUrl) {
    return new LocalBackend();
  }

  return new RemoteBackend(apiUrl, apiKey);
}
