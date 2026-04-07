export const CLOUD_SYNC_ROUTES = {
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
    getActive: "/api/v1/sessions/active",
    setActive: "/api/v1/sessions/active",
  },
} as const;
