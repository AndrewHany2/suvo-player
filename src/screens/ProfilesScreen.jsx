import { useState, useRef } from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTVNavigation } from "../hooks/useTVNavigation";

const isNative = Platform.OS !== "web";
import {
  YStack,
  XStack,
  Text,
  Input,
  ScrollView,
} from "../ui/primitives";
import { colors, fonts, fontWeights, radii, accentAlpha } from "../ui/tokens";

// Danger (colors.danger #E5484D → rgb 229,72,77) at 0.18 alpha — the confirm-delete
// wash. Mirrors the token; kept local since tokens.js exposes no dangerAlpha helper.
const dangerAlpha18 = "rgba(229,72,77,0.18)";
import { ss, useScale } from "../utils/scaleSize";
import Button from "../ui/Button";
import Icon from "../ui/Icon";
import StatePanel from "../ui/StatePanel";
import SkeletonBox from "../presentation/components/SkeletonBox";
import { useApp } from "../context/AppContext";

// Avatar choices are profile *identity data* (persisted as p.avatar), not UI
// chrome — so these stay as glyphs. All UI-chrome emoji elsewhere are replaced
// with the Icon set.
const AVATARS = [
  "👤", "👨", "👩", "👦", "👧", "👴", "👵", "🧑",
  "🎮", "🎬", "🍿", "⚽", "🎵", "🦸", "🎨", "🐱",
];

