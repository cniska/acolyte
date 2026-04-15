import { z } from "zod";
import { type ChatMessage, messageSchema } from "./chat-contract";
import { CodedError } from "./coded-error";
import { CLOUD_ERROR_CODES, type CloudErrorCode } from "./error-contract";
import { type MemoryRecord, type MemoryScope, type MemoryStore, memoryRecordSchema } from "./memory-contract";
import { embeddingToBuffer } from "./memory-embedding";
import { type Session, type SessionId, type SessionStore, sessionIdSchema, sessionSchema } from "./session-contract";

const GZIP_THRESHOLD = 1024;

const ROUTES = {
  memories: {
    list: "/api/v1/memories",
    write: "/api/v1/memories",
    remove: (id: string) => `/api/v1/memories/${encodeURIComponent(id)}`,
    touchRecalled: "/api/v1/memories/touch-recalled",
  },
  embeddings: {
    write: "/api/v1/memories/embeddings",
    get: "/api/v1/memories/embeddings/get",
    remove: (id: string) => `/api/v1/memories/embeddings/${encodeURIComponent(id)}`,
    search: "/api/v1/memories/embeddings/search",
  },
  sessions: {
    list: "/api/v1/sessions",
    save: "/api/v1/sessions",
    get: (id: string) => `/api/v1/sessions/${encodeURIComponent(id)}`,
    remove: (id: string) => `/api/v1/sessions/${encodeURIComponent(id)}`,
    append: (id: string) => `/api/v1/sessions/${encodeURIComponent(id)}/append`,
    search: (id: string) => `/api/v1/sessions/${encodeURIComponent(id)}/search`,
    getActive: "/api/v1/sessions/active",
    setActive: "/api/v1/sessions/active",
  },
} as const;

function cloudErrorCode(status: number): CloudErrorCode {
  if (status === 401) return CLOUD_ERROR_CODES.unauthorized;
  if (status === 403) return CLOUD_ERROR_CODES.forbidden;
  return CLOUD_ERROR_CODES.requestFailed;
}

export class CloudApiError extends CodedError<CloudErrorCode, { status: number }> {
  constructor(status: number, message: string) {
    super(cloudErrorCode(status), message, { meta: { status } });
    this.name = "CloudApiError";
  }
}

const memoryListSchema = z.array(memoryRecordSchema);
const sessionListSchema = z.array(sessionSchema);
const embeddingsResponseSchema = z.object({ embeddings: z.record(z.string(), z.string()) });
const activeSessionSchema = z.object({ id: z.string().nullable() });

type SyncCursor = { messageCount: number; tokenUsageCount: number };

export class CloudClient {
  private readonly base: string;
  private readonly token: string;
  private readonly syncCursors = new Map<string, SyncCursor>();

