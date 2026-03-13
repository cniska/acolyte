import { homedir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import { domainIdSchema } from "./id-contract";

export const userResourceIdSchema = domainIdSchema("user");
export type UserResourceId = z.infer<typeof userResourceIdSchema>;

export const projectResourceIdSchema = domainIdSchema("proj");
export type ProjectResourceId = z.infer<typeof projectResourceIdSchema>;

export const resourceIdSchema = z.union([userResourceIdSchema, projectResourceIdSchema]);
export type ResourceId = z.infer<typeof resourceIdSchema>;

export function parseResourceId(value: string | undefined): ResourceId | undefined {
  if (!value) return undefined;
  const parsed = resourceIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function hashValue(value: string): string {
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(value);
  return hasher.digest("hex").slice(0, 12);
}

export function projectResourceIdFromWorkspace(workspace: string): ProjectResourceId {
  const normalized = resolvePath(workspace);
  return projectResourceIdSchema.parse(`proj_${hashValue(normalized)}`);
}

export function defaultUserResourceId(homeDir = homedir()): UserResourceId {
  return userResourceIdSchema.parse(`user_${hashValue(resolvePath(homeDir))}`);
}

export function userResourceIdFor(context: string, sessionId: string): UserResourceId {
  return userResourceIdSchema.parse(`user_${hashValue(`${context}:${sessionId}`)}`);
}
