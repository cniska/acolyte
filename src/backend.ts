import type { ChatRequest, ChatResponse } from "./api";

export interface Backend {
  reply(input: ChatRequest): Promise<ChatResponse>;
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
}

export function createBackend(): Backend {
  const apiUrl = process.env.ACOLYTE_API_URL;
  const apiKey = process.env.ACOLYTE_API_KEY;

  if (!apiUrl) {
    return new LocalBackend();
  }

  return new RemoteBackend(apiUrl, apiKey);
}
