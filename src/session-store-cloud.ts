import type { CloudSyncClient } from "./cloud-sync-client";
import { CLOUD_SYNC_ROUTES } from "./cloud-sync-contract";
import type { Session, SessionId, SessionStore } from "./session-contract";

const r = CLOUD_SYNC_ROUTES;

export function createCloudSessionStore(client: CloudSyncClient): SessionStore {
  return {
    async listSessions(options) {
      return (await client.get(r.sessions.list, {
        limit: options?.limit?.toString(),
      })) as Session[];
    },

    async getSession(id: SessionId) {
      return (await client.get(r.sessions.get(id))) as Session | null;
    },

    async saveSession(session: Session) {
      await client.post(r.sessions.save, session);
    },

    async removeSession(id: SessionId) {
      await client.del(r.sessions.remove(id));
    },

    async getActiveSessionId() {
      const data = (await client.get(r.sessions.getActive)) as { id: string | null };
      return data.id ? (data.id as SessionId) : undefined;
    },

    async setActiveSessionId(id: SessionId | undefined) {
      await client.put(r.sessions.setActive, { id: id ?? null });
    },

    close() {},
  };
}
