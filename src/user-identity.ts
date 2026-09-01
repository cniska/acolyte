import { appConfig } from "./app-config";
import { decodeTokenSubject } from "./credentials";
import { LOCAL_USER_RESOURCE_ID, type UserResourceId, userResourceIdForSubject } from "./resource-id";

/**
 * Who the user is: the account their cloud token names, or this installation when there is none.
 * The token is read and never verified — an expired token names the same account, so the scope does
 * not flip while a credential is stale. Callers that just wrote a token must pass it: `appConfig`
 * snapshots credentials at import, so the process that logged in cannot read its own token from it.
 */
export function activeUserResourceId(token: string | undefined = appConfig.cloudToken): UserResourceId {
  const subject = token ? decodeTokenSubject(token) : undefined;
  return subject ? userResourceIdForSubject(subject) : LOCAL_USER_RESOURCE_ID;
}
