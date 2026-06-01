import { useState, useEffect } from "react";
import { FlatList, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { YStack, XStack, Text, Input, ScrollView, Spinner } from "tamagui";
import { useApp } from "../context/AppContext";
import iptvApi from "../services/iptvApi";

export default function AccountsScreen({ navigation }) {
  const { users, activeUserId, setActiveUserId, saveUsers, addUser, updateUser, removeUser, setChannels, authUser, profile, signOut } = useApp();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({ nickname: "", host: "", username: "", password: "" });

  const resetForm = () => {
    setFormData({ nickname: "", host: "", username: "", password: "" });
    setEditingId(null);
    setShowForm(false);
  };

  const handleAddNew = () => {
    setFormData({ nickname: "", host: "", username: "", password: "" });
    setEditingId(null);
    setShowForm(true);
  };

  const handleEdit = (user) => {
    setFormData({ nickname: user.nickname || "", host: user.host, username: user.username, password: user.password });
    setEditingId(user.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formData.host || !formData.username || !formData.password) {
      Alert.alert("Missing Fields", "Please fill in Host, Username, and Password.");
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
    Alert.alert("Delete Account", `Delete "${nickname || "this account"}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setLoading(true);
          try { await removeUser(userId); } finally { setLoading(false); }
        },
      },
    ]);
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
        url: iptvApi.buildStreamUrl("live", ch.stream_id, ch.stream_type || "ts"),
        id: ch.stream_id,
      }));
      setChannels(formatted);
      Alert.alert("Connected!", `Loaded ${formatted.length} channels from ${user.nickname || user.username}`, [{ text: "OK", onPress: () => navigation.goBack() }]);
    } catch (err) {
      console.error("Error loading channels:", err);
      Alert.alert("Error", "Failed to load channels. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Sign out of your account?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          try { await signOut(); navigation.goBack(); } catch (err) { Alert.alert("Error", err.message); }
        },
      },
    ]);
  };

  // TV / keyboard: Enter submits the form
  useEffect(() => {
    if (!showForm) return;
    const handler = (e) => {
      if ((e.key === "Enter" || e.keyCode === 13) && !loading) handleSave();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [showForm, formData, loading]);

  // ── Form view ─────────────────────────────────────────────────────────────
  if (showForm) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: "#0f0f23" }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Text color="#fff" fontSize={20} fontWeight="700" marginBottom={20}>
            {editingId ? "Edit Account" : "Add New Account"}
          </Text>

          <Text fontSize={13} color="#ccc" marginBottom={6} marginTop={14}>Nickname (optional)</Text>
          <Input placeholder="e.g., My IPTV Service" placeholderTextColor="#666" value={formData.nickname} onChangeText={(v) => setFormData({ ...formData, nickname: v })} disabled={loading} backgroundColor="#1a1a2e" color="#fff" borderRadius={10} paddingHorizontal={14} paddingVertical={12} fontSize={15} borderWidth={1} borderColor="#333" />

          <Text fontSize={13} color="#ccc" marginBottom={6} marginTop={14}>Server / Host *</Text>
          <Input placeholder="s1.example.com:8080" placeholderTextColor="#666" value={formData.host} onChangeText={(v) => setFormData({ ...formData, host: v })} autoCapitalize="none" autoCorrect={false} disabled={loading} backgroundColor="#1a1a2e" color="#fff" borderRadius={10} paddingHorizontal={14} paddingVertical={12} fontSize={15} borderWidth={1} borderColor="#333" />

          <Text fontSize={13} color="#ccc" marginBottom={6} marginTop={14}>Username *</Text>
          <Input placeholder="your_username" placeholderTextColor="#666" value={formData.username} onChangeText={(v) => setFormData({ ...formData, username: v })} autoCapitalize="none" autoCorrect={false} disabled={loading} backgroundColor="#1a1a2e" color="#fff" borderRadius={10} paddingHorizontal={14} paddingVertical={12} fontSize={15} borderWidth={1} borderColor="#333" />

          <Text fontSize={13} color="#ccc" marginBottom={6} marginTop={14}>Password *</Text>
          <Input placeholder="your_password" placeholderTextColor="#666" value={formData.password} onChangeText={(v) => setFormData({ ...formData, password: v })} secureTextEntry disabled={loading} backgroundColor="#1a1a2e" color="#fff" borderRadius={10} paddingHorizontal={14} paddingVertical={12} fontSize={15} borderWidth={1} borderColor="#333" />

          <XStack gap={12} marginTop={28}>
            <YStack flex={1} backgroundColor="#2a2a4e" borderRadius={10} paddingVertical={13} alignItems="center" cursor="pointer" onPress={loading ? undefined : resetForm} pressStyle={{ opacity: 0.8 }}>
              <Text color="#aaa" fontSize={15} fontWeight="600">Cancel</Text>
            </YStack>
            <YStack flex={1} backgroundColor="#e94560" borderRadius={10} paddingVertical={13} alignItems="center" opacity={loading ? 0.6 : 1} cursor={loading ? "not-allowed" : "pointer"} onPress={loading ? undefined : handleSave} pressStyle={{ opacity: 0.9 }}>
              {loading ? <Spinner color="#fff" /> : <Text color="#fff" fontSize={15} fontWeight="600">💾 Save</Text>}
            </YStack>
          </XStack>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <YStack flex={1} backgroundColor="#0f0f23">
      {authUser && (
        <XStack alignItems="center" backgroundColor="#1a1a2e" marginHorizontal={16} marginTop={16} marginBottom={4} borderRadius={12} padding={14} borderWidth={1} borderColor="#2a2a4e">
          <XStack flex={1} alignItems="center" gap={10}>
            <Text fontSize={24}>👤</Text>
            <YStack>
              <Text color="#fff" fontSize={14} fontWeight="600">{profile?.username ?? authUser.email}</Text>
              <Text color="#888" fontSize={12} marginTop={1}>{authUser.email}</Text>
            </YStack>
          </XStack>
          <YStack backgroundColor="rgba(233,69,96,0.15)" borderRadius={8} paddingHorizontal={12} paddingVertical={7} borderWidth={1} borderColor="rgba(233,69,96,0.3)" cursor="pointer" onPress={handleSignOut} pressStyle={{ opacity: 0.8 }}>
            <Text color="#e94560" fontSize={13} fontWeight="600">Sign Out</Text>
          </YStack>
        </XStack>
      )}

      <YStack margin={16} backgroundColor="#e94560" borderRadius={10} paddingVertical={13} alignItems="center" cursor={loading ? "not-allowed" : "pointer"} onPress={loading ? undefined : handleAddNew} pressStyle={{ opacity: 0.9 }} hoverStyle={{ opacity: 0.85 }} animation="quick">
        <Text color="#fff" fontSize={15} fontWeight="600">➕ Add IPTV Account</Text>
      </YStack>

      {loading && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center" backgroundColor="rgba(0,0,0,0.4)" zIndex={10} pointerEvents="none">
          <Spinner size="large" color="#e94560" />
        </YStack>
      )}

      {users.length === 0 ? (
        <YStack flex={1} justifyContent="center" alignItems="center" padding={40}>
          <Text fontSize={48} marginBottom={12}>📡</Text>
          <Text color="#fff" fontSize={18} fontWeight="600" marginBottom={8}>No IPTV Accounts</Text>
          <Text color="#888" fontSize={14} textAlign="center">Tap "Add Account" to add your first IPTV service</Text>
        </YStack>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
          renderItem={({ item }) => (
            <XStack backgroundColor="#1a1a2e" borderRadius={12} padding={16} marginBottom={12} alignItems="center" borderWidth={1} borderColor="#2a2a4e">
              <YStack flex={1}>
                <Text color="#fff" fontSize={15} fontWeight="600" marginBottom={3}>
                  {item.nickname || `${item.username}@${item.host}`}
                </Text>
                <Text color="#888" fontSize={13}>{item.host}</Text>
                {activeUserId === item.id && (
                  <YStack marginTop={6} backgroundColor="#0a2e1a" borderRadius={6} paddingHorizontal={8} paddingVertical={3} alignSelf="flex-start">
                    <Text color="#4caf50" fontSize={12} fontWeight="600">✓ Active</Text>
                  </YStack>
                )}
              </YStack>
              <XStack gap={8}>
                <YStack width={36} height={36} backgroundColor="#16213e" borderRadius={8} justifyContent="center" alignItems="center" cursor="pointer" onPress={() => handleConnect(item.id)} pressStyle={{ opacity: 0.7 }} hoverStyle={{ backgroundColor: "#1e2d4e" }} animation="quick">
                  <Text fontSize={18}>🔗</Text>
                </YStack>
                <YStack width={36} height={36} backgroundColor="#16213e" borderRadius={8} justifyContent="center" alignItems="center" cursor="pointer" onPress={() => handleEdit(item)} pressStyle={{ opacity: 0.7 }} hoverStyle={{ backgroundColor: "#1e2d4e" }} animation="quick">
                  <Text fontSize={18}>✏️</Text>
                </YStack>
                <YStack width={36} height={36} backgroundColor="#16213e" borderRadius={8} justifyContent="center" alignItems="center" cursor="pointer" onPress={() => handleDelete(item.id, item.nickname)} pressStyle={{ opacity: 0.7 }} hoverStyle={{ backgroundColor: "#2e1a1a" }} animation="quick">
                  <Text fontSize={18}>🗑️</Text>
                </YStack>
              </XStack>
            </XStack>
          )}
        />
      )}
    </YStack>
  );
}