  constructor(baseUrl: string, token: string) {
    this.base = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  get memory(): MemoryStore {
    return {
      list: (options) => this.getMemories(options),
      write: (record, scope) => this.writeMemory(record, scope),
      remove: (id) => this.removeMemory(id),
      touchRecalled: (ids) => this.touchRecalled(ids),
      writeEmbedding: (id, scopeKey, embedding) => this.writeEmbedding(id, scopeKey, embedding),
      removeEmbedding: (id) => this.removeEmbedding(id),
      getEmbedding: (id) => this.getEmbedding(id),
      getEmbeddings: (ids) => this.getEmbeddings(ids),
      searchByEmbedding: (query, opts) => this.searchByEmbedding(query, opts),
      close: () => {},
    };
  }

  get session(): SessionStore {
    return {
      listSessions: (options) => this.listSessions(options),
      getSession: (id) => this.getSession(id),
      saveSession: (session) => this.saveSession(session),
      removeSession: (id) => this.removeSession(id),
      getActiveSessionId: () => this.getActiveSessionId(),
      setActiveSessionId: (id) => this.setActiveSessionId(id),
      searchSession: (id, query, options) => this.searchSession(id, query, options),
      close: () => {},
    };
  }

  private async getMemories(options?: { scopeKey?: string; kind?: string }): Promise<readonly MemoryRecord[]> {
    return this.get(ROUTES.memories.list, {
      schema: memoryListSchema,
      params: { scopeKey: options?.scopeKey, kind: options?.kind },
    });
  }

  private async writeMemory(record: MemoryRecord, scope?: MemoryScope): Promise<void> {
    await this.post(ROUTES.memories.write, { body: { record, scope } });
  }

  private async removeMemory(id: string): Promise<void> {
    await this.del(ROUTES.memories.remove(id));
  }

  private async touchRecalled(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.post(ROUTES.memories.touchRecalled, { body: { ids } });
  }

  private async writeEmbedding(id: string, scopeKey: string, embedding: Buffer): Promise<void> {
    await this.post(ROUTES.embeddings.write, {
      body: { id, scopeKey, embedding: embedding.toString("base64") },
    });
  }

  private async removeEmbedding(id: string): Promise<void> {
    await this.del(ROUTES.embeddings.remove(id));
  }

  private async getEmbedding(id: string): Promise<Buffer | null> {
    const { embeddings } = await this.post(ROUTES.embeddings.get, {
      schema: embeddingsResponseSchema,
      body: { ids: [id] },
    });
    const b64 = embeddings[id];
    return b64 ? Buffer.from(b64, "base64") : null;
  }

  private async getEmbeddings(ids: string[]): Promise<Map<string, Buffer>> {
    if (ids.length === 0) return new Map();
    const { embeddings } = await this.post(ROUTES.embeddings.get, {
      schema: embeddingsResponseSchema,
      body: { ids },
    });
    const result = new Map<string, Buffer>();
    for (const [id, b64] of Object.entries(embeddings)) {
      result.set(id, Buffer.from(b64, "base64"));
    }
    return result;
  }

  private async searchByEmbedding(
    queryEmbedding: Float32Array,
    options: { scopeKey?: string; kind?: string; limit: number },
  ): Promise<MemoryRecord[]> {
    return this.post(ROUTES.embeddings.search, {
      schema: memoryListSchema,
      body: {
        queryEmbedding: Buffer.from(embeddingToBuffer(queryEmbedding)).toString("base64"),
        scopeKey: options.scopeKey,
        kind: options.kind,
        limit: options.limit,
      },
    });
  }

  private async listSessions(options?: { limit?: number }): Promise<readonly Session[]> {
    const sessions = await this.get(ROUTES.sessions.list, {
      schema: sessionListSchema,
      params: { limit: options?.limit?.toString() },
    });
    for (const s of sessions) {
      this.syncCursors.set(s.id, { messageCount: s.messages.length, tokenUsageCount: s.tokenUsage.length });
    }
    return sessions;
  }

  private async getSession(id: SessionId): Promise<Session | null> {
    const session = await this.get(ROUTES.sessions.get(id), { schema: sessionSchema.nullable() });
    if (session) {
      this.syncCursors.set(session.id, {
        messageCount: session.messages.length,
        tokenUsageCount: session.tokenUsage.length,
      });
    }
    return session;
  }

  private async saveSession(session: Session): Promise<void> {
    const cursor = this.syncCursors.get(session.id);
    if (cursor) {
      const newMessages = session.messages.slice(cursor.messageCount);
      const newTokenUsage = session.tokenUsage.slice(cursor.tokenUsageCount);
      const metadata = {
        updatedAt: session.updatedAt,
        model: session.model,
        title: session.title,
        workspace: session.workspace,
        workspaceName: session.workspaceName,
        workspaceBranch: session.workspaceBranch,
        activeSkills: session.activeSkills,
      };
      await this.patch(ROUTES.sessions.append(session.id), {
        body: {
          ...(newMessages.length > 0 ? { messages: newMessages } : {}),
          ...(newTokenUsage.length > 0 ? { tokenUsage: newTokenUsage } : {}),
          ...metadata,
        },
      });
    } else {
      await this.post(ROUTES.sessions.save, { body: session });
    }
    this.syncCursors.set(session.id, {
      messageCount: session.messages?.length ?? 0,
      tokenUsageCount: session.tokenUsage?.length ?? 0,
    });
  }

  private async removeSession(id: SessionId): Promise<void> {
    await this.del(ROUTES.sessions.remove(id));
  }

  private async getActiveSessionId(): Promise<SessionId | undefined> {
    const { id } = await this.get(ROUTES.sessions.getActive, { schema: activeSessionSchema });
    return id ? sessionIdSchema.parse(id) : undefined;
  }

  private async setActiveSessionId(id: SessionId | undefined): Promise<void> {
    await this.put(ROUTES.sessions.setActive, { body: { id: id ?? null } });
  }

  private async searchSession(
    id: SessionId,
    query: string,
    options?: { limit?: number },
  ): Promise<readonly ChatMessage[]> {
    return this.post(ROUTES.sessions.search(id), {
      schema: z.array(messageSchema),
      body: { query, limit: options?.limit },
    });
  }

  private async request<T = void>(
    method: string,
    path: string,
    options?: { schema?: z.ZodType<T>; body?: unknown; params?: Record<string, string | undefined> },
  ): Promise<T> {
    let url = `${this.base}${path}`;
    if (options?.params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(options.params)) {
        if (v !== undefined) qs.set(k, v);
      }
      const query = qs.toString();
      if (query) url = `${url}?${query}`;
    }
    let body: BodyInit | undefined;
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    if (options?.body !== undefined) {
      const json = JSON.stringify(options.body);
      headers["content-type"] = "application/json";
      if (json.length >= GZIP_THRESHOLD) {
        body = Bun.gzipSync(Buffer.from(json));
        headers["content-encoding"] = "gzip";
      } else {
        body = json;
      }
    }
    const res = await fetch(url, { method, headers, body });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new CloudApiError(res.status, `Cloud API ${method} ${path} failed (${res.status}): ${text}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    const json = contentType.includes("application/json") ? await res.json() : undefined;
    return options?.schema ? options.schema.parse(json) : (json as T);
  }

  private get<T = void>(
    path: string,
    options?: { schema?: z.ZodType<T>; params?: Record<string, string | undefined> },
  ): Promise<T> {
    return this.request("GET", path, options);
  }

  private post<T = void>(path: string, options?: { schema?: z.ZodType<T>; body?: unknown }): Promise<T> {
    return this.request("POST", path, options);
  }

  private patch(path: string, options?: { body?: unknown }): Promise<void> {
    return this.request("PATCH", path, options);
  }

  private put(path: string, options?: { body?: unknown }): Promise<void> {
    return this.request("PUT", path, options);
  }

  private del(path: string): Promise<void> {
    return this.request("DELETE", path);
  }
}

let clientInstance: CloudClient | null = null;

export async function getCloudClient(): Promise<CloudClient> {
  if (clientInstance) return clientInstance;
  const { appConfig } = await import("./app-config");
  const url = appConfig.cloudUrl;
  const token = appConfig.cloudToken;
  if (!url || !token) throw new Error("cloudUrl and cloudToken required when cloudSync is enabled");
  clientInstance = new CloudClient(url, token);
  return clientInstance;
}
