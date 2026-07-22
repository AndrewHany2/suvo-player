import { useState, useEffect } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { YStack, XStack, Text, Input, ScrollView } from "../ui/primitives";
import Button from "../ui/Button";
import Icon from "../ui/Icon";
import PasswordInput from "../ui/PasswordInput";
import {
  colors,
  fonts,
  fontWeights,
  radii,
  iconSizes,
  shadows,
  accentAlpha,
} from "../ui/tokens";
import { ss, useScale } from "../utils/scaleSize";
import { useApp } from "../context/AppContext";

import { isTV } from "../utils/isTV";

export default function AuthScreen() {
  useScale(); // re-render + recompute ss() when the scale corrects (webOS cold start)
  const { signIn } = useApp();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retryable, setRetryable] = useState(false);

  // Login only. Public sign-up is disabled server-side (config.toml
  // enable_signup=false) because this is a reseller-provisioned product —
  // accounts are minted by the admin dashboard, never self-registered — so the
  // app exposes no registration path.
  const handleSubmit = async () => {
    setError("");
    setRetryable(false);
    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      const msg = err.message || "";
      if (err.kind === "network") {
        setError(msg || "Can't reach the server. Check your internet connection and try again.");
        setRetryable(true);
      } else if (
        msg.toLowerCase().includes("rate limit") ||
        msg.toLowerCase().includes("email rate limit")
      ) {
        setError("Too many attempts. Please wait a few minutes and try again.");
      } else if (msg.toLowerCase().includes("email not confirmed")) {
        setError(
          "Please check your email and confirm your account before signing in.",
        );
      } else if (
        msg.toLowerCase().includes("invalid login credentials") ||
        msg.toLowerCase().includes("invalid email or password")
      ) {
        setError("Invalid email or password.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  // TV / keyboard: Enter submits the form
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e) => {
      if ((e.key === "Enter" || e.keyCode === 13) && !loading) handleSubmit();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  // Re-bound on the form fields/loading, so handleSubmit is captured fresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password, loading]);

  // Shared, tokenized input styling so every field reads identically. Resting
  // state is a hairline border on the elevated surface; no glow at rest.
  const inputStyle = {
    backgroundColor: colors.bg,
    color: colors.text,
    fontFamily: fonts.body,
    borderRadius: radii.card,
    paddingHorizontal: ss(14),
    paddingVertical: ss(12),
    fontSize: ss(15),
    borderWidth: 1,
    borderColor: colors.border,
  };
  const labelStyle = {
    fontSize: ss(13),
    color: colors.muted,
    fontFamily: fonts.body,
    marginBottom: ss(6),
    marginTop: ss(12),
  };

  const submitLabel = loading ? "Please wait…" : "Sign In";

  return (
    <KeyboardAvoidingView
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: ss(20),
        }}
        keyboardShouldPersistTaps="handled"
      >
        <YStack
          backgroundColor={colors.surface2}
          borderRadius={radii.lg}
          borderWidth={1}
          borderColor={colors.border}
          padding={ss(28)}
          maxWidth={ss(420)}
          width="100%"
          alignSelf="center"
          {...(isTV() ? {} : shadows.modal)}
        >
          <YStack
            alignSelf="center"
            alignItems="center"
            justifyContent="center"
            width={ss(64)}
            height={ss(64)}
            borderRadius={radii.md}
            backgroundColor={isTV() ? colors.surface : accentAlpha(0.18)}
            marginBottom={ss(12)}
          >
            <Icon name="tv" size={ss(iconSizes.lg)} color={colors.accent} />
          </YStack>
          <Text
            fontSize={ss(26)}
            fontFamily={fonts.display}
            fontWeight={fontWeights.bold}
            color={colors.text}
            textAlign="center"
            marginBottom={ss(4)}
          >
            Suvo
          </Text>
          <Text
            fontSize={ss(14)}
            fontFamily={fonts.body}
            color={colors.muted}
            textAlign="center"
            marginBottom={ss(24)}
          >
            Sign in to your account
          </Text>

          <Text {...labelStyle}>Email</Text>
          <Input
            placeholder="you@example.com"
            placeholderTextColor={colors.muted}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            disabled={loading}
            {...inputStyle}
          />

          <Text {...labelStyle}>Password</Text>
          <PasswordInput
            placeholder="••••••••"
            placeholderTextColor={colors.muted}
            value={password}
            onChangeText={setPassword}
            disabled={loading}
            inputStyle={inputStyle}
          />

          {!!error && (
            <XStack
              alignItems="center"
              justifyContent="center"
              gap={ss(8)}
              marginTop={ss(14)}
              paddingVertical={ss(10)}
              paddingHorizontal={ss(12)}
              borderRadius={radii.sm}
              borderWidth={1}
              borderColor={colors.danger}
              backgroundColor={colors.surface}
            >
              <Icon
                name="warning"
                size={ss(iconSizes.sm)}
                color={colors.danger}
              />
              <Text
                color={colors.danger}
                fontFamily={fonts.body}
                fontSize={ss(13)}
                flex={1}
              >
                {error}
              </Text>
            </XStack>
          )}

          {retryable && (
            <Button
              variant="secondary"
              size="md"
              onPress={handleSubmit}
              disabled={loading}
              style={{ marginTop: ss(12), width: "100%" }}
            >
              Retry
            </Button>
          )}

          <Button
            variant="primary"
            size="lg"
            onPress={handleSubmit}
            disabled={loading}
            style={{ marginTop: ss(20), width: "100%" }}
          >
            {submitLabel}
          </Button>

        </YStack>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
