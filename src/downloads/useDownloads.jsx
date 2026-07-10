import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { downloadStore, makeId } from './downloadStore.js';
import { remoteUrlFor, localPathFor } from './downloadUri.js';
import { applyEvent } from './downloadReducer.js';

const DownloadsContext = createContext(null);

export function DownloadsProvider({ manager, api, documentDirectory, children }) {
  const [byId, setById] = useState({});
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  // Hydrate from the persisted store, then re-attach to background tasks.
  useEffect(() => {
    let alive = true;
    (async () => {
      const map = await downloadStore.loadAll();
      if (!alive) return;
      setById(map);
      byIdRef.current = map;
      await manager.reattach();
    })();
    return () => { alive = false; };
  }, [manager]);

  // Fold manager events into state + persist. We reduce against byIdRef (updated
  // synchronously here so back-to-back events in one tick compose correctly),
  // then apply state and persistence as pure single-invocation steps — no side
  // effect inside the setState updater.
  useEffect(() => {
    const unsub = manager.subscribe((event) => {
      const prev = byIdRef.current;
      const next = applyEvent(prev, event);
      if (next === prev || !next[event.id]) return;
      byIdRef.current = next;
      setById(next);
      downloadStore.put(next[event.id]);
    });
    return unsub;
  }, [manager]);

  const start = useCallback(async (item) => {
    const id = makeId(item);
    const existing = byIdRef.current[id];
    if (existing && (existing.status === 'done' || existing.status === 'downloading')) return;
    const url = remoteUrlFor(api, item);
    const localPath = localPathFor(id, item.ext, documentDirectory);
    const record = {
      id, kind: item.kind, title: item.title, poster: item.poster,
      seriesId: item.seriesId, season: item.season, episode: item.episode,
      remoteUrl: url, localPath, ext: item.ext || 'mp4',
      bytesTotal: 0, bytesDone: 0, status: 'queued', createdAt: Date.now(),
    };
    const saved = await downloadStore.put(record);
    setById((prev) => ({ ...prev, [id]: saved }));
    manager.start({ id, url, localPath });
  }, [api, documentDirectory, manager]);

  const pause = useCallback((id) => manager.pause(id), [manager]);
  const resume = useCallback((id) => manager.resume(id), [manager]);
  const cancel = useCallback(async (id) => {
    manager.cancel(id);
    await downloadStore.remove(id);
    setById((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }, [manager]);
  const remove = cancel;
  const isDownloaded = useCallback((id) => byIdRef.current[id]?.status === 'done', []);

  const value = {
    byId,
    items: Object.values(byId).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    start, pause, resume, cancel, remove, isDownloaded,
  };
  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}

export function useDownloads() {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error('useDownloads must be used within DownloadsProvider');
  return ctx;
}
