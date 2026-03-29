export const PROTOCOL_VERSION = "3";

export const SERVER_CAPABILITIES = ["stream.sse", "error.structured", "workspace.path", "permissions.mode"] as const;

export function formatServerCapabilities(): string {
  return [...SERVER_CAPABILITIES].sort().join(", ");
}
