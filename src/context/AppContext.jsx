import { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { AppState } from 'react-native';
import storage from '../utils/storage';
import { contentService } from '../domain/services/ContentService';
import {
  fetchRemoteHistory, upsertHistoryEntry, deleteHistoryEntry,
  fetchFavorites, upsertFavorite, deleteFavorite,
  isSupabaseConfigured, getSession, claimDevice,
  signIn as supabaseSignIn, signUp as supabaseSignUp, signOut as supabaseSignOut,
  onAuthStateChange, fetchProfile, fetchEntitlement,
  fetchAppProfiles, insertAppProfile, updateAppProfile, deleteAppProfile,
  fetchIptvAccounts, insertIptvAccount,
  updateIptvAccount as supabaseUpdateIptvAccount,
  deleteIptvAccount as supabaseDeleteIptvAccount,
} from '../services/supabase';
import { normalizeHistoryItem, upsertHistoryItem, applyProgress, resolveAuthoritative, MAX_HISTORY } from './historyProgress';
import { accountKeyOf } from './accountScope';
import { pickLibraryBase } from './libraryBase';
import { getDeviceSignature } from '../security/deviceSignature';
import { setDeviceId } from '../services/deviceHeader';

const AppContext = createContext();
// Playback (currentVideo + play/close) and watch history live in their OWN
// contexts, split out of the main app value. currentVideo changes on play/close
// and watchHistory is rewritten ~once/second by progress writes during
// playback; keeping them in the single app value re-rendered every useApp()
// consumer (the whole browse/nav tree) on each tick. Now only components that
// read playback / history via the dedicated hooks below re-render on those
// changes. The state + all logic still live in AppProvider — this is purely how
// the value is exposed (three memoized slices, three nested providers).
const PlaybackContext = createContext();
const WatchHistoryContext = createContext();

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};

export const usePlayback = () => {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error('usePlayback must be used within AppProvider');
  return ctx;
};

export const useWatchHistory = () => {
  const ctx = useContext(WatchHistoryContext);
  if (!ctx) throw new Error('useWatchHistory must be used within AppProvider');
  return ctx;
};

