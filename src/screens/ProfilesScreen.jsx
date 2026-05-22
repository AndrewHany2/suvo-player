import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator, FlatList,
} from 'react-native';
import { useApp } from '../context/AppContext';

const AVATARS = ['👤','👨','👩','👦','👧','👴','👵','🧑','🎮','🎬','🍿','⚽','🎵','🦸','🎨','🐱'];

export default function ProfilesScreen() {
  const { appProfiles, activeProfileId, switchProfile, addProfile, updateProfile, removeProfile } = useApp();

  const [view, setView] = useState('select'); // 'select' | 'manage' | 'form'
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ name: '', avatar: '👤' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const resetForm = () => {
    setFormData({ name: '', avatar: '👤' });
    setEditingId(null);
    setError(null);
    setView('manage');
  };

  const openAdd = () => {
    setFormData({ name: '', avatar: '👤' });
    setEditingId(null);
    setError(null);
    setView('form');
  };

  const openEdit = (p) => {
    setFormData({ name: p.name, avatar: p.avatar });
    setEditingId(p.id);
    setError(null);
    setView('form');
  };

  const handleSave = async () => {
    if (!formData.name.trim()) { setError('Profile name is required.'); return; }
    setLoading(true);
    setError(null);
    try {
      if (editingId) {
        await updateProfile(editingId, formData);
      } else {
        const p = await addProfile(formData);
        if (p && view !== 'manage') switchProfile(p.id);
      }
      resetForm();
    } catch (err) {
      setError(err?.message || 'Failed to save profile.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (profileId) => {
    if (confirmDeleteId !== profileId) { setConfirmDeleteId(profileId); return; }
    setLoading(true);
    setConfirmDeleteId(null);
    try {
      await removeProfile(profileId);
    } catch (err) {
      setError(err?.message || 'Failed to delete.');
    } finally {
      setLoading(false);
    }
  };

  // ── Form view (add / edit) ────────────────────────────────────────────────
  if (view === 'form') {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.formScroll}>
          <Text style={styles.formTitle}>{editingId ? 'Edit Profile' : 'New Profile'}</Text>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Text style={styles.label}>Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Dad, Kids…"
            placeholderTextColor="#666"
            value={formData.name}
            onChangeText={(v) => setFormData({ ...formData, name: v })}
            autoCapitalize="words"
            editable={!loading}
          />

          <Text style={styles.label}>Avatar</Text>
          <View style={styles.avatarGrid}>
            {AVATARS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={[styles.avatarBtn, formData.avatar === emoji && styles.avatarBtnActive]}
                onPress={() => setFormData({ ...formData, avatar: emoji })}
              >
                <Text style={styles.avatarEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.formActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={resetForm} disabled={loading}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, (loading || !formData.name.trim()) && styles.btnDisabled]}
              onPress={handleSave}
              disabled={loading || !formData.name.trim()}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.saveBtnText}>{editingId ? 'Save Changes' : 'Create Profile'}</Text>
              }
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Manage view (list with edit/delete) ──────────────────────────────────
  if (view === 'manage') {
    return (
      <View style={styles.container}>
        <View style={styles.manageHeader}>
          <TouchableOpacity onPress={() => { setView('select'); setError(null); setConfirmDeleteId(null); }}>
            <Text style={styles.backBtn}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.manageTitle}>Manage Profiles</Text>
          <TouchableOpacity style={styles.addBtn} onPress={openAdd} disabled={loading}>
            <Text style={styles.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {!!error && <Text style={[styles.error, { marginHorizontal: 20 }]}>{error}</Text>}

        {appProfiles.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No profiles yet.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={openAdd}>
              <Text style={styles.primaryBtnText}>Create First Profile</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={appProfiles}
            keyExtractor={(p) => p.id}
            contentContainerStyle={styles.manageList}
            renderItem={({ item: p }) => (
              <View style={[styles.manageCard, activeProfileId === p.id && styles.manageCardActive]}>
                <View style={styles.manageCardLeft}>
                  <Text style={styles.manageCardAvatar}>{p.avatar}</Text>
                  <View>
                    <Text style={styles.manageCardName}>{p.name}</Text>
                    {activeProfileId === p.id && (
                      <Text style={styles.activeBadge}>✓ Active</Text>
                    )}
                    {confirmDeleteId === p.id && (
                      <Text style={styles.confirmText}>Tap Delete again to confirm</Text>
                    )}
                  </View>
                </View>
                <View style={styles.manageCardActions}>
                  {activeProfileId !== p.id && (
                    <TouchableOpacity
                      style={styles.switchBtn}
                      onPress={() => { switchProfile(p.id); setView('select'); }}
                      disabled={loading}
                    >
                      <Text style={styles.switchBtnText}>Switch</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(p)} disabled={loading}>
                    <Text style={styles.editBtnText}>✏️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.deleteBtn, confirmDeleteId === p.id && styles.deleteBtnConfirm]}
                    onPress={() => handleDelete(p.id)}
                    disabled={loading}
                  >
                    <Text style={styles.deleteBtnText}>{confirmDeleteId === p.id ? 'Confirm' : '🗑️'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )}
      </View>
    );
  }

  // ── Select view ("Who's watching?") ──────────────────────────────────────
  return (
    <View style={styles.container}>
      <Text style={styles.whoTitle}>Who's watching?</Text>

      <ScrollView contentContainerStyle={styles.profilesRow}>
        {appProfiles.map((p) => (
          <TouchableOpacity key={p.id} style={styles.profileCard} onPress={() => switchProfile(p.id)}>
            <View style={styles.profileCardAvatar}>
              <Text style={styles.profileCardEmoji}>{p.avatar}</Text>
            </View>
            <Text style={styles.profileCardName} numberOfLines={1}>{p.name}</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={[styles.profileCard, styles.profileCardAdd]} onPress={openAdd}>
          <View style={[styles.profileCardAvatar, styles.profileCardAvatarAdd]}>
            <Text style={styles.profileCardPlusIcon}>+</Text>
          </View>
          <Text style={styles.profileCardName}>Add Profile</Text>
        </TouchableOpacity>
      </ScrollView>

      {appProfiles.length > 0 && (
        <TouchableOpacity onPress={() => setView('manage')} style={styles.manageLink}>
          <Text style={styles.manageLinkText}>Manage Profiles</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },

  // Who's watching
  whoTitle: { color: '#fff', fontSize: 28, fontWeight: '700', textAlign: 'center', marginTop: 60, marginBottom: 40 },
  profilesRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 20, paddingHorizontal: 20, paddingBottom: 30 },
  profileCard: { alignItems: 'center', width: 110 },
  profileCardAvatar: { width: 90, height: 90, borderRadius: 12, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#2a2a4e', marginBottom: 10 },
  profileCardAvatarAdd: { borderStyle: 'dashed', borderColor: '#444' },
  profileCardEmoji: { fontSize: 44 },
  profileCardPlusIcon: { fontSize: 36, color: '#888' },
  profileCardName: { color: '#ccc', fontSize: 14, textAlign: 'center', fontWeight: '500' },
  profileCardAdd: { opacity: 0.7 },
  manageLink: { alignSelf: 'center', marginTop: 20, padding: 10 },
  manageLinkText: { color: '#888', fontSize: 14, textDecoration: 'underline' },

  // Manage
  manageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12 },
  backBtn: { color: '#e94560', fontSize: 15, fontWeight: '600' },
  manageTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  addBtn: { backgroundColor: '#e94560', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  manageList: { paddingHorizontal: 16, paddingBottom: 20 },
  manageCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#2a2a4e' },
  manageCardActive: { borderColor: '#e94560' },
  manageCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  manageCardAvatar: { fontSize: 32 },
  manageCardName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  activeBadge: { color: '#4caf50', fontSize: 12, marginTop: 2, fontWeight: '600' },
  confirmText: { color: '#e94560', fontSize: 11, marginTop: 2 },
  manageCardActions: { flexDirection: 'row', gap: 8 },
  switchBtn: { backgroundColor: '#e94560', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, justifyContent: 'center' },
  switchBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  editBtn: { width: 36, height: 36, backgroundColor: '#16213e', borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  editBtnText: { fontSize: 16 },
  deleteBtn: { width: 36, height: 36, backgroundColor: '#16213e', borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  deleteBtnConfirm: { backgroundColor: 'rgba(233,69,96,0.25)', borderWidth: 1, borderColor: '#e94560', width: 'auto', paddingHorizontal: 10 },
  deleteBtnText: { fontSize: 13, color: '#e94560', fontWeight: '600' },

  // Form
  formScroll: { padding: 24 },
  formTitle: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 24 },
  label: { color: '#ccc', fontSize: 13, marginBottom: 6, marginTop: 16 },
  input: { backgroundColor: '#1a1a2e', color: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: '#333' },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  avatarBtn: { width: 52, height: 52, borderRadius: 10, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'transparent' },
  avatarBtnActive: { borderColor: '#e94560', backgroundColor: 'rgba(233,69,96,0.15)' },
  avatarEmoji: { fontSize: 26 },
  formActions: { flexDirection: 'row', gap: 12, marginTop: 32 },
  cancelBtn: { flex: 1, backgroundColor: '#2a2a4e', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  cancelBtnText: { color: '#aaa', fontSize: 15, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#e94560', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  error: { color: '#e94560', fontSize: 13, marginTop: 8, textAlign: 'center' },

  // Empty
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  emptyText: { color: '#888', fontSize: 16 },
  primaryBtn: { backgroundColor: '#e94560', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
