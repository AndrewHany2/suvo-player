import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useApp } from '../context/AppContext';
import iptvApi from '../services/iptvApi';

export default function AccountsScreen({ navigation }) {
  const { users, activeUserId, setActiveUserId, saveUsers, addUser, updateUser, removeUser, setChannels, authUser, profile, signOut } =
    useApp();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    nickname: '',
    host: '',
    username: '',
    password: '',
  });

  const resetForm = () => {
    setFormData({ nickname: '', host: '', username: '', password: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const handleAddNew = () => {
    setFormData({ nickname: '', host: '', username: '', password: '' });
    setEditingId(null);
    setShowForm(true);
  };

  const handleEdit = (user) => {
    setFormData({
      nickname: user.nickname || '',
      host: user.host,
      username: user.username,
      password: user.password,
    });
    setEditingId(user.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formData.host || !formData.username || !formData.password) {
      Alert.alert('Missing Fields', 'Please fill in Host, Username, and Password.');
      return;
    }
    setLoading(true);
    try {
      if (editingId) {
        await updateUser(editingId, formData);
      } else {
        await addUser(formData);
      }
      resetForm();
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (userId, nickname) => {
    Alert.alert(
      'Delete Account',
      `Delete "${nickname || 'this account'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await removeUser(userId);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleConnect = async (userId) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;

    setActiveUserId(userId);
    saveUsers();
    setLoading(true);
    try {
      iptvApi.setCredentials(user.host, user.username, user.password);
      const channelsData = await iptvApi.getLiveStreams();
      const formatted = channelsData.map((ch) => ({
        name: ch.name,
        url: iptvApi.buildStreamUrl('live', ch.stream_id, ch.stream_type || 'ts'),
        id: ch.stream_id,
      }));
      setChannels(formatted);
      Alert.alert(
        'Connected!',
        `Loaded ${formatted.length} channels from ${user.nickname || user.username}`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (err) {
      console.error('Error loading channels:', err);
      Alert.alert('Error', 'Failed to load channels. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  if (showForm) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: '#0f0f23' }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.formScroll}>
          <Text style={styles.formTitle}>{editingId ? 'Edit Account' : 'Add New Account'}</Text>

          <Text style={styles.label}>Nickname (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., My IPTV Service"
            placeholderTextColor="#666"
            value={formData.nickname}
            onChangeText={(v) => setFormData({ ...formData, nickname: v })}
            editable={!loading}
          />

          <Text style={styles.label}>Server / Host *</Text>
          <TextInput
            style={styles.input}
            placeholder="s1.example.com:8080"
            placeholderTextColor="#666"
            value={formData.host}
            onChangeText={(v) => setFormData({ ...formData, host: v })}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />

          <Text style={styles.label}>Username *</Text>
          <TextInput
            style={styles.input}
            placeholder="your_username"
            placeholderTextColor="#666"
            value={formData.username}
            onChangeText={(v) => setFormData({ ...formData, username: v })}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />

          <Text style={styles.label}>Password *</Text>
          <TextInput
            style={styles.input}
            placeholder="your_password"
            placeholderTextColor="#666"
            value={formData.password}
            onChangeText={(v) => setFormData({ ...formData, password: v })}
            secureTextEntry
            editable={!loading}
          />

          <View style={styles.formActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={resetForm} disabled={loading}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, loading && styles.btnDisabled]}
              onPress={handleSave}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>💾 Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Sign out of your account?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
            navigation.goBack();
          } catch (err) {
            Alert.alert('Error', err.message);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {authUser && (
        <View style={styles.profileBar}>
          <View style={styles.profileInfo}>
            <Text style={styles.profileIcon}>👤</Text>
            <View>
              <Text style={styles.profileName}>{profile?.username ?? authUser.email}</Text>
              <Text style={styles.profileEmail}>{authUser.email}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={styles.addNewBtn} onPress={handleAddNew} disabled={loading}>
        <Text style={styles.addNewBtnText}>➕ Add IPTV Account</Text>
      </TouchableOpacity>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#e94560" />
        </View>
      )}

      {users.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📡</Text>
          <Text style={styles.emptyTitle}>No IPTV Accounts</Text>
          <Text style={styles.emptyHint}>Tap "Add Account" to add your first IPTV service</Text>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.userCard}>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>
                  {item.nickname || `${item.username}@${item.host}`}
                </Text>
                <Text style={styles.userHost}>{item.host}</Text>
                {activeUserId === item.id && (
                  <View style={styles.activeBadge}>
                    <Text style={styles.activeBadgeText}>✓ Active</Text>
                  </View>
                )}
              </View>
              <View style={styles.userActions}>
                <TouchableOpacity
                  style={styles.connectBtn}
                  onPress={() => handleConnect(item.id)}
                  disabled={loading}
                >
                  <Text style={styles.connectBtnText}>🔗</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.editBtn}
                  onPress={() => handleEdit(item)}
                  disabled={loading}
                >
                  <Text style={styles.editBtnText}>✏️</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDelete(item.id, item.nickname)}
                  disabled={loading}
                >
                  <Text style={styles.deleteBtnText}>🗑️</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  profileBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a4e',
  },
  profileInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  profileIcon: { fontSize: 24 },
  profileName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  profileEmail: { color: '#888', fontSize: 12, marginTop: 1 },
  signOutBtn: {
    backgroundColor: 'rgba(233,69,96,0.15)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(233,69,96,0.3)',
  },
  signOutText: { color: '#e94560', fontSize: 13, fontWeight: '600' },
  addNewBtn: {
    margin: 16,
    backgroundColor: '#e94560',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  addNewBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 10,
  },
  list: { paddingHorizontal: 16, paddingBottom: 20 },
  userCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a4e',
  },
  userInfo: { flex: 1 },
  userName: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 3 },
  userHost: { color: '#888', fontSize: 13 },
  activeBadge: {
    marginTop: 6,
    backgroundColor: '#0a2e1a',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  activeBadgeText: { color: '#4caf50', fontSize: 12, fontWeight: '600' },
  userActions: { flexDirection: 'row', gap: 8 },
  connectBtn: {
    width: 36, height: 36,
    backgroundColor: '#16213e',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectBtnText: { fontSize: 18 },
  editBtn: {
    width: 36, height: 36,
    backgroundColor: '#16213e',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editBtnText: { fontSize: 18 },
  deleteBtn: {
    width: 36, height: 36,
    backgroundColor: '#16213e',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtnText: { fontSize: 18 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyHint: { color: '#888', fontSize: 14, textAlign: 'center' },
  // Form styles
  formScroll: { padding: 20 },
  formTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 20 },
  label: { color: '#ccc', fontSize: 13, marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: '#1a1a2e',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#333',
  },
  formActions: { flexDirection: 'row', gap: 12, marginTop: 28 },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#2a2a4e',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  cancelBtnText: { color: '#aaa', fontSize: 15, fontWeight: '600' },
  saveBtn: {
    flex: 1,
    backgroundColor: '#e94560',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.6 },
});
