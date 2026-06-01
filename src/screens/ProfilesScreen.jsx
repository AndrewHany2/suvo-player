import { useState } from "react";
import { useTVNavigation } from "../hooks/useTVNavigation";
import {
  YStack,
  XStack,
  Text,
  Input,
  ScrollView,
  Spinner,
} from "tamagui";
import { useApp } from "../context/AppContext";

const AVATARS = [
  "👤", "👨", "👩", "👦", "👧", "👴", "👵", "🧑",
  "🎮", "🎬", "🍿", "⚽", "🎵", "🦸", "🎨", "🐱",
];

export default function ProfilesScreen() {
  const {
    appProfiles,
    activeProfileId,
    switchProfile,
    addProfile,
    updateProfile,
    removeProfile,
    signOut,
    authUser,
  } = useApp();

  const [view, setView] = useState("select"); // 'select' | 'manage' | 'form'
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ name: "", avatar: "👤" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const footerItems = [
    ...(appProfiles.length > 0 ? [{ id: "manage" }] : []),
    ...(authUser ? [{ id: "signout" }] : []),
  ];

  const { focusedRow, focusedCol } = useTVNavigation({
    active: view === "select",
    rows: [
      {
        items: [...appProfiles, { id: "__add__" }],
        onSelect: (idx) => {
          if (idx < appProfiles.length) switchProfile(appProfiles[idx].id);
          else openAdd();
        },
      },
      ...(footerItems.length > 0
        ? [{
            items: footerItems,
            onSelect: (_, item) => {
              if (item.id === "manage") setView("manage");
              else if (item.id === "signout") signOut();
            },
          }]
        : []),
    ],
  });

  const resetForm = () => {
    setFormData({ name: "", avatar: "👤" });
    setEditingId(null);
    setError(null);
    setView("manage");
  };

  const openAdd = () => {
    setFormData({ name: "", avatar: "👤" });
    setEditingId(null);
    setError(null);
    setView("form");
  };

  const openEdit = (p) => {
    setFormData({ name: p.name, avatar: p.avatar });
    setEditingId(p.id);
    setError(null);
    setView("form");
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setError("Profile name is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (editingId) {
        await updateProfile(editingId, formData);
      } else {
        const p = await addProfile(formData);
        if (p && view !== "manage") switchProfile(p.id);
      }
      resetForm();
    } catch (err) {
      setError(err?.message || "Failed to save profile.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (profileId) => {
    if (confirmDeleteId !== profileId) {
      setConfirmDeleteId(profileId);
      return;
    }
    setLoading(true);
    setConfirmDeleteId(null);
    try {
      await removeProfile(profileId);
    } catch (err) {
      setError(err?.message || "Failed to delete.");
    } finally {
      setLoading(false);
    }
  };

  // ── Form view (add / edit) ────────────────────────────────────────────────
  if (view === "form") {
    return (
      <YStack flex={1} backgroundColor="#0f0f23">
        <ScrollView flex={1}>
          <YStack padding={24}>
            <Text fontSize={22} fontWeight="700" color="#fff" marginBottom={24}>
              {editingId ? "Edit Profile" : "New Profile"}
            </Text>

            {!!error && (
              <Text color="#e94560" fontSize={13} marginTop={8} textAlign="center">
                {error}
              </Text>
            )}

            <Text fontSize={13} color="#ccc" marginBottom={6} marginTop={16}>
              Name *
            </Text>
            <Input
              placeholder="e.g. Dad, Kids…"
              placeholderTextColor="#666"
              value={formData.name}
              onChangeText={(v) => setFormData({ ...formData, name: v })}
              autoCapitalize="words"
              disabled={loading}
              backgroundColor="#1a1a2e"
              borderColor="#333"
              color="#fff"
              borderRadius={10}
              paddingHorizontal={14}
              paddingVertical={12}
              fontSize={15}
              borderWidth={1}
            />

            <Text fontSize={13} color="#ccc" marginBottom={6} marginTop={16}>
              Avatar
            </Text>
            <XStack flexWrap="wrap" gap={10} marginTop={8}>
              {AVATARS.map((emoji) => (
                <YStack
                  key={emoji}
                  width={52}
                  height={52}
                  borderRadius={10}
                  backgroundColor={formData.avatar === emoji ? "rgba(233,69,96,0.15)" : "#1a1a2e"}
                  borderWidth={2}
                  borderColor={formData.avatar === emoji ? "#e94560" : "transparent"}
                  justifyContent="center"
                  alignItems="center"
                  cursor="pointer"
                  onPress={() => setFormData({ ...formData, avatar: emoji })}
                  pressStyle={{ opacity: 0.8 }}
                >
                  <Text fontSize={26}>{emoji}</Text>
                </YStack>
              ))}
            </XStack>

            <XStack gap={12} marginTop={32}>
              <YStack
                flex={1}
                backgroundColor="#2a2a4e"
                borderRadius={10}
                paddingVertical={13}
                alignItems="center"
                cursor="pointer"
                onPress={loading ? undefined : resetForm}
                pressStyle={{ opacity: 0.8 }}
              >
                <Text color="#aaa" fontSize={15} fontWeight="600">
                  Cancel
                </Text>
              </YStack>
              <YStack
                flex={1}
                backgroundColor="#e94560"
                borderRadius={10}
                paddingVertical={13}
                alignItems="center"
                opacity={loading || !formData.name.trim() ? 0.5 : 1}
                cursor={loading || !formData.name.trim() ? "not-allowed" : "pointer"}
                onPress={loading || !formData.name.trim() ? undefined : handleSave}
                pressStyle={{ opacity: 0.9 }}
              >
                {loading ? (
                  <Spinner color="#fff" />
                ) : (
                  <Text color="#fff" fontSize={15} fontWeight="600">
                    {editingId ? "Save Changes" : "Create Profile"}
                  </Text>
                )}
              </YStack>
            </XStack>
          </YStack>
        </ScrollView>
      </YStack>
    );
  }

  // ── Manage view (list with edit/delete) ──────────────────────────────────
  if (view === "manage") {
    return (
      <YStack flex={1} backgroundColor="#0f0f23">
        <XStack
          alignItems="center"
          justifyContent="space-between"
          paddingHorizontal={16}
          paddingTop={20}
          paddingBottom={12}
        >
          <XStack
            padding={4}
            cursor="pointer"
            onPress={() => { setView("select"); setError(null); setConfirmDeleteId(null); }}
            pressStyle={{ opacity: 0.7 }}
          >
            <Text color="#e94560" fontSize={15} fontWeight="600">
              ← Back
            </Text>
          </XStack>
          <Text color="#fff" fontSize={18} fontWeight="700">
            Manage Profiles
          </Text>
          <YStack
            backgroundColor="#e94560"
            borderRadius={8}
            paddingHorizontal={14}
            paddingVertical={7}
            cursor="pointer"
            onPress={loading ? undefined : openAdd}
            pressStyle={{ opacity: 0.9 }}
          >
            <Text color="#fff" fontSize={14} fontWeight="600">
              + Add
            </Text>
          </YStack>
        </XStack>

        {!!error && (
          <Text color="#e94560" fontSize={13} marginHorizontal={20} textAlign="center">
            {error}
          </Text>
        )}

        {appProfiles.length === 0 ? (
          <YStack flex={1} justifyContent="center" alignItems="center" gap={16}>
            <Text color="#888" fontSize={16}>
              No profiles yet.
            </Text>
            <YStack
              backgroundColor="#e94560"
              borderRadius={10}
              paddingHorizontal={24}
              paddingVertical={12}
              cursor="pointer"
              onPress={openAdd}
              pressStyle={{ opacity: 0.9 }}
            >
              <Text color="#fff" fontSize={15} fontWeight="600">
                Create First Profile
              </Text>
            </YStack>
          </YStack>
        ) : (
          <ScrollView flex={1}>
            <YStack paddingHorizontal={16} paddingBottom={20}>
              {appProfiles.map((p) => (
                <XStack
                  key={p.id}
                  alignItems="center"
                  justifyContent="space-between"
                  backgroundColor="#1a1a2e"
                  borderRadius={12}
                  padding={14}
                  marginBottom={10}
                  borderWidth={1}
                  borderColor={activeProfileId === p.id ? "#e94560" : "#2a2a4e"}
                >
                  <XStack alignItems="center" gap={12} flex={1}>
                    <Text fontSize={32}>{p.avatar}</Text>
                    <YStack>
                      <Text color="#fff" fontSize={15} fontWeight="600">
                        {p.name}
                      </Text>
                      {activeProfileId === p.id && (
                        <Text color="#4caf50" fontSize={12} marginTop={2} fontWeight="600">
                          ✓ Active
                        </Text>
                      )}
                      {confirmDeleteId === p.id && (
                        <Text color="#e94560" fontSize={11} marginTop={2}>
                          Tap Delete again to confirm
                        </Text>
                      )}
                    </YStack>
                  </XStack>
                  <XStack gap={8}>
                    {activeProfileId !== p.id && (
                      <YStack
                        backgroundColor="#e94560"
                        borderRadius={8}
                        paddingHorizontal={12}
                        paddingVertical={7}
                        justifyContent="center"
                        cursor="pointer"
                        onPress={loading ? undefined : () => { switchProfile(p.id); setView("select"); }}
                        pressStyle={{ opacity: 0.9 }}
                      >
                        <Text color="#fff" fontSize={13} fontWeight="600">
                          Switch
                        </Text>
                      </YStack>
                    )}
                    <YStack
                      width={36}
                      height={36}
                      backgroundColor="#16213e"
                      borderRadius={8}
                      justifyContent="center"
                      alignItems="center"
                      cursor="pointer"
                      onPress={loading ? undefined : () => openEdit(p)}
                      pressStyle={{ opacity: 0.7 }}
                    >
                      <Text fontSize={16}>✏️</Text>
                    </YStack>
                    <YStack
                      backgroundColor={confirmDeleteId === p.id ? "rgba(233,69,96,0.25)" : "#16213e"}
                      borderRadius={8}
                      borderWidth={confirmDeleteId === p.id ? 1 : 0}
                      borderColor={confirmDeleteId === p.id ? "#e94560" : "transparent"}
                      paddingHorizontal={confirmDeleteId === p.id ? 10 : 0}
                      width={confirmDeleteId === p.id ? undefined : 36}
                      height={36}
                      justifyContent="center"
                      alignItems="center"
                      cursor="pointer"
                      onPress={loading ? undefined : () => handleDelete(p.id)}
                      pressStyle={{ opacity: 0.7 }}
                    >
                      <Text fontSize={13} color="#e94560" fontWeight="600">
                        {confirmDeleteId === p.id ? "Confirm" : "🗑️"}
                      </Text>
                    </YStack>
                  </XStack>
                </XStack>
              ))}
            </YStack>
          </ScrollView>
        )}
      </YStack>
    );
  }

  // ── Select view ("Who's watching?") ──────────────────────────────────────
  return (
    <YStack flex={1} backgroundColor="#0f0f23">
      {/* Vertically centered main area */}
      <YStack flex={1} justifyContent="center" alignItems="center" gap={48}>
        <Text color="#fff" fontSize={32} fontWeight="700" textAlign="center">
          Who's watching?
        </Text>

        <XStack flexWrap="wrap" justifyContent="center" gap={24} paddingHorizontal={20}>
          {appProfiles.map((p, idx) => {
            const focused = focusedRow === 0 && focusedCol === idx;
            return (
              <YStack
                key={p.id}
                alignItems="center"
                width={110}
                cursor="pointer"
                onPress={() => switchProfile(p.id)}
                pressStyle={{ opacity: 0.8 }}
                hoverStyle={{ scale: 1.05 }}
                animation="quick"
              >
                <YStack
                  width={90}
                  height={90}
                  borderRadius={12}
                  backgroundColor="#1a1a2e"
                  justifyContent="center"
                  alignItems="center"
                  borderWidth={2}
                  borderColor={focused ? "#e94560" : "#2a2a4e"}
                  marginBottom={10}
                  scale={focused ? 1.08 : 1}
                  hoverStyle={{ borderColor: "#e94560", backgroundColor: "#1e1e38" }}
                  animation="quick"
                >
                  <Text fontSize={44}>{p.avatar}</Text>
                </YStack>
                <Text color={focused ? "#fff" : "#ccc"} fontSize={14} textAlign="center" fontWeight="500" numberOfLines={1}>
                  {p.name}
                </Text>
              </YStack>
            );
          })}

          {(() => {
            const focused = focusedRow === 0 && focusedCol === appProfiles.length;
            return (
              <YStack
                alignItems="center"
                width={110}
                opacity={focused ? 1 : 0.7}
                cursor="pointer"
                onPress={openAdd}
                pressStyle={{ opacity: 0.5 }}
                hoverStyle={{ scale: 1.05, opacity: 1 }}
                animation="quick"
              >
                <YStack
                  width={90}
                  height={90}
                  borderRadius={12}
                  backgroundColor="#1a1a2e"
                  justifyContent="center"
                  alignItems="center"
                  borderWidth={2}
                  borderColor={focused ? "#e94560" : "#444"}
                  borderStyle="dashed"
                  marginBottom={10}
                  scale={focused ? 1.08 : 1}
                  hoverStyle={{ borderColor: "#e94560" }}
                  animation="quick"
                >
                  <Text fontSize={36} color={focused ? "#e94560" : "#888"}>+</Text>
                </YStack>
                <Text color={focused ? "#fff" : "#ccc"} fontSize={14} textAlign="center" fontWeight="500">
                  Add Profile
                </Text>
              </YStack>
            );
          })()}
        </XStack>
      </YStack>

      <XStack justifyContent="center" alignItems="center" gap={32} paddingBottom={40}>
        {appProfiles.length > 0 && (() => {
          const focused = focusedRow === 1 && focusedCol === 0;
          return (
            <XStack
              padding={10}
              cursor="pointer"
              onPress={() => setView("manage")}
              pressStyle={{ opacity: 0.7 }}
              hoverStyle={{ opacity: 1 }}
              animation="quick"
              borderBottomWidth={2}
              borderColor={focused ? "#e94560" : "transparent"}
            >
              <Text color={focused ? "#fff" : "#888"} fontSize={14} fontWeight={focused ? "700" : "400"}
                hoverStyle={{ color: "#fff" }}
              >
                Manage Profiles
              </Text>
            </XStack>
          );
        })()}
        {authUser && (() => {
          // Sign Out is the last footer item; its col index depends on whether Manage exists
          const col = appProfiles.length > 0 ? 1 : 0;
          const focused = focusedRow === 1 && focusedCol === col;
          return (
            <XStack
              padding={10}
              cursor="pointer"
              onPress={signOut}
              pressStyle={{ opacity: 0.7 }}
              hoverStyle={{ opacity: 1 }}
              animation="quick"
              borderBottomWidth={2}
              borderColor={focused ? "#e94560" : "transparent"}
            >
              <Text color={focused ? "#fff" : "#e94560"} fontSize={14} fontWeight="600"
                hoverStyle={{ color: "#ff6b81" }}
              >
                Sign Out
              </Text>
            </XStack>
          );
        })()}
      </XStack>
    </YStack>
  );
}
