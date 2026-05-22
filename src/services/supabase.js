import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const authConfig = Platform.OS !== 'web'
  ? { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } }
  : {};

export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, authConfig)
    : null;

export const isSupabaseConfigured = () => !!supabase;

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signUp(username, password, email) {
  const { data: existing } = await supabase.from('profiles').select('username').eq('username', username.toLowerCase()).maybeSingle();
  if (existing) throw new Error('Username is already taken.');

  const { data, error } = await supabase.auth.signUp({
    email: email.toLowerCase(),
    password,
    options: { data: { username: username.toLowerCase() } },
  });
  if (error) {
    if (error.message?.toLowerCase().includes('rate limit'))
      throw new Error('Too many sign-up attempts. Please wait a few minutes and try again.');
    throw new Error(error.message);
  }
  if (data.session && data.user) {
    await upsertProfile(data.user.id, username.toLowerCase(), email.toLowerCase());
  }
  return data.user;
}

export async function upsertProfile(userId, username, email) {
  if (!supabase) return;
  const { error } = await supabase.from('profiles').upsert({ user_id: userId, username, email }, { onConflict: 'user_id' });
  if (error) console.error('[Supabase] upsertProfile:', error.message);
}

export async function signIn(usernameOrEmail, password) {
  let email;
  if (usernameOrEmail.includes('@')) {
    email = usernameOrEmail.toLowerCase();
  } else {
    const { data: profileRow, error: lookupError } = await supabase.from('profiles').select('email').eq('username', usernameOrEmail.toLowerCase()).maybeSingle();
    if (lookupError) throw new Error('Could not look up username. Please try again.');
    if (!profileRow?.email) throw new Error('Username not found. Please sign in with your email address instead.');
    email = profileRow.email;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === 'email_not_confirmed') throw new Error('Your email is not confirmed. Please check your inbox and confirm your account.');
    if (error.message?.toLowerCase().includes('invalid login credentials') || error.code === 'invalid_credentials') throw new Error('Invalid email or password.');
    throw new Error(error.message);
  }
  if (data.user) {
    const meta = data.user.user_metadata;
    if (meta?.username) await upsertProfile(data.user.id, meta.username, data.user.email);
  }
  return data.user;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export function onAuthStateChange(callback) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}

export async function fetchProfile(userId) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('profiles').select('username, email').eq('user_id', userId).single();
  if (error) return null;
  return data;
}

// ─── App Profiles ────────────────────────────────────────────────────────────

export async function fetchAppProfiles(userId) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('app_profiles').select('id, name, avatar, created_at').eq('user_id', userId).order('created_at', { ascending: true });
  if (error) { console.error('[Supabase] fetchAppProfiles:', error.message); return []; }
  return data;
}

export async function insertAppProfile(userId, { name, avatar = '👤' }) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('app_profiles').insert({ user_id: userId, name: name.trim(), avatar }).select().single();
  if (error) { console.error('[Supabase] insertAppProfile:', error.message); return null; }
  return data;
}

export async function updateAppProfile(profileId, { name, avatar }) {
  if (!supabase) return;
  const { error } = await supabase.from('app_profiles').update({ name: name.trim(), avatar }).eq('id', profileId);
  if (error) console.error('[Supabase] updateAppProfile:', error.message);
}

export async function deleteAppProfile(profileId) {
  if (!supabase) return;
  const { error } = await supabase.from('app_profiles').delete().eq('id', profileId);
  if (error) console.error('[Supabase] deleteAppProfile:', error.message);
}

// ─── IPTV Accounts ───────────────────────────────────────────────────────────

export async function fetchIptvAccounts(profileId) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('iptv_accounts').select('*').eq('profile_id', profileId).order('created_at', { ascending: true });
  if (error) { console.error('[Supabase] fetchIptvAccounts:', error.message); return []; }
  return data.map((row) => ({ id: row.id, nickname: row.nickname || '', host: row.host, username: row.username, password: row.password }));
}

export async function insertIptvAccount(userId, profileId, account) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('iptv_accounts').insert({ user_id: userId, profile_id: profileId, nickname: account.nickname || null, host: account.host, username: account.username, password: account.password }).select().single();
  if (error) { console.error('[Supabase] insertIptvAccount:', error.message); return null; }
  return data.id;
}

export async function updateIptvAccount(accountId, account) {
  if (!supabase) return;
  const { error } = await supabase.from('iptv_accounts').update({ nickname: account.nickname || null, host: account.host, username: account.username, password: account.password }).eq('id', accountId);
  if (error) console.error('[Supabase] updateIptvAccount:', error.message);
}

export async function deleteIptvAccount(accountId) {
  if (!supabase) return;
  const { error } = await supabase.from('iptv_accounts').delete().eq('id', accountId);
  if (error) console.error('[Supabase] deleteIptvAccount:', error.message);
}

// ─── Watch History ────────────────────────────────────────────────────────────

export async function fetchRemoteHistory(userKey) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('watch_history').select('entry').eq('user_key', userKey).order('watched_at', { ascending: false }).limit(50);
  if (error) { console.error('[Supabase] fetchRemoteHistory:', error.message); return []; }
  return data.map((row) => row.entry);
}

export async function upsertHistoryEntry(userKey, entry) {
  if (!supabase) return;
  const { error } = await supabase.from('watch_history').upsert(
    { user_key: userKey, entry_id: entry.id, entry, watched_at: entry.watchedAt },
    { onConflict: 'user_key,entry_id' },
  );
  if (error) console.error('[Supabase] upsertHistoryEntry:', error.message);
}

export async function deleteHistoryEntry(userKey, entryId) {
  if (!supabase) return;
  const { error } = await supabase.from('watch_history').delete().eq('user_key', userKey).eq('entry_id', entryId);
  if (error) console.error('[Supabase] deleteHistoryEntry:', error.message);
}

export function mergeHistories(local, remote) {
  const map = new Map();
  for (const item of local) map.set(item.id, item);
  for (const item of remote) {
    const existing = map.get(item.id);
    if (!existing || new Date(item.watchedAt) > new Date(existing.watchedAt)) map.set(item.id, item);
  }
  return Array.from(map.values()).sort((a, b) => new Date(b.watchedAt) - new Date(a.watchedAt)).slice(0, 20);
}
