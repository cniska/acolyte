import type { CloudSyncClient } from "./cloud-sync-client";
import { CLOUD_SYNC_ROUTES } from "./cloud-sync-contract";
import type { MemoryRecord, MemoryScope, MemoryStore } from "./memory-contract";
import { embeddingToBuffer } from "./memory-embedding";

const r = CLOUD_SYNC_ROUTES;

export function createCloudMemoryStore(client: CloudSyncClient): MemoryStore {
  return {
    async list(options) {
      return (await client.get(r.memories.list, {
        scopeKey: options?.scopeKey,
        kind: options?.kind,
      })) as MemoryRecord[];
    },

    async write(record: MemoryRecord, scope?: MemoryScope) {
      await client.post(r.memories.write, { record, scope });
    },

    async remove(id: string) {
      await client.del(r.memories.remove(id));
    },

    async touchRecalled(ids: string[]) {
      if (ids.length === 0) return;
      await client.post(r.memories.touchRecalled, { ids });
    },

    async writeEmbedding(id: string, scopeKey: string, embedding: Buffer) {
      await client.post(r.embeddings.write, {
        id,
        scopeKey,
        embedding: embedding.toString("base64"),
      });
    },

    async removeEmbedding(id: string) {
      await client.del(r.embeddings.remove(id));
    },

    async getEmbedding(id: string) {
      const data = (await client.post(r.embeddings.get, { ids: [id] })) as {
        embeddings: Record<string, string>;
      };
      const b64 = data.embeddings[id];
      return b64 ? Buffer.from(b64, "base64") : null;
    },

    async getEmbeddings(ids: string[]) {
      if (ids.length === 0) return new Map();
      const data = (await client.post(r.embeddings.get, { ids })) as {
        embeddings: Record<string, string>;
      };
      const result = new Map<string, Buffer>();
      for (const [id, b64] of Object.entries(data.embeddings)) {
        result.set(id, Buffer.from(b64, "base64"));
      }
      return result;
    },

    async searchByEmbedding(queryEmbedding: Float32Array, options) {
      return (await client.post(r.embeddings.search, {
        queryEmbedding: Buffer.from(embeddingToBuffer(queryEmbedding)).toString("base64"),
        scopeKey: options.scopeKey,
        kind: options.kind,
        limit: options.limit,
      })) as MemoryRecord[];
    },

    close() {},
  };
}
