import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import { originRepositoryLabel } from "./git-remote";
import { domainIdSchema } from "./id-contract";
import { type Env, resolveHomeDir } from "./paths";
import { resolveProjectRoot } from "./workspace-sandbox";

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

// Read every time rather than cached: the daemon outlives `git remote add`, and a scope key that
// keeps answering from before the remote existed is worse than the config read it saves.
/** The `owner/repo` naming a workspace's project, or null when its `origin` names none. */
export function projectLabelFromWorkspace(workspace: string): string | null {
  return originRepositoryLabel(resolveProjectRoot(workspace));
}

/** The repository's own name, without its owner, for surfaces that show the project rather than key it. */
export function projectNameFromWorkspace(workspace: string): string | null {
  return projectLabelFromWorkspace(workspace)?.split("/").pop() ?? null;
}

/** The project a workspace belongs to, or null when it has no repository remote to be identified by. */
export function projectResourceIdFromWorkspace(workspace: string): ProjectResourceId | null {
  const label = projectLabelFromWorkspace(workspace);
  return label ? projectResourceIdForLabel(label) : null;
}

export function projectResourceIdForLabel(label: string): ProjectResourceId {
  return projectResourceIdSchema.parse(`proj_${hashValue(label)}`);
}

export function defaultUserResourceId(env?: Env): UserResourceId {
  return userResourceIdSchema.parse(`user_${hashValue(resolvePath(resolveHomeDir(env)))}`);
}

export function userResourceIdFor(context: string, sessionId: string): UserResourceId {
  return userResourceIdSchema.parse(`user_${hashValue(`${context}:${sessionId}`)}`);
}
