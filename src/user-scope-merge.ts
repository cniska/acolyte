import { isCredentialRejection } from "./cloud-migrate";
import { normalizeMemoryText } from "./distill-ops";
import { errorMessage } from "./error-contract";
import { log } from "./log";
import type { MemoryStore } from "./memory-contract";
import { LOCAL_USER_RESOURCE_ID, type UserResourceId } from "./resource-id";

export type UserScopeMergeSummary = {
  merged: number;
  duplicates: number;
  failures: number;
  embeddingFailures: number;
};

export type UserScopeMergeDeps = {
  localMemory: MemoryStore;
  cloudMemory: MemoryStore;
  accountKey: UserResourceId;
};

/**
 * Moves what this installation remembered while signed out into the account that just signed in.
 * Each record is written to the account before its local row goes, so a run that dies leaves the
 * record in both places and the next login finishes the move rather than losing it.
 */
export async function mergeLocalUserScope(deps: UserScopeMergeDeps): Promise<UserScopeMergeSummary> {
  const summary: UserScopeMergeSummary = { merged: 0, duplicates: 0, failures: 0, embeddingFailures: 0 };
  const local = await deps.localMemory.list({ scopeKey: LOCAL_USER_RESOURCE_ID });
  if (local.length === 0) return summary;

  // `addObservation` keeps one observation per normalized content in a scope, and a bare store write
  // does not, so the move applies that rule itself rather than duplicating a fact into the account.
  const held = new Set(
    (await deps.cloudMemory.list({ scopeKey: deps.accountKey }))
      .filter((record) => record.kind === "observation")
      .map((record) => normalizeMemoryText(record.content)),
  );

  for (const record of local) {
    if (record.kind === "observation" && held.has(normalizeMemoryText(record.content))) {
      await deps.localMemory.remove(record.id);
      summary.duplicates += 1;
      continue;
    }

    try {
      await deps.cloudMemory.write({ ...record, scopeKey: deps.accountKey }, "user");
    } catch (error) {
      if (isCredentialRejection(error)) throw error;
      log.warn("cloud.merge.memory_failed", { id: record.id, error: errorMessage(error) });
      summary.failures += 1;
      continue;
    }

    // A record that arrives without its vector is still recalled by keyword overlap, so a rejected
    // embedding is counted apart rather than holding the record back.
    try {
      const embedding = await deps.localMemory.getEmbedding(record.id);
      if (embedding) await deps.cloudMemory.writeEmbedding(record.id, deps.accountKey, embedding);
    } catch (error) {
      if (isCredentialRejection(error)) throw error;
      log.warn("cloud.merge.embedding_failed", { id: record.id, error: errorMessage(error) });
      summary.embeddingFailures += 1;
    }

    await deps.localMemory.remove(record.id);
    summary.merged += 1;
    if (record.kind === "observation") held.add(normalizeMemoryText(record.content));
  }

  return summary;
}
