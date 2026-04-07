import { CLOUD_SYNC_ROUTES } from "./cloud-sync-contract";
import { CodedError } from "./coded-error";
import { CLOUD_ERROR_CODES, type CloudErrorCode } from "./error-contract";
import type { MemoryRecord, MemoryScope, MemoryStore } from "./memory-contract";
import { embeddingToBuffer } from "./memory-embedding";
import type { Session, SessionId, SessionStore } from "./session-contract";

const r = CLOUD_SYNC_ROUTES;

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

export type CloudSyncClient = {
  memory: MemoryStore;
  session: SessionStore;
};

async function request(base: string, token: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new CloudApiError(res.status, `Cloud API ${method} ${path} failed (${res.status}): ${text}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return res.json();
  return undefined;
}

function get(base: string, token: string, path: string, params?: Record<string, string | undefined>): Promise<unknown> {
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, v);
    }
  }
  const query = qs.toString();
  return request(base, token, "GET", query ? `${path}?${query}` : path);
}

function post(base: string, token: string, path: string, body?: unknown): Promise<unknown> {
  return request(base, token, "POST", path, body);
}

function put(base: string, token: string, path: string, body?: unknown): Promise<unknown> {
  return request(base, token, "PUT", path, body);
}

function del(base: string, token: string, path: string): Promise<unknown> {
  return request(base, token, "DELETE", path);
}

export function createCloudSyncClient(baseUrl: string, token: string): CloudSyncClient {
  const base = baseUrl.replace(/\/$/, "");

  const memory: MemoryStore = {
    async list(options) {
      return (await get(base, token, r.memories.list, {
        scopeKey: options?.scopeKey,
        kind: options?.kind,
      })) as MemoryRecord[];
    },

    async write(record: MemoryRecord, scope?: MemoryScope) {
      await post(base, token, r.memories.write, { record, scope });
    },

    async remove(id: string) {
      await del(base, token, r.memories.remove(id));
    },

    async touchRecalled(ids: string[]) {
      if (ids.length === 0) return;
      await post(base, token, r.memories.touchRecalled, { ids });
    },

    async writeEmbedding(id: string, scopeKey: string, embedding: Buffer) {
      await post(base, token, r.embeddings.write, {
        id,
        scopeKey,
        embedding: embedding.toString("base64"),
      });
    },

    async removeEmbedding(id: string) {
      await del(base, token, r.embeddings.remove(id));
    },

    async getEmbedding(id: string) {
      const data = (await post(base, token, r.embeddings.get, { ids: [id] })) as {
        embeddings: Record<string, string>;
      };
      const b64 = data.embeddings[id];
      return b64 ? Buffer.from(b64, "base64") : null;
    },

    async getEmbeddings(ids: string[]) {
      if (ids.length === 0) return new Map();
      const data = (await post(base, token, r.embeddings.get, { ids })) as {
        embeddings: Record<string, string>;
      };
      const result = new Map<string, Buffer>();
      for (const [id, b64] of Object.entries(data.embeddings)) {
        result.set(id, Buffer.from(b64, "base64"));
      }
      return result;
    },

    async searchByEmbedding(queryEmbedding: Float32Array, options) {
      return (await post(base, token, r.embeddings.search, {
        queryEmbedding: Buffer.from(embeddingToBuffer(queryEmbedding)).toString("base64"),
        scopeKey: options.scopeKey,
        kind: options.kind,
        limit: options.limit,
      })) as MemoryRecord[];
    },

    close() {},
  };

  const session: SessionStore = {
    async listSessions(options) {
      return (await get(base, token, r.sessions.list, {
        limit: options?.limit?.toString(),
      })) as Session[];
    },

    async getSession(id: SessionId) {
      return (await get(base, token, r.sessions.get(id))) as Session | null;
    },

    async saveSession(s: Session) {
      await post(base, token, r.sessions.save, s);
    },

    async removeSession(id: SessionId) {
      await del(base, token, r.sessions.remove(id));
    },

    async getActiveSessionId() {
      const data = (await get(base, token, r.sessions.getActive)) as { id: string | null };
      return data.id ? (data.id as SessionId) : undefined;
    },

    async setActiveSessionId(id: SessionId | undefined) {
      await put(base, token, r.sessions.setActive, { id: id ?? null });
    },

    close() {},
  };

  return { memory, session };
}

let clientInstance: CloudSyncClient | null = null;

export async function getCloudSyncClient(): Promise<CloudSyncClient> {
  if (clientInstance) return clientInstance;
  const { appConfig } = await import("./app-config");
  const url = appConfig.cloudUrl;
  const token = appConfig.cloudToken;
  if (!url || !token) throw new Error("cloudUrl and cloudToken required when cloudSync is enabled");
  clientInstance = createCloudSyncClient(url, token);
  return clientInstance;
}
