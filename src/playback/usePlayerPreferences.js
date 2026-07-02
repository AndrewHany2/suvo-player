// @ts-check
/**
 * Remembered player preferences — two-scope, AsyncStorage-backed.
 *
 * Scopes:
 *   - GLOBAL defaults: one record under `player_prefs_global`.
 *   - PER-STREAM overrides: one record per stream under
 *     `player_prefs_stream_<type>_<streamId>`.
 *
 * `prefs` is the GLOBAL record shallow-merged with the per-stream record
 * (stream wins). Reads are async on mount; writes are write-through with a
 * short debounce so rapid setPref bursts coalesce into one storage write per
 * scope. Works on web + native because storage.js is AsyncStorage everywhere.
 *
 * `setPref`/`prefs` are intentionally generic (any string key) so other feature
 * groups can persist their own settings without changing this module.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import storage from "../utils/storage";

/** Namespaced storage key for the global defaults record. */
export const GLOBAL_PREFS_KEY = "player_prefs_global";

/** Build the per-stream storage key. `streamKey` is `<type>_<streamId>`. */
export const streamPrefsKey = (streamKey) => `player_prefs_stream_${streamKey}`;

const WRITE_DEBOUNCE_MS = 250;

/** Parse a stored JSON record, tolerating null/garbage. @returns {Object} */
function parseRecord(raw) {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/**
 * Hook: load + persist player preferences for a stream.
 *
 * @param {string|null|undefined} streamKey - `<type>_<streamId>` identifying the
 *   stream for per-stream overrides. When falsy, only the global scope is used
 *   (setPref with scope 'stream' is treated as global, and resetStream is a no-op).
 * @returns {{
 *   prefs: Object,
 *   loaded: boolean,
 *   setPref: (key: string, value: any, opts?: { scope?: 'global'|'stream' }) => void,
 *   resetStream: () => void,
 * }}
 *   `prefs` is global merged with stream overrides (stream wins).
 */
export function usePlayerPreferences(streamKey) {
  const [global, setGlobal] = useState(/** @type {Object} */ ({}));
  const [stream, setStream] = useState(/** @type {Object} */ ({}));
  const [loaded, setLoaded] = useState(false);

  const streamStorageKey = streamKey ? streamPrefsKey(streamKey) : null;

  // Debounce timers + latest-record refs, per storage key.
  const timers = useRef(/** @type {Record<string, any>} */ ({}));
  const latest = useRef(/** @type {Record<string, Object>} */ ({}));

  const flush = useCallback((key, record) => {
    latest.current[key] = record;
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      timers.current[key] = null;
      // Persist the most recent record for this key.
      storage.setItem(key, JSON.stringify(latest.current[key])).catch(() => {});
    }, WRITE_DEBOUNCE_MS);
  }, []);

  // Load both scopes on mount / when the stream changes.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    (async () => {
      const [g, s] = await Promise.all([
        storage.getItem(GLOBAL_PREFS_KEY).catch(() => null),
        streamStorageKey ? storage.getItem(streamStorageKey).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setGlobal(parseRecord(g));
      setStream(parseRecord(s));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [streamStorageKey]);

  // Flush any pending writes on unmount so a debounced set isn't lost.
  useEffect(() => {
    const t = timers.current;
    const l = latest.current;
    return () => {
      for (const key of Object.keys(t)) {
        if (t[key]) {
          clearTimeout(t[key]);
          storage.setItem(key, JSON.stringify(l[key])).catch(() => {});
        }
      }
    };
  }, []);

  const prefs = useMemo(() => ({ ...global, ...stream }), [global, stream]);

  const setPref = useCallback(
    (key, value, opts = {}) => {
      const scope = opts.scope ?? "stream";
      // Fall back to global when there's no stream context.
      const effectiveScope = scope === "stream" && streamStorageKey ? "stream" : "global";

      if (effectiveScope === "stream") {
        setStream((prev) => {
          const next = { ...prev, [key]: value };
          flush(/** @type {string} */ (streamStorageKey), next);
          return next;
        });
      } else {
        setGlobal((prev) => {
          const next = { ...prev, [key]: value };
          flush(GLOBAL_PREFS_KEY, next);
          return next;
        });
      }
    },
    [streamStorageKey, flush],
  );

  const resetStream = useCallback(() => {
    if (!streamStorageKey) return;
    setStream({});
    if (timers.current[streamStorageKey]) {
      clearTimeout(timers.current[streamStorageKey]);
      timers.current[streamStorageKey] = null;
    }
    latest.current[streamStorageKey] = {};
    storage.removeItem(streamStorageKey).catch(() => {});
  }, [streamStorageKey]);

  return { prefs, loaded, setPref, resetStream };
}

export default usePlayerPreferences;