export const AppProvider = ({ children }) => {
  // ─── Auth ─────────────────────────────────────────────────────────────────
  const [authUser, setAuthUser]     = useState(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured());
  const [profile, setProfile]       = useState(null);
  // 'pending' until the device is bound/verified server-side; 'ok' unlocks data
  // loads; 'denied' means this account is bound to another device.
  const [deviceStatus, setDeviceStatus] = useState('pending');
  // UX mirror of the server's per-customer self-add gate. Default true so a
  // missing field (older server) never hides the button; only an explicit
  // false hides it. The server (data/iptv.insert) is authoritative.
  const [allowSelfLines, setAllowSelfLines] = useState(true);

  // ─── App profiles ──────────────────────────────────────────────────────────
  const [appProfiles, setAppProfiles]       = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);

  // ─── Content ───────────────────────────────────────────────────────────────
  const [channels, setChannels]       = useState([]);
  const [users, setUsers]             = useState([]);
  const [activeUserId, setActiveUserId] = useState(null);
  // TV layout preference: shelves (Electron-parity) vs. the current grid.
  // Persisted so on-device A/B needs no rebuild. Default true = shelves (Electron-parity).
  const [tvUseShelves, setTvUseShelvesState] = useState(true);
  useEffect(() => {
    storage.getItem('iptv_tv_shelves').then((v) => {
      if (v === '1') setTvUseShelvesState(true);
    });
  }, []);
  const setTvUseShelves = useCallback((next) => {
    setTvUseShelvesState(next);
    storage.setItem('iptv_tv_shelves', next ? '1' : '0');
  }, []);
  const [currentSeries, setCurrentSeries]       = useState(null);

  // ─── Watch history ─────────────────────────────────────────────────────────
  const [watchHistory, setWatchHistory] = useState([]);
  const watchHistoryRef = useRef([]);
  watchHistoryRef.current = watchHistory;
  const [isSyncing, setIsSyncing] = useState(false);
  // Pending progress upserts keyed by `${type}_${streamId}` so switching streams
  // does not clobber the in-flight debounce of another stream.
  const progressSyncTimers = useRef(new Map());
  const pendingProgressEntries = useRef(new Map());

  // ─── My List (watch later) ───────────────────────────────────────────────────
  const [myList, setMyList] = useState([]);
  const myListRef = useRef([]);
  myListRef.current = myList;

  // Which userKey the in-memory library (watchHistory + myList) currently
  // belongs to. loadLibrary uses this so it never treats one profile's list as
  // the base when loading a different profile (which would cross-contaminate
  // favorites/history across profiles).
  const libraryKeyRef = useRef(null);

  // ─── UI ────────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading]     = useState(false);
  const [error, setError]             = useState(null);
  const [currentVideo, setCurrentVideo] = useState(null);

  // ─── Derived ───────────────────────────────────────────────────────────────
  const userKey = useMemo(() => {
    if (activeProfileId) return activeProfileId;
    if (authUser) return authUser.id;
    const user = users.find((u) => u.id === activeUserId);
    return user ? `${user.host}_${user.username}` : null;
  }, [activeProfileId, authUser, users, activeUserId]);

  // Mirror userKey into a ref so flushProgress (unmount/background) reads the
  // current value without being captured stale.
  const userKeyRef = useRef(userKey);
  userKeyRef.current = userKey;

  // The active IPTV account (within the profile). The library (watch history +
  // favorites) is partitioned per account via accountKeyOf(activeAccount): the
  // server scopes each row by that account_key and the local favorites cache key
  // embeds it. No active account ⇒ null key ⇒ nothing loads or saves.
  const activeAccount = useMemo(
    () => users.find((u) => u.id === activeUserId) ?? null,
    [users, activeUserId],
  );
  const activeAccountId = useMemo(() => accountKeyOf(activeAccount), [activeAccount]);
  // Mirror into a ref so the debounced/deferred progress flush scopes the write
  // to the account that was active when it was scheduled.
  const activeAccountRef = useRef(activeAccount);
  activeAccountRef.current = activeAccount;

  const activeProfile = useMemo(
    () => appProfiles.find((p) => p.id === activeProfileId) ?? null,
    [appProfiles, activeProfileId]
  );

  const usersKey = activeProfileId ? `iptv_users_${activeProfileId}` : 'iptv_users';

  // ─── Auth functions ────────────────────────────────────────────────────────
  const signIn  = supabaseSignIn;
  const signUp  = supabaseSignUp;
  const signOut = useCallback(async () => {
    await supabaseSignOut();
    setAuthUser(null); setProfile(null); setAppProfiles([]);
    setActiveProfileId(null); setUsers([]); setActiveUserId(null);
    setChannels([]); setWatchHistory([]); setAllowSelfLines(true);
    await storage.removeItem('iptv_active_profile');
  }, []);

  // ─── Profile operations ────────────────────────────────────────────────────
  const addProfile = useCallback(async ({ name, avatar = '👤' }) => {
    let newProfile = authUser && isSupabaseConfigured()
      ? await insertAppProfile(authUser.id, { name, avatar })
      : null;
    if (!newProfile) newProfile = { id: `local_${Date.now()}`, name: name.trim(), avatar, created_at: new Date().toISOString() };
    setAppProfiles((prev) => {
      const updated = [...prev, newProfile];
      if (!isSupabaseConfigured()) storage.setItem('iptv_profiles', JSON.stringify(updated));
      return updated;
    });
    return newProfile;
  }, [authUser]);

  const updateProfile = useCallback(async (profileId, { name, avatar }) => {
    if (isSupabaseConfigured()) await updateAppProfile(profileId, { name, avatar });
    setAppProfiles((prev) => {
      const updated = prev.map((p) => p.id === profileId ? { ...p, name: name.trim(), avatar } : p);
      if (!isSupabaseConfigured()) storage.setItem('iptv_profiles', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeProfile = useCallback(async (profileId) => {
    if (isSupabaseConfigured()) await deleteAppProfile(profileId);
    setAppProfiles((prev) => {
      const updated = prev.filter((p) => p.id !== profileId);
      if (!isSupabaseConfigured()) storage.setItem('iptv_profiles', JSON.stringify(updated));
      return updated;
    });
    if (activeProfileId === profileId) {
      setActiveProfileId(null); setUsers([]); setActiveUserId(null);
      setChannels([]); setWatchHistory([]);
      await storage.removeItem('iptv_active_profile');
    }
  }, [activeProfileId]);

  const switchProfile = useCallback(async (profileId) => {
    setActiveProfileId(profileId); setUsers([]); setActiveUserId(null);
    setChannels([]); setWatchHistory([]);
    await storage.setItem('iptv_active_profile', profileId);
  }, []);

  // ─── IPTV account operations ───────────────────────────────────────────────
  const addUser = useCallback(async (formData) => {
    const newUser = { id: Date.now().toString(), ...formData };
    if (authUser && activeProfileId && isSupabaseConfigured()) {
      const remoteId = await insertIptvAccount(authUser.id, activeProfileId, formData);
      if (remoteId) newUser.id = remoteId;
    }
    setUsers((prev) => {
      const updated = [...prev, newUser];
      storage.setItem(usersKey, JSON.stringify({ users: updated, activeUserId }));
      return updated;
    });
    return newUser;
  }, [authUser, activeProfileId, activeUserId, usersKey]);

  const updateUser = useCallback(async (id, formData) => {
    if (authUser && isSupabaseConfigured()) await supabaseUpdateIptvAccount(id, formData);
    setUsers((prev) => {
      const updated = prev.map((u) => u.id === id ? { ...u, ...formData } : u);
      storage.setItem(usersKey, JSON.stringify({ users: updated, activeUserId }));
      return updated;
    });
  }, [authUser, activeUserId, usersKey]);

  const removeUser = useCallback(async (id) => {
    if (authUser && isSupabaseConfigured()) await supabaseDeleteIptvAccount(id);
    setUsers((prev) => {
      const updated = prev.filter((u) => u.id !== id);
      storage.setItem(usersKey, JSON.stringify({ users: updated, activeUserId }));
      return updated;
    });
    if (activeUserId === id) setActiveUserId(null);
  }, [authUser, activeUserId, usersKey]);

  const saveUsers = useCallback((override) => {
    const list = override ?? users;
    storage.setItem(usersKey, JSON.stringify({ users: list, activeUserId }));
  }, [users, activeUserId, usersKey]);

  // ─── Watch history ─────────────────────────────────────────────────────────
  // normalize/dedupe/upsert/apply-progress live in the pure historyProgress
  // module so addToWatchHistory and updateWatchProgress agree on the
  // (type, streamId) key and share one create-if-missing chokepoint.
  const addToWatchHistory = useCallback((rawItem) => {
    const accountKey = accountKeyOf(activeAccountRef.current);
    if (!accountKey) return; // require a connected IPTV account
    const item = normalizeHistoryItem(rawItem);
    const now = new Date().toISOString();
    // Re-opening a watched title must NOT reset its saved position: opens carry
    // currentTime = startTime||0, so upsertHistoryItem preserves prior progress.
    const { history: newHistory, entry } = upsertHistoryItem(watchHistoryRef.current, item, now);
    setWatchHistory(newHistory);
    if (userKey) upsertHistoryEntry(userKey, accountKey, entry);
  }, [userKey]);

  const removeFromWatchHistory = useCallback((id) => {
    const accountKey = accountKeyOf(activeAccountRef.current);
    const newHistory = watchHistoryRef.current.filter((item) => item.id !== id);
    setWatchHistory(newHistory);
    if (userKey && accountKey) deleteHistoryEntry(userKey, accountKey, id);
  }, [userKey]);

  // Synchronously upsert all pending progress entries and clear their timers.
  // Called when switching streams (for the previous entry), on unmount, and
  // exported for the player to call on background/foreground transitions.
  const flushProgress = useCallback(() => {
    const key = userKeyRef.current;
    const accountKey = accountKeyOf(activeAccountRef.current);
    for (const timer of progressSyncTimers.current.values()) clearTimeout(timer);
    progressSyncTimers.current.clear();
    const pending = pendingProgressEntries.current;
    pendingProgressEntries.current = new Map();
    if (!key || !accountKey) return;
    for (const entry of pending.values()) upsertHistoryEntry(key, accountKey, entry);
  }, []);

  const updateWatchProgress = useCallback((streamId, type, currentTime, duration) => {
    const accountKey = accountKeyOf(activeAccountRef.current);
    if (!accountKey) return; // require a connected IPTV account
    // Upsert semantics: a progress event with no matching row creates the entry
    // so resume data emitted before/without addToWatchHistory is never lost.
    const { history: updated, entry } = applyProgress(
      watchHistoryRef.current,
      { streamId, type, currentTime, duration },
      new Date().toISOString(),
    );
    setWatchHistory(updated);
    const timerKey = `${entry.type}_${entry.streamId}`;
    if (userKey) {
      // Flush any pending entry for a *different* stream before scheduling this one.
      for (const [k, timer] of progressSyncTimers.current.entries()) {
        if (k === timerKey) continue;
        clearTimeout(timer);
        progressSyncTimers.current.delete(k);
        const pendingEntry = pendingProgressEntries.current.get(k);
        pendingProgressEntries.current.delete(k);
        if (pendingEntry) upsertHistoryEntry(userKey, accountKey, pendingEntry);
      }
      pendingProgressEntries.current.set(timerKey, entry);
      clearTimeout(progressSyncTimers.current.get(timerKey));
      progressSyncTimers.current.set(timerKey, setTimeout(() => {
        const e = pendingProgressEntries.current.get(timerKey);
        progressSyncTimers.current.delete(timerKey);
        pendingProgressEntries.current.delete(timerKey);
        if (e) upsertHistoryEntry(userKey, accountKey, e);
      }, 5000));
    }
  }, [userKey]);

  // ─── My List (watch later) ───────────────────────────────────────────────────
  // Favorites are partitioned per IPTV account by account_key server-side and by
  // the local storage key, so the entry id no longer embeds the account.
  const myListId = (type, streamId) => `mylist_${type}_${streamId}`;
  const isSameFav = (m, type, streamId) =>
    m.type === type && String(m.streamId) === String(streamId);
  const favStorageKey = (key, accountKey) => `iptv_mylist_${key}_${accountKey}`;

  const addToMyList = useCallback((item) => {
    const accountKey = accountKeyOf(activeAccountRef.current);
    if (!accountKey) return; // require a connected IPTV account
    const streamId = item.streamId ?? item.stream_id ?? item.seriesId ?? item.id;
    const prev = myListRef.current;
    if (prev.some((m) => isSameFav(m, item.type, streamId))) return;
    const entry = { ...item, streamId, id: myListId(item.type, streamId), addedAt: new Date().toISOString() };
    const updated = [entry, ...prev];
    setMyList(updated);
    if (userKey) {
      storage.setItem(favStorageKey(userKey, accountKey), JSON.stringify(updated));
      upsertFavorite(userKey, accountKey, entry);
    }
  }, [userKey]);

  // Accepts either a stored row id (History tab passes `item.id`) or the logical
  // key `mylist_${type}_${streamId}` (detail/browse screens reconstruct it).
  const removeFromMyList = useCallback((idArg) => {
    const accountKey = accountKeyOf(activeAccountRef.current);
    const target = myListRef.current.find((m) => m.id === idArg);
    const removeId = target ? target.id : idArg;
    const updated = myListRef.current.filter((m) => m.id !== removeId);
    setMyList(updated);
    if (userKey && accountKey) {
      storage.setItem(favStorageKey(userKey, accountKey), JSON.stringify(updated));
      deleteFavorite(userKey, accountKey, removeId);
    }
  }, [userKey]);

  const isInMyList = useCallback((type, streamId) =>
    myListRef.current.some((m) => isSameFav(m, type, streamId)),
    []);

  // Fetch remote history/favorites for a userKey. The server is authoritative:
  // a successful fetch replaces the local list (so cross-device deletes stick),
  // while a failed fetch or the no-Supabase path falls back to local.
  const loadLibrary = useCallback(async (key, accountKey) => {
    if (!key || !accountKey) return;
    // Watch history is Supabase-only: purge any legacy local history on disk.
    storage.removeItem('iptv_history_' + key);
    // Purge the pre-feature per-profile favorites cache (superseded by the
    // per-account key below) so it can't linger as stale, cross-account data.
    storage.removeItem(`iptv_mylist_${key}`);
    let localFavorites = [];
    try {
      const rawF = await storage.getItem(`iptv_mylist_${key}_${accountKey}`);
      if (rawF) localFavorites = JSON.parse(rawF);
    } catch { /**/ }
    const sameKey = libraryKeyRef.current === `${key}_${accountKey}`;
    const baseFavorites = pickLibraryBase({
      sameKey, inMemory: myListRef.current, onDisk: localFavorites,
    });
    libraryKeyRef.current = `${key}_${accountKey}`;

    if (!isSupabaseConfigured()) {
      setWatchHistory([]);
      setMyList(baseFavorites);
      return;
    }

    setIsSyncing(true);
    try {
      const [historyRes, favoritesRes] = await Promise.all([
        fetchRemoteHistory(key, accountKey).then((data) => ({ ok: true, data }), () => ({ ok: false, data: null })),
        fetchFavorites(key, accountKey).then((data) => ({ ok: true, data }), () => ({ ok: false, data: null })),
      ]);
      const nextHistory = resolveAuthoritative({
        localBase: watchHistoryRef.current, remote: historyRes.data, fetchOk: historyRes.ok,
        tsField: 'watchedAt', cap: MAX_HISTORY,
      });
      setWatchHistory(nextHistory);
      const nextFavorites = resolveAuthoritative({
        localBase: baseFavorites, remote: favoritesRes.data, fetchOk: favoritesRes.ok,
        tsField: 'addedAt',
      });
      setMyList(nextFavorites);
      storage.setItem(`iptv_mylist_${key}_${accountKey}`, JSON.stringify(nextFavorites));
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const refetchLibrary = useCallback(() => {
    // No-op unless a loadable library context is already active. libraryKeyRef
    // is only set once the device-gated library effect has run (user + account
    // + deviceStatus 'ok'), so this keeps every refetch trigger — foreground,
    // tab focus, etc. — behind the same device gate as the initial load.
    if (!libraryKeyRef.current) return;
    loadLibrary(userKeyRef.current, accountKeyOf(activeAccountRef.current));
  }, [loadLibrary]);

  // ─── Video ─────────────────────────────────────────────────────────────────
  // useCallback so the playback context value only changes when currentVideo
  // changes (not on every provider render), keeping playback consumers stable.
  const playVideo  = useCallback((video) => setCurrentVideo(video), []);
  const closeVideo = useCallback(() => setCurrentVideo(null), []);

  // ─── Storage helpers ───────────────────────────────────────────────────────
  const loadSavedChannels = async () => {
    try {
      const saved = await storage.getItem('iptv_channels');
      if (saved) setChannels(JSON.parse(saved));
    } catch (e) { console.error('loadSavedChannels:', e); }
  };

  const saveChannels = async () => {
    try { await storage.setItem('iptv_channels', JSON.stringify(channels)); }
    catch (e) { console.error('saveChannels:', e); }
  };

  // ─── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      (async () => {
        try {
          const savedProfiles = await storage.getItem('iptv_profiles');
          if (savedProfiles) setAppProfiles(JSON.parse(savedProfiles));
        } catch { /**/ }
        loadSavedChannels();
      })();
      return;
    }
    const authTimeout = setTimeout(() => setAuthLoading(false), 8000);
    getSession()
      .then((session) => { setAuthUser(session?.user ?? null); })
      .catch(() => {})
      .finally(() => { clearTimeout(authTimeout); setAuthLoading(false); });
    const unsub = onAuthStateChange((user) => { setAuthUser(user); setAuthLoading(false); });
    return () => { clearTimeout(authTimeout); unsub(); };
  }, []);

  // Claim (bind or verify) this device once we have an authed user, before any
  // data loads. deviceStatus gates every data-loading effect below. On any
  // failure we fail closed ('denied') rather than bypass the lock.
  //
  // In development (__DEV__) we never lock: a denied/failed claim resolves to
  // 'ok' so the device-binding gate can't lock a developer out of their own
  // build. Production keeps the fail-closed behaviour.
  useEffect(() => {
    let cancelled = false;
    if (!authUser) { setDeviceStatus('pending'); return; }
    (async () => {
      try {
        const sig = await getDeviceSignature();
        setDeviceId(sig.primary);
        const status = await claimDevice({ deviceId: sig.primary, platform: sig.platform, secondary: sig.secondary });
        if (!cancelled) setDeviceStatus(status === 'denied' && !__DEV__ ? 'denied' : 'ok');
      } catch {
        if (!cancelled) setDeviceStatus(__DEV__ ? 'ok' : 'denied');
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser || deviceStatus !== 'ok') return;
    // Email-only auth: there is no username in signup metadata anymore, so
    // always fetch the profile from the server (name/email now live in the
    // `profiles` row, set server-side by the `admin`/`data` functions).
    fetchProfile(authUser.id).then((p) => { if (p) setProfile(p); }).catch(() => {});
    fetchAppProfiles(authUser.id).then(setAppProfiles).catch(() => {});
    fetchEntitlement().then((e) => setAllowSelfLines(e?.allowSelfLines !== false)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id, deviceStatus]);

  useEffect(() => {
    if (!activeProfileId) return;
    let cancelled = false;
    (async () => {
      // Read the cached account blob ONCE up front (was read twice before).
      let cached = null;
      try {
        const raw = await storage.getItem(`iptv_users_${activeProfileId}`);
        if (raw) cached = JSON.parse(raw);
      } catch { /**/ }
      const savedActiveId = cached?.activeUserId || null;

      let applied = false;
      const applyAccounts = (accounts) => {
        if (cancelled || !accounts || accounts.length === 0) return;
        setUsers(accounts);
        const user = accounts.find((u) => u.id === savedActiveId) || accounts[0];
        setActiveUserId(user.id);
        contentService.configure(user);
        if (!applied) loadSavedChannels();
        applied = true;
      };

      // Apply cached credentials immediately so the first screen can load
      // without blocking on the Supabase round-trip.
      applyAccounts(cached?.users || []);

      // Reconcile with the server in the background — do NOT await before
      // applying the cached account. Per-category fetches in the LiveTV/Movies/
      // Series screens populate channels and warm category caches on tab mount,
      // so we no longer eagerly pull the unfiltered all-channels endpoint here.
      if (isSupabaseConfigured()) {
        try {
          const remote = await fetchIptvAccounts(activeProfileId);
          if (!cancelled && remote.length > 0) {
            // Merge remote OVER the cached row of the same id so fields the
            // backend doesn't return (e.g. `type`/`url` before the M3U columns
            // are deployed) are preserved from the local cache instead of being
            // clobbered to undefined — which would misroute an M3U account
            // through the Xtream fetch path.
            const cachedById = new Map((cached?.users || []).map((u) => [u.id, u]));
            const merged = remote.map((r) => {
              const local = cachedById.get(r.id);
              return local ? { ...local, ...r, type: r.type ?? local.type, url: r.url ?? local.url } : r;
            });
            applyAccounts(merged);
          }
        } catch { /**/ }
      }

      if (!cancelled && !applied) { setUsers([]); setActiveUserId(null); }
    })();
    return () => { cancelled = true; };
  }, [activeProfileId]);

  useEffect(() => {
    if (!activeUserId) return;
    const user = users.find((u) => u.id === activeUserId);
    if (user) contentService.configure(user);
    storage.getItem(usersKey).then((saved) => {
      const parsed = saved ? JSON.parse(saved) : {};
      storage.setItem(usersKey, JSON.stringify({ ...parsed, activeUserId }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUserId]);

  // Persist the accumulated channel list, debounced: web/native LiveTV appends
  // categories incrementally, so without debouncing every append would
  // re-stringify the whole growing array on the JS thread.
  useEffect(() => {
    if (channels.length === 0) return;
    const t = setTimeout(() => { saveChannels(); }, 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels]);

  // Library (watch history + favorites) load, keyed on (userKey, activeAccountId)
  // so the fetch target always matches the write target and it reloads when the
  // active IPTV account switches. No active account ⇒ empty library and no fetch
  // (favorites/history require a connected IPTV account).
  useEffect(() => {
    const libKey = userKey && activeAccountId ? `${userKey}_${activeAccountId}` : null;
    if (!libKey || deviceStatus !== 'ok') {
      libraryKeyRef.current = null; setWatchHistory([]); setMyList([]); return;
    }
    // Switching profile/account: drop the previous lists immediately so they
    // never flash (or get merged) under the new key while remote loads.
    if (libraryKeyRef.current !== libKey) { setWatchHistory([]); setMyList([]); }
    loadLibrary(userKey, activeAccountId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userKey, activeAccountId, deviceStatus]);

  // Keep the library fresh across devices. History/favorites sync on load, not
  // live, so a device that was backgrounded while another device wrote an entry
  // (e.g. watch progress recorded on the desktop) would show a stale list until
  // it happened to reload. Refetch whenever the app returns to the foreground.
  // On web/Electron react-native-web maps AppState to document visibility, so
  // this covers every platform from one place. The libraryKeyRef guard means we
  // only refetch when a loadable (user + account + device-ok) context exists.
  useEffect(() => {
    let prev = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const wasHidden = prev === 'background' || prev === 'inactive';
      prev = next;
      if (wasHidden && next === 'active' && libraryKeyRef.current) refetchLibrary();
    });
    return () => sub.remove();
  }, [refetchLibrary]);

  // Flush any pending progress writes when the provider unmounts so we never
  // lose the last few seconds of watch position on app teardown.
  useEffect(() => () => { flushProgress(); }, [flushProgress]);

  // ─── Context value ─────────────────────────────────────────────────────────
  const value = useMemo(() => ({
    authUser, authLoading, profile, deviceStatus, signIn, signUp, signOut,
    appProfiles, activeProfileId, activeProfile, switchProfile, addProfile, updateProfile, removeProfile,
    channels, setChannels,
    users, setUsers, activeUserId, setActiveUserId, saveUsers, addUser, updateUser, removeUser,
    activeAccountId,
    currentSeries, setCurrentSeries,
    refetchLibrary, isSyncing,
    myList, addToMyList, removeFromMyList, isInMyList,
    searchQuery, setSearchQuery, isLoading, setIsLoading, error, setError,
    saveChannels, loadSavedChannels,
    tvUseShelves, setTvUseShelves,
    allowSelfLines,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [authUser, authLoading, profile, deviceStatus, appProfiles, activeProfileId, activeProfile,
    tvUseShelves,
    channels,
    users, activeUserId, isSyncing, myList,
    activeAccountId,
    searchQuery, isLoading, error,
    signIn, signUp, signOut, switchProfile, addProfile, updateProfile, removeProfile,
    addUser, updateUser, removeUser, saveUsers,
    refetchLibrary,
    addToMyList, removeFromMyList, isInMyList,
    allowSelfLines]);

  // Playback slice — changes only on play/close (currentVideo); playVideo/
  // closeVideo are stable (useCallback), so browse/nav trees reading only `value`
  // don't re-render when a video opens or closes.
  const playbackValue = useMemo(
    () => ({ currentVideo, playVideo, closeVideo }),
    [currentVideo, playVideo, closeVideo],
  );

  // Watch-history slice — watchHistory is rewritten ~once/second by progress
  // writes during playback, so isolating it here keeps that churn off every
  // other consumer. The functions are stable (useCallback).
  const historyValue = useMemo(
    () => ({ watchHistory, addToWatchHistory, updateWatchProgress, removeFromWatchHistory, flushProgress }),
    [watchHistory, addToWatchHistory, updateWatchProgress, removeFromWatchHistory, flushProgress],
  );

  return (
    <AppContext.Provider value={value}>
      <PlaybackContext.Provider value={playbackValue}>
        <WatchHistoryContext.Provider value={historyValue}>
          {children}
        </WatchHistoryContext.Provider>
      </PlaybackContext.Provider>
    </AppContext.Provider>
  );
};
