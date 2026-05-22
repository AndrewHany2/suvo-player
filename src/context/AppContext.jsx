import { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import storage from '../utils/storage';
import iptvApi from '../services/iptvApi';
import {
  fetchRemoteHistory, upsertHistoryEntry, deleteHistoryEntry,
  isSupabaseConfigured, getSession,
  signIn as supabaseSignIn, signUp as supabaseSignUp, signOut as supabaseSignOut,
  onAuthStateChange, fetchProfile, upsertProfile,
  fetchAppProfiles, insertAppProfile, updateAppProfile, deleteAppProfile,
  fetchIptvAccounts, insertIptvAccount,
  updateIptvAccount as supabaseUpdateIptvAccount,
  deleteIptvAccount as supabaseDeleteIptvAccount,
} from '../services/supabase';

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
  const progressSyncTimer = useRef(null);

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

  const activeProfile = useMemo(
    () => appProfiles.find((p) => p.id === activeProfileId) ?? null,
    [appProfiles, activeProfileId]
  );

  const usersKey = activeProfileId ? `iptv_users_${activeProfileId}` : 'iptv_users';

  // ─── Auth functions ────────────────────────────────────────────────────────
  const signIn  = useCallback((u, p) => supabaseSignIn(u, p), []);
  const signUp  = useCallback((u, p, e) => supabaseSignUp(u, p, e), []);
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

  const addToWatchHistory = (item) => {
    const now = new Date().toISOString();
    const prev = watchHistoryRef.current;
    const existingIdx = prev.findIndex((h) => !shouldKeep(h, item));
    let entry, newHistory;
    if (existingIdx === -1) {
      entry = { ...item, watchedAt: now, id: `${item.type}_${item.streamId || item.id}_${Date.now()}`, currentTime: item.currentTime || 0, duration: item.duration || 0 };
      newHistory = [entry, ...prev].slice(0, 20);
    } else {
      entry = { ...prev[existingIdx], ...item, id: prev[existingIdx].id, watchedAt: now, currentTime: item.currentTime || 0, duration: item.duration || 0 };
      newHistory = [entry, ...prev.filter((_, i) => i !== existingIdx)].slice(0, 20);
    }
    setWatchHistory(newHistory);
    if (userKey) upsertHistoryEntry(userKey, entry);
  };

  const removeFromWatchHistory = (id) => {
    const newHistory = watchHistoryRef.current.filter((item) => item.id !== id);
    setWatchHistory(newHistory);
    if (userKey) deleteHistoryEntry(userKey, id);
  };

  const updateWatchProgress = useCallback((streamId, type, currentTime, duration) => {
    const updated = watchHistoryRef.current.map((item) =>
      item.streamId === streamId && item.type === type
        ? { ...item, currentTime, duration, watchedAt: new Date().toISOString() }
        : item
    );
    setWatchHistory(updated);
    if (userKey) {
      clearTimeout(progressSyncTimer.current);
      const entry = updated.find((item) => item.streamId === streamId && item.type === type);
      progressSyncTimer.current = setTimeout(() => { if (entry) upsertHistoryEntry(userKey, entry); }, 5000);
    }
  }, [userKey]);

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
    getSession().then((session) => { setAuthUser(session?.user ?? null); setAuthLoading(false); });
    const unsub = onAuthStateChange((user) => { setAuthUser(user); setAuthLoading(false); });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const meta = authUser.user_metadata;
    if (meta?.username) {
      upsertProfile(authUser.id, meta.username, authUser.email)
        .then(() => fetchProfile(authUser.id).then((p) => setProfile(p)));
    } else {
      fetchProfile(authUser.id).then((p) => setProfile(p));
    }
    fetchAppProfiles(authUser.id).then(setAppProfiles);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id]);

  useEffect(() => {
    if (!activeProfileId) return;
    (async () => {
      let accounts = [];
      if (isSupabaseConfigured()) accounts = await fetchIptvAccounts(activeProfileId);
      if (accounts.length === 0) {
        try {
          const raw = await storage.getItem(`iptv_users_${activeProfileId}`);
          if (raw) { const p = JSON.parse(raw); accounts = p.users || []; }
        } catch { /**/ }
      }
      if (accounts.length === 0) { setUsers([]); setActiveUserId(null); return; }
      setUsers(accounts);

      let savedActiveId = null;
      try {
        const raw = await storage.getItem(`iptv_users_${activeProfileId}`);
        if (raw) savedActiveId = JSON.parse(raw)?.activeUserId || null;
      } catch { /**/ }

      const user = accounts.find((u) => u.id === savedActiveId) || accounts[0];
      setActiveUserId(user.id);
      iptvApi.setCredentials(user.host, user.username, user.password);

      loadSavedChannels();
      setIsLoading(true);
      try {
        const data = await iptvApi.getLiveStreams();
        setChannels(data.map((ch) => ({
          name: ch.name,
          url: iptvApi.buildStreamUrl('live', ch.stream_id, ch.stream_type || 'ts'),
          id: ch.stream_id, stream_id: ch.stream_id,
        })));
      } catch (e) { console.error('[AutoLoad] channels:', e); }
      finally { setIsLoading(false); }

      iptvApi.getVODCategories().catch(() => {});
      iptvApi.getSeriesCategories().catch(() => {});
    })();

    if (isSupabaseConfigured()) {
      setIsSyncing(true);
      fetchRemoteHistory(activeProfileId)
        .then((remote) => setWatchHistory(remote))
        .finally(() => setIsSyncing(false));
    }
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

  useEffect(() => { if (channels.length > 0) saveChannels(); }, [channels]);

  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    setFilteredChannels(q ? channels.filter((ch) => ch.name.toLowerCase().includes(q)) : channels);
  }, [searchQuery, channels]);

  // ─── Context value ─────────────────────────────────────────────────────────
  const value = useMemo(() => ({
    authUser, authLoading, profile, signIn, signUp, signOut,
    appProfiles, activeProfileId, activeProfile, switchProfile, addProfile, updateProfile, removeProfile,
    contentType, setContentType,
    channels, setChannels, filteredChannels, currentChannelIndex, setCurrentChannelIndex,
    users, setUsers, activeUserId, setActiveUserId, saveUsers, addUser, updateUser, removeUser,
    movieCategories, setMovieCategories, movies, setMovies,
    currentMovieCategory, setCurrentMovieCategory,
    seriesCategories, setSeriesCategories, series, setSeries,
    currentSeriesCategory, setCurrentSeriesCategory,
    currentSeries, setCurrentSeries, seriesSeasons, setSeriesSeasons,
    watchHistory, addToWatchHistory, updateWatchProgress, removeFromWatchHistory, isSyncing,
    currentVideo, playVideo, closeVideo,
    searchQuery, setSearchQuery, isLoading, setIsLoading, error, setError,
    saveChannels, loadSavedUsers, loadSavedChannels,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [authUser, authLoading, profile, appProfiles, activeProfileId, activeProfile,
    contentType, channels, filteredChannels, currentChannelIndex,
    users, activeUserId, watchHistory, isSyncing, currentVideo,
    searchQuery, isLoading, error,
    signIn, signUp, signOut, switchProfile, addProfile, updateProfile, removeProfile,
    addUser, updateUser, removeUser, saveUsers,
    addToWatchHistory, updateWatchProgress, removeFromWatchHistory]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