export default function ProfilesScreen() {
  useScale(); // re-render + recompute ss() when the scale corrects (webOS cold start)
  const {
    appProfiles,
    appProfilesLoading,
    activeProfileId,
    switchProfile,
    addProfile,
    updateProfile,
    removeProfile,
    signOut,
    authUser,
  } = useApp();

  const insets = useSafeAreaInsets();
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

  const nameInputRef = useRef(null);

  // Per-profile action layout — drives both the Manage-view D-pad rows and the
  // focus-highlight mapping in render. Switch is omitted for the active profile.
  const profileActions = (p) => [
    ...(activeProfileId === p.id ? [] : ["switch"]),
    "edit",
    "delete",
  ];

  // ── Manage-view D-pad grid ────────────────────────────────────────────────
  const { focusedRow: mRow, focusedCol: mCol } = useTVNavigation({
    active: view === "manage",
    rows: [
      {
        items: [{ kind: "back" }, { kind: "add" }],
        onSelect: (_, item) => {
          if (item.kind === "back") { setView("select"); setError(null); setConfirmDeleteId(null); }
          else openAdd();
        },
      },
      ...appProfiles.map((p) => ({
        items: profileActions(p).map((kind) => ({ kind, p })),
        onSelect: (_, item) => {
          if (loading) return;
          if (item.kind === "switch") { switchProfile(p.id); setView("select"); }
          else if (item.kind === "edit") openEdit(p);
          else if (item.kind === "delete") handleDelete(p.id);
        },
      })),
    ],
  });

  // ── Form-view D-pad grid (back · name · avatars · cancel/save) ─────────────
  const { focusedRow: fRow, focusedCol: fCol } = useTVNavigation({
    active: view === "form",
    rows: [
      { items: [{ kind: "back" }], onSelect: () => { if (!loading) resetForm(); } },
      { items: [{ kind: "name" }], onSelect: () => nameInputRef.current?.focus() },
      {
        items: AVATARS.map((a) => ({ kind: "avatar", a })),
        onSelect: (_, item) => setFormData((f) => ({ ...f, avatar: item.a })),
      },
      {
        items: [{ kind: "cancel" }, { kind: "save" }],
        onSelect: (_, item) => {
          if (loading) return;
          if (item.kind === "cancel") resetForm();
          else if (formData.name.trim()) handleSave();
        },
      },
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
    const backFocused = fRow === 0;
    const nameFocused = fRow === 1;
    return (
      <YStack flex={1} backgroundColor={colors.bg} paddingTop={insets.top} paddingBottom={insets.bottom}>
        {/* Header with focusable back icon + title */}
        <XStack
          alignItems="center"
          gap={ss(8)}
          paddingHorizontal={ss(16)}
          paddingTop={ss(20)}
          paddingBottom={ss(8)}
        >
          <XStack
            alignItems="center"
            gap={ss(6)}
            padding={ss(6)}
            borderRadius={radii.sm}
            cursor="pointer"
            onPress={() => { if (!loading) resetForm(); }}
            pressStyle={{ opacity: 0.7 }}
            borderWidth={2}
            borderColor={backFocused ? colors.accent2 : "transparent"}
            backgroundColor={backFocused ? accentAlpha(0.15) : "transparent"}
          >
            <Icon name="back" size={ss(18)} color={colors.accent} />
            <Text color={colors.accent} fontFamily={fonts.body} fontSize={ss(15)} fontWeight={fontWeights.medium}>
              Back
            </Text>
          </XStack>
          <Text
            fontFamily={fonts.display}
            fontSize={ss(20)}
            fontWeight={fontWeights.bold}
            color={colors.text}
          >
            {editingId ? "Edit Profile" : "New Profile"}
          </Text>
        </XStack>

        <ScrollView flex={1}>
          <YStack padding={ss(24)} paddingTop={ss(8)}>
            {!!error && (
              <Text color={colors.danger} fontFamily={fonts.body} fontSize={ss(13)} marginTop={ss(8)} textAlign="center">
                {error}
              </Text>
            )}

            <Text fontFamily={fonts.body} fontSize={ss(13)} color={colors.muted} marginBottom={ss(6)} marginTop={ss(16)}>
              Name *
            </Text>
            <Input
              ref={nameInputRef}
              placeholder="e.g. Dad, Kids…"
              placeholderTextColor={colors.muted}
              value={formData.name}
              onChangeText={(v) => setFormData({ ...formData, name: v })}
              autoCapitalize="words"
              disabled={loading}
              backgroundColor={colors.surface2}
              borderColor={nameFocused ? colors.accent2 : colors.border}
              color={colors.text}
              borderRadius={radii.card}
              paddingHorizontal={ss(14)}
              paddingVertical={ss(12)}
              fontSize={ss(15)}
              borderWidth={2}
            />

            <Text fontFamily={fonts.body} fontSize={ss(13)} color={colors.muted} marginBottom={ss(6)} marginTop={ss(16)}>
              Avatar
            </Text>
            <XStack flexWrap="wrap" gap={ss(10)} marginTop={ss(8)}>
              {AVATARS.map((emoji, idx) => {
                const selected = formData.avatar === emoji;
                const focused = fRow === 2 && fCol === idx;
                return (
                  <YStack
                    key={emoji}
                    width={ss(52)}
                    height={ss(52)}
                    borderRadius={radii.card}
                    backgroundColor={selected ? accentAlpha(0.15) : colors.surface2}
                    borderWidth={2}
                    borderColor={focused ? colors.accent2 : selected ? colors.accent : "transparent"}
                    justifyContent="center"
                    alignItems="center"
                    cursor="pointer"
                    onPress={() => setFormData({ ...formData, avatar: emoji })}
                    pressStyle={{ opacity: 0.8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Avatar ${emoji}`}
                    accessibilityState={{ selected }}
                  >
                    <Text fontSize={ss(26)}>{emoji}</Text>
                  </YStack>
                );
              })}
            </XStack>

            <XStack gap={ss(12)} marginTop={ss(32)}>
              <Button
                variant="secondary"
                size="md"
                isFocused={fRow === 3 && fCol === 0}
                disabled={loading}
                onPress={loading ? undefined : resetForm}
                style={{ flex: 1 }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                isFocused={fRow === 3 && fCol === 1}
                disabled={loading || !formData.name.trim()}
                onPress={loading || !formData.name.trim() ? undefined : handleSave}
                style={{ flex: 1 }}
              >
                {loading ? "Saving…" : editingId ? "Save Changes" : "Create Profile"}
              </Button>
            </XStack>
          </YStack>
        </ScrollView>
      </YStack>
    );
  }

  // ── Manage view (list with edit/delete) ──────────────────────────────────
  if (view === "manage") {
    return (
      <YStack flex={1} backgroundColor={colors.bg} paddingBottom={insets.bottom}>
        <XStack
          alignItems="center"
          justifyContent="space-between"
          paddingHorizontal={ss(16)}
          paddingTop={insets.top + ss(20)}
          paddingBottom={ss(12)}
        >
          <XStack
            alignItems="center"
            gap={ss(6)}
            padding={ss(6)}
            borderRadius={radii.sm}
            cursor="pointer"
            onPress={() => { setView("select"); setError(null); setConfirmDeleteId(null); }}
            pressStyle={{ opacity: 0.7 }}
            borderWidth={2}
            borderColor={mRow === 0 && mCol === 0 ? colors.accent2 : "transparent"}
            backgroundColor={mRow === 0 && mCol === 0 ? accentAlpha(0.15) : "transparent"}
          >
            <Icon name="back" size={ss(18)} color={colors.accent} />
            <Text color={colors.accent} fontFamily={fonts.body} fontSize={ss(15)} fontWeight={fontWeights.medium}>
              Back
            </Text>
          </XStack>
          <Text color={colors.text} fontFamily={fonts.display} fontSize={ss(18)} fontWeight={fontWeights.bold}>
            Manage Profiles
          </Text>
          <Button
            variant="primary"
            size="sm"
            icon="plus"
            isFocused={mRow === 0 && mCol === 1}
            disabled={loading}
            onPress={loading ? undefined : openAdd}
          >
            Add
          </Button>
        </XStack>

        {!!error && (
          <Text color={colors.danger} fontFamily={fonts.body} fontSize={ss(13)} marginHorizontal={ss(20)} textAlign="center">
            {error}
          </Text>
        )}

        {appProfiles.length === 0 ? (
          <StatePanel
            mode="empty"
            icon="film"
            title="No profiles yet"
            message="Create your first profile to personalize what you watch."
            cta={openAdd}
            ctaLabel="Create First Profile"
          />
        ) : (
          <ScrollView flex={1}>
            <YStack paddingHorizontal={ss(16)} paddingBottom={ss(20)}>
              {appProfiles.map((p, i) => {
                const active = activeProfileId === p.id;
                const confirming = confirmDeleteId === p.id;
                const acts = profileActions(p);
                const rowFocused = mRow === i + 1;
                return (
                  <XStack
                    key={p.id}
                    alignItems="center"
                    justifyContent="space-between"
                    backgroundColor={colors.surface2}
                    borderRadius={radii.md}
                    padding={ss(14)}
                    marginBottom={ss(10)}
                    borderWidth={1}
                    borderColor={active ? colors.accent : colors.border}
                  >
                    <XStack alignItems="center" gap={ss(12)} flex={1}>
                      <Text fontSize={ss(32)}>{p.avatar}</Text>
                      <YStack>
                        <Text color={colors.text} fontFamily={fonts.body} fontSize={ss(15)} fontWeight={fontWeights.medium}>
                          {p.name}
                        </Text>
                        {active && (
                          <XStack alignItems="center" gap={ss(4)} marginTop={ss(2)}>
                            <Icon name="check" size={ss(12)} color={colors.accent} />
                            <Text color={colors.accentText} fontFamily={fonts.body} fontSize={ss(12)} fontWeight={fontWeights.medium}>
                              Active
                            </Text>
                          </XStack>
                        )}
                        {confirming && (
                          <Text color={colors.danger} fontFamily={fonts.body} fontSize={ss(11)} marginTop={ss(2)}>
                            Tap Delete again to confirm
                          </Text>
                        )}
                      </YStack>
                    </XStack>
                    <XStack gap={ss(8)} alignItems="center">
                      {!active && (
                        <Button
                          variant="primary"
                          size="sm"
                          isFocused={rowFocused && mCol === acts.indexOf("switch")}
                          disabled={loading}
                          onPress={loading ? undefined : () => { switchProfile(p.id); setView("select"); }}
                        >
                          Switch
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        isFocused={rowFocused && mCol === acts.indexOf("edit")}
                        disabled={loading}
                        onPress={loading ? undefined : () => openEdit(p)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant={confirming ? "secondary" : "ghost"}
                        size="sm"
                        isFocused={rowFocused && mCol === acts.indexOf("delete")}
                        disabled={loading}
                        onPress={loading ? undefined : () => handleDelete(p.id)}
                        style={
                          confirming
                            ? { backgroundColor: dangerAlpha18, borderColor: colors.danger, color: colors.danger }
                            : { color: colors.danger }
                        }
                      >
                        {confirming ? "Confirm" : "Delete"}
                      </Button>
                    </XStack>
                  </XStack>
                );
              })}
            </YStack>
          </ScrollView>
        )}
      </YStack>
    );
  }

  // ── Select view ("Who's watching?") ──────────────────────────────────────
  return (
    <YStack flex={1} backgroundColor={colors.bg} paddingTop={insets.top}>
      {/* Vertically centered main area */}
      <YStack flex={1} justifyContent="center" alignItems="center" gap={ss(48)}>
        <Text color={colors.text} fontFamily={fonts.display} fontSize={ss(32)} fontWeight={fontWeights.bold} textAlign="center">
          Who's watching?
        </Text>

        <XStack flexWrap="wrap" justifyContent="center" gap={ss(24)} paddingHorizontal={ss(20)}>
          {appProfilesLoading && appProfiles.length === 0 ? (
            // Skeleton tiles while the profile list is fetched from the server —
            // avatar-sized placeholders + a name-line stand-in in the same
            // geometry as a real tile, so they swap in with no layout shift and
            // the picker never flashes an empty grid. The Add tile is withheld
            // until the real profiles land so this reads purely as loading.
            [0, 1, 2].map((i) => (
              <YStack key={`skeleton-${i}`} alignItems="center" width={ss(110)}>
                <SkeletonBox width={ss(90)} height={ss(90)} radius={radii.md} style={{ marginBottom: ss(10) }} />
                <SkeletonBox width={ss(64)} height={ss(14)} radius={radii.sm} />
              </YStack>
            ))
          ) : (
          <>
          {appProfiles.map((p, idx) => {
            const focused = focusedRow === 0 && focusedCol === idx;
            return (
              <YStack
                key={p.id}
                alignItems="center"
                width={ss(110)}
                cursor="pointer"
                onPress={() => switchProfile(p.id)}
                pressStyle={{ opacity: 0.8 }}
                accessibilityRole="button"
                accessibilityLabel={`Watch as ${p.name}`}
                {...(!isNative && { hoverStyle: { scale: 1.05 }, animation: "quick" })}
              >
                <YStack
                  width={ss(90)}
                  height={ss(90)}
                  borderRadius={radii.md}
                  backgroundColor={colors.surface2}
                  justifyContent="center"
                  alignItems="center"
                  borderWidth={2}
                  borderColor={focused ? colors.accent2 : colors.border}
                  marginBottom={ss(10)}
                  {...(!isNative && { scale: focused ? 1.08 : 1, hoverStyle: { borderColor: colors.accent2, backgroundColor: colors.surface2 }, animation: "quick" })}
                >
                  <Text fontSize={ss(44)}>{p.avatar}</Text>
                </YStack>
                <Text color={focused ? colors.text : colors.muted} fontFamily={fonts.body} fontSize={ss(14)} textAlign="center" fontWeight={fontWeights.medium} numberOfLines={1}>
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
                width={ss(110)}
                opacity={focused ? 1 : 0.7}
                cursor="pointer"
                onPress={openAdd}
                pressStyle={{ opacity: 0.5 }}
                accessibilityRole="button"
                accessibilityLabel="Add profile"
                {...(!isNative && { hoverStyle: { scale: 1.05, opacity: 1 }, animation: "quick" })}
              >
                <YStack
                  width={ss(90)}
                  height={ss(90)}
                  borderRadius={radii.md}
                  backgroundColor={colors.surface2}
                  justifyContent="center"
                  alignItems="center"
                  borderWidth={2}
                  borderColor={focused ? colors.accent2 : colors.border}
                  borderStyle="dashed"
                  marginBottom={ss(10)}
                  {...(!isNative && { scale: focused ? 1.08 : 1, hoverStyle: { borderColor: colors.accent2 }, animation: "quick" })}
                >
                  <Icon name="plus" size={ss(34)} color={focused ? colors.accent2 : colors.muted} />
                </YStack>
                <Text color={focused ? colors.text : colors.muted} fontFamily={fonts.body} fontSize={ss(14)} textAlign="center" fontWeight={fontWeights.medium}>
                  Add Profile
                </Text>
              </YStack>
            );
          })()}
          </>
          )}
        </XStack>
      </YStack>

      <XStack justifyContent="center" alignItems="center" gap={ss(32)} paddingBottom={insets.bottom + ss(40)}>
        {appProfiles.length > 0 && (() => {
          const focused = focusedRow === 1 && focusedCol === 0;
          return (
            <XStack
              padding={ss(10)}
              cursor="pointer"
              onPress={() => setView("manage")}
              pressStyle={{ opacity: 0.7 }}
              borderBottomWidth={2}
              borderColor={focused ? colors.accent2 : "transparent"}
              {...(!isNative && { hoverStyle: { opacity: 1 }, animation: "quick" })}
            >
              <Text color={focused ? colors.text : colors.muted} fontFamily={fonts.body} fontSize={ss(14)} fontWeight={focused ? fontWeights.bold : fontWeights.regular}>
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
              padding={ss(10)}
              cursor="pointer"
              onPress={signOut}
              pressStyle={{ opacity: 0.7 }}
              borderBottomWidth={2}
              borderColor={focused ? colors.accent2 : "transparent"}
              {...(!isNative && { hoverStyle: { opacity: 1 }, animation: "quick" })}
            >
              <Text color={focused ? colors.text : colors.muted} fontFamily={fonts.body} fontSize={ss(14)} fontWeight={fontWeights.medium}>
                Sign Out
              </Text>
            </XStack>
          );
        })()}
      </XStack>
    </YStack>
  );
}
