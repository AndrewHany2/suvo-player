import { useState, useEffect } from "react";
import { FlatList, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { YStack, XStack, Text, Input, ScrollView } from "../ui/primitives";
import { colors, fonts, fontWeights, radii, accentAlpha } from "../ui/tokens";
import { ss, useScale } from "../utils/scaleSize";
import Button from "../ui/Button";
import Icon from "../ui/Icon";
import PasswordInput from "../ui/PasswordInput";
import StatePanel from "../ui/StatePanel";
import { useApp, useChannels } from "../context/AppContext";
import { contentService } from "../domain/services/ContentService";
import DownloadsStorageLine from "../downloads/DownloadsStorageLine.jsx";

// Downloads live only on iOS/Android; the DownloadsProvider is mounted at the
// native root, so the storage line must not render on web (this screen has no
// .web variant and is shared with the web build).
const IS_NATIVE = Platform.OS === "ios" || Platform.OS === "android";

const EMPTY_FORM = { type: "xtream", nickname: "", host: "", username: "", password: "", url: "" };

export default function AccountsScreen({ navigation }) {
  useScale(); // re-render + recompute ss() when the scale corrects (webOS cold start)
  const { users, activeUserId, setActiveUserId, saveUsers, addUser, updateUser, removeUser, authUser, profile, signOut, allowSelfLines } = useApp();
  const { setChannels } = useChannels();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [connectedNick, setConnectedNick] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  // Web/Electron/TV in-theme dialog state. react-native-web's Alert is a no-op
  // stub there, so instead of the old white globalThis.confirm/alert (jarring
  // over the dark UI) we drive our own styled confirm dialog + danger banner.
  // Native keeps the real RN Alert path untouched (see confirmDialog/alertDialog).
  const [confirmState, setConfirmState] = useState(null); // { title, message, confirmLabel, onConfirm }
  const [banner, setBanner] = useState(null); // inline danger message string

  const confirmDialog = (title, message, confirmLabel, onConfirm) => {
    if (Platform.OS === "web") {
      setConfirmState({ title, message, confirmLabel, onConfirm });
    } else {
      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel" },
        { text: confirmLabel, style: "destructive", onPress: onConfirm },
      ]);
    }
  };

  const alertDialog = (title, message) => {
    if (Platform.OS === "web") {
      setBanner(message);
    } else {
      Alert.alert(title, message);
    }
  };

  const isM3U = formData.type === "m3u";

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setBanner(null);
  };

  const handleAddNew = () => {
    setFormData(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  };

  const handleEdit = (user) => {
    setFormData({
      type: user.type === "m3u" ? "m3u" : "xtream",
      nickname: user.nickname || "",
      host: user.host || "",
      username: user.username || "",
      password: user.password || "",
      url: user.url || "",
    });
    setEditingId(user.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    setBanner(null);
    if (isM3U) {
      if (!formData.url) {
        alertDialog("Missing Fields", "Please enter a playlist URL.");
        return;
      }
    } else if (!formData.host || !formData.username || !formData.password) {
      alertDialog("Missing Fields", "Please fill in Host, Username, and Password.");
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
    confirmDialog("Delete Account", `Delete "${nickname || "this account"}"?`, "Delete", async () => {
      setLoading(true);
      try { await removeUser(userId); } finally { setLoading(false); }
    });
  };

  const handleConnect = async (userId) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    setBanner(null);
    setLoading(true);
    try {
      contentService.configure(user);
      // Cheap auth check (a few hundred bytes) instead of downloading the whole
      // live catalog just to validate creds. Distinguishes wrong-password from
      // expired/banned from unreachable, and doesn't switch the active account
      // until we know it actually authenticates.
      const result = await contentService.verifyCredentials();
      if (!result.ok) {
        alertDialog("Couldn't connect", result.message);
        return;
      }
      // Native's live player zaps through the context channel list; web/Electron
      // never reads it, so only pay the full stream fetch off-web. Best-effort:
      // creds are already verified, so a hiccup here shouldn't block the connect.
      if (Platform.OS !== "web") {
        try {
          const channelsData = await contentService.getLiveChannels();
          setChannels(channelsData.map((ch) => ({
            name: ch.name,
            url: contentService.buildLiveUrl(ch.id, ch.streamType || "ts"),
            id: ch.id,
          })));
        } catch (err) { console.warn("Zap-list prefetch failed (non-fatal):", err); }
      }
      setActiveUserId(userId);
      saveUsers();
      // Success is a calm inline confirmation, not a blocking OS dialog (Alert is
      // a no-op on web/TV anyway). Show the banner briefly, then return.
      setConnectedNick(user.nickname || user.username);
      setTimeout(() => navigation.goBack(), 1200);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    confirmDialog("Sign Out", "Sign out of your account?", "Sign Out", async () => {
      try { await signOut(); navigation.goBack(); } catch (err) { alertDialog("Error", err.message); }
    });
  };

  // TV / keyboard: Enter submits the form
  useEffect(() => {
    if (Platform.OS !== "web" || !showForm) return;
    const handler = (e) => {
      if ((e.key === "Enter" || e.keyCode === 13) && !loading) handleSave();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  // Re-bound on formData/loading, so handleSave is captured fresh; adding the
  // per-render handleSave identity would only churn the listener.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, formData, loading]);

  const inputStyle = {
    backgroundColor: colors.surface2,
    color: colors.text,
    borderRadius: radii.card,
    paddingHorizontal: ss(14),
    paddingVertical: ss(12),
    fontSize: ss(15),
    fontFamily: fonts.body,
    borderWidth: 1,
    borderColor: colors.border,
  };

  // Shared in-theme error banner (web) — replaces the old white globalThis.alert.
  const bannerNode = banner ? (
    <XStack
      accessibilityLiveRegion="polite"
      alignItems="center"
      gap={ss(10)}
      backgroundColor={colors.surface2}
      marginHorizontal={ss(16)}
      marginTop={ss(16)}
      borderRadius={radii.md}
      padding={ss(14)}
      borderWidth={1}
      borderColor={colors.danger}
    >
      <Icon name="warning" size={ss(20)} color={colors.danger} />
      <Text color={colors.text} fontFamily={fonts.body} fontSize={ss(14)} flex={1}>
        {banner}
      </Text>
      <Button variant="ghost" size="sm" icon="close" onPress={() => setBanner(null)} aria-label="Dismiss" />
    </XStack>
  ) : null;

  // Styled confirm dialog (web) — replaces the old white globalThis.confirm for
  // destructive actions (delete account / sign out). Native uses RN Alert above.
  const confirmNode = confirmState ? (
    <YStack
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      zIndex={50}
      backgroundColor="rgba(0,0,0,0.7)"
      justifyContent="center"
      alignItems="center"
      padding={ss(20)}
    >
      <YStack
        width="100%"
        maxWidth={ss(400)}
        backgroundColor={colors.surface2}
        borderRadius={radii.md}
        borderWidth={1}
        borderColor={colors.border}
        padding={ss(24)}
        gap={ss(8)}
      >
        <Text color={colors.text} fontFamily={fonts.display} fontSize={ss(18)} fontWeight={fontWeights.bold}>
          {confirmState.title}
        </Text>
        <Text color={colors.textDim} fontFamily={fonts.body} fontSize={ss(14)}>
          {confirmState.message}
        </Text>
        <XStack gap={ss(12)} marginTop={ss(16)} justifyContent="flex-end">
          <Button variant="secondary" onPress={() => setConfirmState(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => {
              const fn = confirmState.onConfirm;
              setConfirmState(null);
              fn?.();
            }}
          >
            {confirmState.confirmLabel}
          </Button>
        </XStack>
      </YStack>
    </YStack>
  ) : null;

  // ── Form view ─────────────────────────────────────────────────────────────
  if (showForm) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.bg }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView contentContainerStyle={{ padding: ss(20) }}>
          {bannerNode}
          <Text color={colors.text} fontFamily={fonts.display} fontSize={ss(20)} fontWeight={fontWeights.bold} marginBottom={ss(20)}>
            {editingId ? "Edit Account" : "Add New Account"}
          </Text>

          <Text fontSize={ss(13)} fontFamily={fonts.body} color={colors.muted} marginBottom={ss(6)}>Source type</Text>
          <XStack gap={ss(10)}>
            {[{ key: "xtream", label: "Xtream login" }, { key: "m3u", label: "M3U playlist" }].map((opt) => (
              <Button
                key={opt.key}
                variant={formData.type === opt.key ? "primary" : "secondary"}
                disabled={loading}
                onPress={() => setFormData({ ...formData, type: opt.key })}
                style={{ flex: 1 }}
              >
                {opt.label}
              </Button>
            ))}
          </XStack>

          <Text fontSize={ss(13)} fontFamily={fonts.body} color={colors.muted} marginBottom={ss(6)} marginTop={ss(14)}>Nickname (optional)</Text>
          <Input placeholder="e.g., My account" placeholderTextColor={colors.muted} value={formData.nickname} onChangeText={(v) => setFormData({ ...formData, nickname: v })} disabled={loading} {...inputStyle} />

          {isM3U ? (
            <>
              <Text fontSize={ss(13)} fontFamily={fonts.body} color={colors.muted} marginBottom={ss(6)} marginTop={ss(14)}>Playlist URL *</Text>
              <Input placeholder="http://host/get.php?...type=m3u_plus  or  .m3u/.m3u8" placeholderTextColor={colors.muted} value={formData.url} onChangeText={(v) => setFormData({ ...formData, url: v })} autoCapitalize="none" autoCorrect={false} disabled={loading} {...inputStyle} />
            </>
          ) : (
            <>
              <Text fontSize={ss(13)} fontFamily={fonts.body} color={colors.muted} marginBottom={ss(6)} marginTop={ss(14)}>Server / Host *</Text>
              <Input placeholder="s1.example.com:8080" placeholderTextColor={colors.muted} value={formData.host} onChangeText={(v) => setFormData({ ...formData, host: v })} autoCapitalize="none" autoCorrect={false} disabled={loading} {...inputStyle} />

              <Text fontSize={ss(13)} fontFamily={fonts.body} color={colors.muted} marginBottom={ss(6)} marginTop={ss(14)}>Username *</Text>
              <Input placeholder="your_username" placeholderTextColor={colors.muted} value={formData.username} onChangeText={(v) => setFormData({ ...formData, username: v })} autoCapitalize="none" autoCorrect={false} disabled={loading} {...inputStyle} />

              <Text fontSize={ss(13)} fontFamily={fonts.body} color={colors.muted} marginBottom={ss(6)} marginTop={ss(14)}>Password *</Text>
              <PasswordInput placeholder="your_password" placeholderTextColor={colors.muted} value={formData.password} onChangeText={(v) => setFormData({ ...formData, password: v })} disabled={loading} inputStyle={inputStyle} />
            </>
          )}

          <XStack gap={ss(12)} marginTop={ss(28)}>
            <Button variant="secondary" disabled={loading} onPress={resetForm} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button variant="primary" icon="check" disabled={loading} onPress={handleSave} style={{ flex: 1 }}>
              {loading ? "Saving…" : "Save"}
            </Button>
          </XStack>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <YStack flex={1} backgroundColor={colors.bg}>
      {bannerNode}
      {connectedNick && (
        <XStack
          accessibilityLiveRegion="polite"
          alignItems="center" gap={ss(10)} backgroundColor={colors.surface2}
          marginHorizontal={ss(16)} marginTop={ss(16)} marginBottom={ss(4)}
          borderRadius={radii.md} padding={ss(14)} borderWidth={1} borderColor={colors.border}
        >
          <Icon name="check" size={ss(20)} color={colors.success} />
          <Text color={colors.text} fontFamily={fonts.body} fontSize={ss(14)} fontWeight={fontWeights.medium}>
            Connected to {connectedNick}
          </Text>
        </XStack>
      )}

      {authUser && (
        <XStack alignItems="center" backgroundColor={colors.surface2} marginHorizontal={ss(16)} marginTop={ss(16)} marginBottom={ss(4)} borderRadius={radii.md} padding={ss(14)} borderWidth={1} borderColor={colors.border}>
          <XStack flex={1} alignItems="center" gap={ss(10)}>
            <Icon name="settings" size={ss(24)} color={colors.muted} />
            <YStack>
              <Text color={colors.text} fontFamily={fonts.body} fontSize={ss(14)} fontWeight={fontWeights.medium}>{profile?.name ?? authUser.email}</Text>
              <Text color={colors.muted} fontFamily={fonts.body} fontSize={ss(12)} marginTop={ss(1)}>{authUser.email}</Text>
            </YStack>
          </XStack>
          <Button variant="ghost" size="sm" onPress={handleSignOut}>Sign Out</Button>
        </XStack>
      )}

      {allowSelfLines && (
        <YStack margin={ss(16)}>
          <Button variant="primary" icon="plus" disabled={loading} onPress={handleAddNew}>
            Add account
          </Button>
        </YStack>
      )}

      {IS_NATIVE && <DownloadsStorageLine />}

      {loading && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} zIndex={10} pointerEvents="none">
          <StatePanel mode="loading" />
        </YStack>
      )}

      {users.length === 0 ? (
        <StatePanel
          mode="empty"
          icon="tv"
          title="No accounts"
          message={allowSelfLines
            ? 'Tap "Add account" to add your first media service'
            : "Your provider manages your subscription. Contact them to add a service."}
          cta={allowSelfLines ? handleAddNew : undefined}
          ctaLabel={allowSelfLines ? "Add account" : undefined}
        />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: ss(16), paddingBottom: ss(20) }}
          renderItem={({ item }) => (
            <XStack backgroundColor={colors.surface2} borderRadius={radii.md} padding={ss(16)} marginBottom={ss(12)} alignItems="center" borderWidth={1} borderColor={colors.border}>
              <YStack flex={1}>
                <Text color={colors.text} fontFamily={fonts.body} fontSize={ss(15)} fontWeight={fontWeights.medium} marginBottom={ss(3)}>
                  {item.nickname || (item.type === "m3u" ? "M3U playlist" : `${item.username}@${item.host}`)}
                </Text>
                <Text color={colors.muted} fontFamily={fonts.body} fontSize={ss(13)} numberOfLines={1}>{item.type === "m3u" ? item.url : item.host}</Text>
                {activeUserId === item.id && (
                  <XStack marginTop={ss(6)} alignItems="center" gap={ss(4)} backgroundColor={accentAlpha(0.15)} borderRadius={radii.sm} paddingHorizontal={ss(8)} paddingVertical={ss(3)} alignSelf="flex-start">
                    <Icon name="check" size={ss(12)} color={colors.accent} />
                    <Text color={colors.accentText} fontFamily={fonts.body} fontSize={ss(12)} fontWeight={fontWeights.medium}>Active</Text>
                  </XStack>
                )}
              </YStack>
              <XStack gap={ss(8)}>
                <Button variant="secondary" size="sm" icon="play" onPress={() => handleConnect(item.id)} aria-label="Connect" />
                <Button variant="secondary" size="sm" onPress={() => handleEdit(item)}>Edit</Button>
                <Button variant="secondary" size="sm" icon="close" onPress={() => handleDelete(item.id, item.nickname)} aria-label="Delete" />
              </XStack>
            </XStack>
          )}
        />
      )}
      {confirmNode}
    </YStack>
  );
}
