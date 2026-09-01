import { appConfig } from "./app-config";
import { decodeTokenSubject } from "./credentials";
import { LOCAL_USER_RESOURCE_ID, type UserResourceId, userResourceIdForSubject } from "./resource-id";

/**
 * The scope a credential names, or this installation's own when it names no account. The token is
 * read and never verified — an expired token names the same account, so the scope does not flip
 * while a credential is stale.
 */
export function userScopeForToken(token: string | undefined): UserResourceId {
  const subject = token ? decodeTokenSubject(token) : undefined;
  return subject ? userResourceIdForSubject(subject) : LOCAL_USER_RESOURCE_ID;
}

/**
 * Who the user is now, from the stored credential. A process that just wrote a token must derive
 * the scope from that token instead: `appConfig` snapshots credentials at import, so a login cannot
 * read its own token back out of configuration.
 */
export function activeUserResourceId(): UserResourceId {
  return userScopeForToken(appConfig.cloudToken);
}
