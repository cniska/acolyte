export class CloudApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CloudApiError";
  }
}

export type CloudSyncClient = {
  get(path: string, params?: Record<string, string | undefined>): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  put(path: string, body?: unknown): Promise<unknown>;
  del(path: string): Promise<unknown>;
};

export function createCloudSyncClient(baseUrl: string, token: string): CloudSyncClient {
  const base = baseUrl.replace(/\/$/, "");

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${base}${path}`;
    const res = await fetch(url, {
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

  return {
    get(path, params) {
      const qs = new URLSearchParams();
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined) qs.set(k, v);
        }
      }
      const query = qs.toString();
      return request("GET", query ? `${path}?${query}` : path);
    },
    post: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body),
    del: (path) => request("DELETE", path),
  };
}
