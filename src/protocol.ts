export const PROTOCOL_VERSION = "4";

export const SERVER_CAPABILITIES = ["stream.sse", "error.structured", "workspace.path"] as const;

export function formatServerCapabilities(): string {
  return [...SERVER_CAPABILITIES].sort().join(", ");
}
