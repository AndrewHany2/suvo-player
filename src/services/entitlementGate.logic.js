/**
 * Advisory client-side mirror of the server entitlement verdict — UX ONLY, never
 * the security boundary. The `data` Edge Function already denies content when the
 * entitlement is expired/revoked/suspended (see supabase/functions/_shared/
 * entitlement.js); this only lets the app show an "expired" panel instead of a
 * confusing "play, then fail" experience, and lets it deny playback while offline
 * on a cached snapshot whose expiry has since passed on the local clock.
 *
 * Fails closed on a missing snapshot, but distinguishes "unknown" (no snapshot
 * yet — the caller should keep loading / not show an expired panel) from a real
 * deny reason, so a still-loading state isn't rendered as expired.
 */

/**
 * @param {{entitled?:boolean, reason?:string, expires_at?:string|null}|null|undefined} snapshot
 *   the `{ entitled, reason, expires_at }` returned by the `entitlement.fetch`
 *   data action, or null if not yet fetched
 * @param {number} nowMs local clock (Date.now())
 * @returns {{canPlay:boolean, reason:string}} reason ∈
 *   unknown | expired | revoked | suspended | no-entitlement | not-entitled | ok
 */
export function evaluateClientEntitlement(snapshot, nowMs) {
  if (!snapshot) return { canPlay: false, reason: "unknown" };

  if (snapshot.entitled === true) {
    // Trust the server verdict, but re-check a known expiry against the local
    // clock so a stale cached snapshot doesn't keep playing past its expiry
    // while offline. (A malformed expires_at is ignored here — the server, not
    // this advisory gate, is authoritative on garbage input.)
    if (snapshot.expires_at != null) {
      const exp = Date.parse(snapshot.expires_at);
      if (Number.isFinite(exp) && exp <= nowMs) return { canPlay: false, reason: "expired" };
    }
    return { canPlay: true, reason: "ok" };
  }

  return { canPlay: false, reason: snapshot.reason || "not-entitled" };
}
