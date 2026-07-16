import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadStore, makeId } from './downloadStore.js';
import { remoteUrlFor, localPathFor, normalizeLocalPaths } from './downloadUri.js';
import { applyEvent } from './downloadReducer.js';

/**
 * Headless downloads controller — all of DownloadsProvider's state, effects, and
 * actions, with NO JSX. Kept in a plain .js module (not the .jsx provider) so it
 * can be driven directly in node:test, which cannot parse JSX. DownloadsProvider
 * is a thin wrapper that calls this and drops the returned object into context.
 *
 * @param {object}   deps
 * @param {object}   deps.manager            platform download manager (start/pause/resume/cancel/subscribe/reattach/exists)
 * @param {object}   deps.api                active ContentService (its .api is the live backend) — used to build remote URLs
 * @param {string=}  deps.documentDirectory  base dir for local files (falsy on web)
 * @param {object=}  deps.store              metadata store (injectable for tests; defaults to the shared singleton)
 * @returns the value object exposed to consumers via useDownloads()
 */
export function useDownloadsController({ manager, api, documentDirectory, store = downloadStore }) {
  const [byId, setById] = useState({});
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  // Hydrate from the persisted store, then re-attach to background tasks.
  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = await store.loadAll();
      // Re-derive every localPath against the CURRENT documentDirectory: the
      // persisted absolute path is from whatever iOS container existed at
      // download time and goes stale on reinstall/OS-update/dev-rebuild (a new
      // container UUID), which is why a downloaded item fails to open.
      const map = normalizeLocalPaths(stored, documentDirectory);
      // Drop completed downloads whose file is actually gone so playback falls
      // back to streaming and the UI offers a re-download. Conservative: treat a
      // failed existence check as "present" so a transient error never nukes a
      // record.
      await Promise.all(
        Object.values(map).map(async (rec) => {
          if (rec.status !== 'done' || !rec.localPath || !manager.exists) return;
          const present = await manager.exists(rec.localPath).catch(() => true);
          if (!present) {
            delete map[rec.id];
            store.remove(rec.id);
          }
        }),
      );
      if (!alive) return;
      setById(map);
      byIdRef.current = map;
      await manager.reattach();
    })();
    return () => { alive = false; };
  }, [manager, documentDirectory, store]);

  // Fold a single event into state + persist. We reduce against byIdRef (updated
  // synchronously here so back-to-back events in one tick compose correctly),
  // then apply state and persistence as pure single-invocation steps — no side
  // effect inside the setState updater. Shared by the manager subscription and
  // the optimistic pause/resume controls below.
  const commit = useCallback((event) => {
    const prev = byIdRef.current;
    const next = applyEvent(prev, event);
    if (next === prev || !next[event.id]) return;
    byIdRef.current = next;
    setById(next);
    store.put(next[event.id]);
  }, [store]);

  useEffect(() => manager.subscribe(commit), [manager, commit]);

  const start = useCallback(async (item) => {
    const id = makeId(item);
    const existing = byIdRef.current[id];
    if (existing && (existing.status === 'done' || existing.status === 'downloading')) return;
    const url = remoteUrlFor(api, item);
    const localPath = localPathFor(id, item.ext, documentDirectory);
    const record = {
      id, kind: item.kind, title: item.title, poster: item.poster,
      seriesId: item.seriesId, season: item.season, episode: item.episode,
      // Do NOT persist the remote URL: for Xtream it embeds the account
      // username+password, and nothing reads it back (the download is tasked
      // from the local `url` below). Keeping it out of the record removes a
      // plaintext-credential copy at rest.
      localPath, ext: item.ext || 'mp4',
      bytesTotal: 0, bytesDone: 0, status: 'queued', createdAt: Date.now(),
    };
    const saved = await store.put(record);
    setById((prev) => ({ ...prev, [id]: saved }));
    manager.start({ id, url, localPath });
  }, [api, documentDirectory, manager, store]);

  // The native library's pause/resume don't emit events, so optimistically fold
  // a paused/resumed event ourselves — that's what flips the button UI and makes
  // the resume path reachable (the reducer guards illegal transitions).
  const pause = useCallback((id) => { manager.pause(id); commit({ id, type: 'paused' }); }, [manager, commit]);
  const resume = useCallback((id) => { manager.resume(id); commit({ id, type: 'resumed' }); }, [manager, commit]);
  const cancel = useCallback(async (id) => {
    manager.cancel(id);
    await store.remove(id);
    setById((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }, [manager, store]);
  const remove = cancel;
  const isDownloaded = useCallback((id) => byIdRef.current[id]?.status === 'done', []);

  // Free bytes on the device's download volume. Passthrough to the manager
  // (which knows the platform's filesystem); resolves null when the manager
  // can't report it (e.g. web/Electron, where there's no local download store)
  // so callers can just hide the figure.
  const freeBytes = useCallback(
    () => (manager.freeBytes ? manager.freeBytes() : Promise.resolve(null)),
    [manager],
  );

  return {
    byId,
    items: Object.values(byId).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    start, pause, resume, cancel, remove, isDownloaded, freeBytes,
  };
}
