export function reserveFreePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = probe.port;
  probe.stop(true);
  if (typeof port !== "number") throw new Error("Failed to reserve free port");
  return port;
}
