import { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import storage from '../utils/storage';
import iptvApi from '../services/iptvApi';
import {
  fetchRemoteHistory, upsertHistoryEntry, deleteHistoryEntry, mergeHistories, MAX_HISTORY,
  fetchFavorites, upsertFavorite, deleteFavorite,
  isSupabaseConfigured, getSession, claimDevice,
  signIn as supabaseSignIn, signUp as supabaseSignUp, signOut as supabaseSignOut,
  onAuthStateChange, fetchProfile, upsertProfile,
  fetchAppProfiles, insertAppProfile, updateAppProfile, deleteAppProfile,
  fetchIptvAccounts, insertIptvAccount,
  updateIptvAccount as supabaseUpdateIptvAccount,
  deleteIptvAccount as supabaseDeleteIptvAccount,
} from '../services/supabase';
import { resolveProgressFields } from './historyEntry';
import { getDeviceSignature } from '../security/deviceSignature';
import { setDeviceId } from '../services/deviceHeader';

const AppContext = createContext();

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
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

  // ─── App profiles ──────────────────────────────────────────────────────────
  const [appProfiles, setAppProfiles]       = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);

  // ─── Content ───────────────────────────────────────────────────────────────
  const [contentType, setContentType] = useState('live');
  const [channels, setChannels]       = useState([]);
  const [filteredChannels, setFilteredChannels] = useState([]);
  const [currentChannelIndex, setCurrentChannelIndex] = useState(-1);
  const [users, setUsers]             = useState([]);
  const [activeUserId, setActiveUserId] = useState(null);
  const [movieCategories, setMovieCategories]   = useState([]);
  const [movies, setMovies]                     = useState([]);
  const [currentMovieCategory, setCurrentMovieCategory] = useState(null);
  const [seriesCategories, setSeriesCategories] = useState([]);
  const [series, setSeries]                     = useState([]);
  const [currentSeriesCategory, setCurrentSeriesCategory] = useState(null);
  const [currentSeries, setCurrentSeries]       = useState(null);
  const [seriesSeasons, setSeriesSeasons]       = useState({});

  // ─── Watch history ─────────────────────────────────────────────────────────
  const [watchHistory, setWatchHistory] = useState([]);
  const watchHistoryRef = useRef([]);
  watchHistoryRef.current = watchHistory;
  const [isSyncing, setIsSyncing] = useState(false);
  // Pending progress upserts keyed by `${type}_${streamId}` so switching streams
  // does not clobber the in-flight debounce of another stream.
  const progressSyncTimers = useRef(new Map());
  const pendingProgressEntries = useRef(new Map());
  const localPersistTimer = useRef(null);

  // ─── My List (watch later) ───────────────────────────────────────────────────
  const [myList, setMyList] = useState([]);
  const myListRef = useRef([]);
  myListRef.current = myList;

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
    setChannels([]); setWatchHistory([]);
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
    setChannels([]); setWatchHistory([]); setContentType('live');
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
  const shouldKeep = (h, newItem) => {
    if (newItem.type === 'series' && h.type === 'series') {
      if (newItem.seriesId && h.seriesId) return h.seriesId !== newItem.seriesId;
      if (newItem.seriesName && h.seriesName) return h.seriesName !== newItem.seriesName;
      return h.streamId !== newItem.streamId;
    }
    return !(h.type === newItem.type && h.streamId === newItem.streamId);
  };

  // Normalize a raw item into a consistent history entry shape so every
  // platform can resolve resume. Single write chokepoint.
  const normalizeHistoryItem = (item) => {
    const type = item.type === 'movie' ? 'movies' : item.type;
    const streamId = item.streamId ?? item.stream_id ?? item.id;
    const episodeId = item.episodeId ?? streamId;
    const cover = item.cover ?? item.poster ?? item.stream_icon ?? item.movie_image ?? null;
    const normalized = { ...item, type, streamId, episodeId, cover };
    if (item.container_extension != null) normalized.container_extension = item.container_extension;
    return normalized;
  };

  const persistHistory = (key, history) => {
    if (!key) return;
    storage.setItem('iptv_history_' + key, JSON.stringify(history));
  };

  const addToWatchHistory = useCallback((rawItem) => {
    const item = normalizeHistoryItem(rawItem);
    const now = new Date().toISOString();
    const prev = watchHistoryRef.current;
    const existingIdx = prev.findIndex((h) => !shouldKeep(h, item));
    let entry, newHistory;
    if (existingIdx === -1) {
      entry = { ...item, watchedAt: now, id: `${item.type}_${item.streamId || item.id}_${Date.now()}`, ...resolveProgressFields(undefined, item) };
      newHistory = [entry, ...prev].slice(0, MAX_HISTORY);
    } else {
      // Re-opening a watched title must NOT reset its saved position: opens carry
      // currentTime = startTime||0, so preserve the previous entry's progress.
      entry = { ...prev[existingIdx], ...item, id: prev[existingIdx].id, watchedAt: now, ...resolveProgressFields(prev[existingIdx], item) };
      newHistory = [entry, ...prev.filter((_, i) => i !== existingIdx)].slice(0, MAX_HISTORY);
    }
    setWatchHistory(newHistory);
    persistHistory(userKey, newHistory);
    if (userKey) upsertHistoryEntry(userKey, entry);
  }, [userKey]);

  const removeFromWatchHistory = useCallback((id) => {
    const newHistory = watchHistoryRef.current.filter((item) => item.id !== id);
    setWatchHistory(newHistory);
    persistHistory(userKey, newHistory);
    if (userKey) deleteHistoryEntry(userKey, id);
  }, [userKey]);

  // Synchronously upsert all pending progress entries and clear their timers.
  // Called when switching streams (for the previous entry), on unmount, and
  // exported for the player to call on background/foreground transitions.
  const flushProgress = useCallback(() => {
    const key = userKeyRef.current;
    for (const timer of progressSyncTimers.current.values()) clearTimeout(timer);
    progressSyncTimers.current.clear();
    const pending = pendingProgressEntries.current;
    pendingProgressEntries.current = new Map();
    clearTimeout(localPersistTimer.current);
    if (!key) return;
    persistHistory(key, watchHistoryRef.current);
    for (const entry of pending.values()) upsertHistoryEntry(key, entry);
  }, []);

  const updateWatchProgress = useCallback((streamId, type, currentTime, duration) => {
    const normType = type === 'movie' ? 'movies' : type;
    const updated = watchHistoryRef.current.map((item) =>
      item.streamId === streamId && item.type === normType
        ? { ...item, currentTime, duration, watchedAt: new Date().toISOString() }
        : item
    );
    setWatchHistory(updated);
    const timerKey = `${normType}_${streamId}`;
    if (userKey) {
      // Flush any pending entry for a *different* stream before scheduling this one.
      for (const [k, timer] of progressSyncTimers.current.entries()) {
        if (k === timerKey) continue;
        clearTimeout(timer);
        progressSyncTimers.current.delete(k);
        const pendingEntry = pendingProgressEntries.current.get(k);
        pendingProgressEntries.current.delete(k);
        if (pendingEntry) upsertHistoryEntry(userKey, pendingEntry);
      }
      const entry = updated.find((item) => item.streamId === streamId && item.type === normType);
      if (entry) pendingProgressEntries.current.set(timerKey, entry);
      clearTimeout(progressSyncTimers.current.get(timerKey));
      progressSyncTimers.current.set(timerKey, setTimeout(() => {
        const e = pendingProgressEntries.current.get(timerKey);
        progressSyncTimers.current.delete(timerKey);
        pendingProgressEntries.current.delete(timerKey);
        if (e) upsertHistoryEntry(userKey, e);
      }, 5000));
    }
    // Debounce local persistence so a hard kill keeps resume without writing
    // storage on every progress tick.
    clearTimeout(localPersistTimer.current);
    localPersistTimer.current = setTimeout(() => persistHistory(userKey, watchHistoryRef.current), 5000);
  }, [userKey]);

  // ─── My List (watch later) ───────────────────────────────────────────────────
  const myListId = (type, streamId) => `mylist_${type}_${streamId}`;

  const addToMyList = useCallback((item) => {
    const streamId = item.streamId ?? item.stream_id ?? item.seriesId ?? item.id;
    const id = myListId(item.type, streamId);
    const prev = myListRef.current;
    if (prev.some((m) => m.id === id)) return;
    const entry = { ...item, streamId, id, addedAt: new Date().toISOString() };
    const updated = [entry, ...prev];
    setMyList(updated);
    if (userKey) {
      storage.setItem(`iptv_mylist_${userKey}`, JSON.stringify(updated));
      upsertFavorite(userKey, entry);
    }
  }, [userKey]);

  const removeFromMyList = useCallback((id) => {
    const updated = myListRef.current.filter((m) => m.id !== id);
    setMyList(updated);
    if (userKey) {
      storage.setItem(`iptv_mylist_${userKey}`, JSON.stringify(updated));
      deleteFavorite(userKey, id);
    }
  }, [userKey]);

  const isInMyList = useCallback((type, streamId) =>
    myListRef.current.some((m) => m.id === myListId(type, streamId)), []);

  // Merge favorites by id, keeping the most-recent addedAt for shared ids.
  const mergeFavorites = (local, remote) => {
    const map = new Map();
    for (const item of local) map.set(item.id, item);
    for (const item of remote) {
      const existing = map.get(item.id);
      if (!existing || new Date(item.addedAt) > new Date(existing.addedAt))
        map.set(item.id, item);
    }
    return Array.from(map.values())
      .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  };

  // Fetch remote history/favorites for a userKey, merge with local (which is
  // authoritative for local-only / locally-newer entries), then re-upsert the
  // entries remote is missing or stale on so the server catches up.
  const loadLibrary = useCallback(async (key) => {
    if (!key) return;
    // Hydrate local first so we never blind-replace with a thinner remote set.
    let localHistory = [];
    let localFavorites = [];
    try {
      const rawH = await storage.getItem('iptv_history_' + key);
      if (rawH) localHistory = JSON.parse(rawH);
    } catch { /**/ }
    try {
      const rawF = await storage.getItem(`iptv_mylist_${key}`);
      if (rawF) localFavorites = JSON.parse(rawF);
    } catch { /**/ }
    // Prefer in-memory state if it is already richer than what is on disk.
    const baseHistory = watchHistoryRef.current.length >= localHistory.length
      ? watchHistoryRef.current : localHistory;
    const baseFavorites = myListRef.current.length >= localFavorites.length
      ? myListRef.current : localFavorites;

    if (!isSupabaseConfigured()) {
      setWatchHistory(baseHistory);
      setMyList(baseFavorites);
      return;
    }

    setIsSyncing(true);
    try {
      const [remoteHistory, remoteFavorites] = await Promise.all([
        fetchRemoteHistory(key),
        fetchFavorites(key),
      ]);

      const mergedHistory = mergeHistories(baseHistory, remoteHistory);
      setWatchHistory(mergedHistory);
      persistHistory(key, mergedHistory);
      // Re-upsert entries that are local-only or locally-newer so remote catches up.
      const remoteById = new Map(remoteHistory.map((e) => [e.id, e]));
      for (const entry of mergedHistory) {
        const r = remoteById.get(entry.id);
        if (!r || new Date(entry.watchedAt) > new Date(r.watchedAt))
          upsertHistoryEntry(key, entry);
      }

      const mergedFavorites = mergeFavorites(baseFavorites, remoteFavorites);
      setMyList(mergedFavorites);
      storage.setItem(`iptv_mylist_${key}`, JSON.stringify(mergedFavorites));
      const remoteFavById = new Map(remoteFavorites.map((e) => [e.id, e]));
      for (const entry of mergedFavorites) {
        const r = remoteFavById.get(entry.id);
        if (!r || new Date(entry.addedAt) > new Date(r.addedAt))
          upsertFavorite(key, entry);
      }
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Re-run the library fetch/merge for the current userKey (player calls this
  // on app foreground so remote edits made elsewhere are pulled in).
  const refetchLibrary = useCallback(() => {
    loadLibrary(userKeyRef.current);
  }, [loadLibrary]);

  // ─── Video ─────────────────────────────────────────────────────────────────
  const playVideo  = (video) => setCurrentVideo(video);
  const closeVideo = () => setCurrentVideo(null);

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

  const loadSavedUsers = async (profileId) => {
    const key = profileId ? `iptv_users_${profileId}` : 'iptv_users';
    try {
      const saved = await storage.getItem(key);
      if (saved) { const p = JSON.parse(saved); setUsers(p.users || []); setActiveUserId(p.activeUserId || null); }
      else { setUsers([]); setActiveUserId(null); }
    } catch (e) { console.error('loadSavedUsers:', e); }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Claim (bind or verify) this device once we have an authed user, before any
  // data loads. deviceStatus gates every data-loading effect below. On any
  // failure we fail closed ('denied') rather than bypass the lock.
  useEffect(() => {
    let cancelled = false;
    if (!authUser) { setDeviceStatus('pending'); return; }
    (async () => {
      try {
        const sig = await getDeviceSignature();
        setDeviceId(sig.primary);
        const status = await claimDevice({ deviceId: sig.primary, platform: sig.platform, secondary: sig.secondary });
        if (!cancelled) setDeviceStatus(status === 'denied' ? 'denied' : 'ok');
      } catch {
        if (!cancelled) setDeviceStatus('denied');
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser || deviceStatus !== 'ok') return;
    const meta = authUser.user_metadata;
    if (meta?.username) {
      // Set the profile optimistically from the JWT metadata we already hold so
      // first paint doesn't wait on two serial Supabase calls. Reconcile in the
      // background: fire-and-forget upsert, then re-read for any server fields.
      setProfile({ username: meta.username, email: authUser.email });
      upsertProfile(authUser.id, meta.username, authUser.email).catch(() => {});
    } else {
      fetchProfile(authUser.id).then((p) => { if (p) setProfile(p); }).catch(() => {});
    }
    fetchAppProfiles(authUser.id).then(setAppProfiles).catch(() => {});
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
        iptvApi.setCredentials(user.host, user.username, user.password);
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
          if (!cancelled && remote.length > 0) applyAccounts(remote);
        } catch { /**/ }
      }

      if (!cancelled && !applied) { setUsers([]); setActiveUserId(null); }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfileId]);

  useEffect(() => {
    if (!activeUserId) return;
    const user = users.find((u) => u.id === activeUserId);
    if (user) iptvApi.setCredentials(user.host, user.username, user.password);
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

  // Library (watch history + favorites) load, keyed on userKey (NOT
  // activeProfileId) so the fetch target always matches the write target.
  // Hydrates local first, merges remote, and re-upserts local-newer entries.
  useEffect(() => {
    if (!userKey || deviceStatus !== 'ok') { setWatchHistory([]); setMyList([]); return; }
    loadLibrary(userKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userKey, deviceStatus]);

  // Flush any pending progress writes when the provider unmounts so we never
  // lose the last few seconds of watch position on app teardown.
  useEffect(() => () => { flushProgress(); }, [flushProgress]);

  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    setFilteredChannels(q ? channels.filter((ch) => ch.name.toLowerCase().includes(q)) : channels);
  }, [searchQuery, channels]);

  // ─── Context value ─────────────────────────────────────────────────────────
  const value = useMemo(() => ({
    authUser, authLoading, profile, deviceStatus, signIn, signUp, signOut,
    appProfiles, activeProfileId, activeProfile, switchProfile, addProfile, updateProfile, removeProfile,
    contentType, setContentType,
    channels, setChannels, filteredChannels, currentChannelIndex, setCurrentChannelIndex,
    users, setUsers, activeUserId, setActiveUserId, saveUsers, addUser, updateUser, removeUser,
    movieCategories, setMovieCategories, movies, setMovies,
    currentMovieCategory, setCurrentMovieCategory,
    seriesCategories, setSeriesCategories, series, setSeries,
    currentSeriesCategory, setCurrentSeriesCategory,
    currentSeries, setCurrentSeries, seriesSeasons, setSeriesSeasons,
    watchHistory, addToWatchHistory, updateWatchProgress, removeFromWatchHistory,
    flushProgress, refetchLibrary, isSyncing,
    myList, addToMyList, removeFromMyList, isInMyList,
    currentVideo, playVideo, closeVideo,
    searchQuery, setSearchQuery, isLoading, setIsLoading, error, setError,
    saveChannels, loadSavedUsers, loadSavedChannels,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [authUser, authLoading, profile, deviceStatus, appProfiles, activeProfileId, activeProfile,
    contentType, channels, filteredChannels, currentChannelIndex,
    users, activeUserId, watchHistory, isSyncing, myList, currentVideo,
    searchQuery, isLoading, error,
    signIn, signUp, signOut, switchProfile, addProfile, updateProfile, removeProfile,
    addUser, updateUser, removeUser, saveUsers,
    addToWatchHistory, updateWatchProgress, removeFromWatchHistory,
    flushProgress, refetchLibrary,
    addToMyList, removeFromMyList, isInMyList]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
