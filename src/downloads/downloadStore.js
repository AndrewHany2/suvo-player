import AsyncStorage from '../utils/storage.js';

export const STORAGE_KEY = 'suvo.downloads.v1';

/** Pure, standalone — no storage needed. */
export function makeId(item) {
  if (item.kind === 'movie') return `movie:${item.streamId}`;
  return `ep:${item.seriesId}:${item.season}:${item.episode}`;
}

/**
 * Build a metadata store over an injected async storage backend exposing
 * getItem/setItem/removeItem (AsyncStorage in the app; an in-memory fake in
 * tests). The whole collection is one JSON blob under STORAGE_KEY.
 */
export function createDownloadStore(storage) {
  async function loadAll() {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  async function saveAll(map) {
    await storage.setItem(STORAGE_KEY, JSON.stringify(map));
  }

  return {
    loadAll,
    async getAll() {
      const map = await loadAll();
      return Object.values(map).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    },
    async get(id) {
      const map = await loadAll();
      return map[id] || null;
    },
    async put(record) {
      const map = await loadAll();
      const now = Date.now();
      const next = { createdAt: now, ...map[record.id], ...record, updatedAt: now };
      map[record.id] = next;
      await saveAll(map);
      return next;
    },
    async patch(id, fields) {
      const map = await loadAll();
      if (!map[id]) return null;
      const next = { ...map[id], ...fields, updatedAt: Date.now() };
      map[id] = next;
      await saveAll(map);
      return next;
    },
    async remove(id) {
      const map = await loadAll();
      delete map[id];
      await saveAll(map);
    },
  };
}

/** The app-wide singleton bound to real AsyncStorage. */
export const downloadStore = createDownloadStore(AsyncStorage);
