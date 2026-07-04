// Pure authorization decisions for the data Edge Function. No I/O and no
// imports, so it runs under both the Deno edge runtime and node:test.

/**
 * Decide whether a client-supplied library `userKey` may be used by the
 * authenticated caller. `userKey` is only ever the caller's own auth id or one
 * of their app_profile ids, so it is authorized when it equals `userId`, or
 * when the app_profile with that id is owned by `userId`.
 *
 * @param {string} userKey            - Client-supplied library key.
 * @param {string} userId             - Authenticated user id (from the JWT).
 * @param {string|null|undefined} appProfileOwnerId
 *   - user_id of the app_profile row whose id === userKey, or null if none.
 * @returns {boolean}
 */
export function userKeyIsAuthorized(userKey, userId, appProfileOwnerId) {
  if (!userKey || !userId) return false;
  if (userKey === userId) return true;
  return appProfileOwnerId === userId;
}
