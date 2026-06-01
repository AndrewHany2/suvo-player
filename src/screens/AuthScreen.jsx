import { useState, useEffect } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { YStack, XStack, Text, Input, ScrollView, Spinner } from "tamagui";
import { useApp } from "../context/AppContext";

export default function AuthScreen() {
  const { signIn, signUp } = useApp();
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setUsername("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async () => {
    setError("");
    if (!username.trim() || !password) {
      setError("Username and password are required.");
      return;
    }
    if (mode === "register" && !/^[a-zA-Z0-9_]{3,30}$/.test(username.trim())) {
      setError("Username must be 3–30 characters: letters, numbers, underscores only.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (mode === "register" && !email.trim()) {
      setError("Email is required.");
      return;
    }
    if (mode === "register" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") {
        await signIn(username.trim(), password);
      } else {
        await signUp(username.trim(), password, email.trim());
        await signIn(email.trim(), password);
      }
    } catch (err) {
      const msg = err.message || "";
      if (msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("email rate limit")) {
        setError("Too many sign-up attempts. Please wait a few minutes and try again.");
      } else if (msg.toLowerCase().includes("email not confirmed")) {
        setError("Please check your email and confirm your account before signing in.");
      } else if (msg.toLowerCase().includes("invalid login credentials") || msg.toLowerCase().includes("invalid username or password")) {
        setError("Invalid username/email or password.");
      } else if (msg.toLowerCase().includes("already registered") || msg.toLowerCase().includes("already been registered")) {
        setError("This email is already registered. Please sign in instead.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  // TV / keyboard: Enter submits the form
  useEffect(() => {
    const handler = (e) => {
      if ((e.key === "Enter" || e.keyCode === 13) && !loading) handleSubmit();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [username, email, password, confirmPassword, mode, loading]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#0f0f23" }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20 }} keyboardShouldPersistTaps="handled">
        <YStack
          backgroundColor="#1a1a2e"
          borderRadius={16}
          padding={28}
          shadowColor="#000"
          shadowOffset={{ width: 0, height: 4 }}
          shadowOpacity={0.3}
          shadowRadius={8}
          elevation={8}
        >
          <Text fontSize={48} textAlign="center" marginBottom={8}>📺</Text>
          <Text fontSize={26} fontWeight="bold" color="#fff" textAlign="center" marginBottom={4}>
            IPTV Player
          </Text>
          <Text fontSize={14} color="#aaa" textAlign="center" marginBottom={24}>
            {mode === "login" ? "Sign in to your account" : "Create an account"}
          </Text>

          <Text fontSize={13} color="#ccc" marginBottom={6} marginTop={12}>
            {mode === "login" ? "Username or Email" : "Username"}
          </Text>
          <Input
            placeholder={mode === "login" ? "your_username or you@example.com" : "your_username"}
            placeholderTextColor="#666"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            disabled={loading}
            backgroundColor="#0f0f23"
            color="#fff"
            borderRadius={10}
            paddingHorizontal={14}
            paddingVertical={12}
            fontSize={15}
            borderWidth={1}
            borderColor="#333"
          />

          {mode === "register" && (
            <>
              <Text fontSize={13} color="#ccc" marginBottom={6} marginTop={12}>Email</Text>
              <Input
                placeholder="you@example.com"
                placeholderTextColor="#666"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                disabled={loading}
                backgroundColor="#0f0f23"
                color="#fff"
                borderRadius={10}
                paddingHorizontal={14}
                paddingVertical={12}
                fontSize={15}
                borderWidth={1}
                borderColor="#333"
              />
            </>
          )}

          <Text fontSize={13} color="#ccc" marginBottom={6} marginTop={12}>Password</Text>
          <Input
            placeholder="••••••••"
            placeholderTextColor="#666"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            disabled={loading}
            backgroundColor="#0f0f23"
            color="#fff"
            borderRadius={10}
            paddingHorizontal={14}
            paddingVertical={12}
            fontSize={15}
            borderWidth={1}
            borderColor="#333"
          />

          {mode === "register" && (
            <>
              <Text fontSize={13} color="#ccc" marginBottom={6} marginTop={12}>Confirm Password</Text>
              <Input
                placeholder="••••••••"
                placeholderTextColor="#666"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                disabled={loading}
                backgroundColor="#0f0f23"
                color="#fff"
                borderRadius={10}
                paddingHorizontal={14}
                paddingVertical={12}
                fontSize={15}
                borderWidth={1}
                borderColor="#333"
              />
            </>
          )}

          {!!error && (
            <Text color="#e94560" fontSize={13} marginTop={12} textAlign="center">{error}</Text>
          )}

          <YStack
            backgroundColor="#e94560"
            borderRadius={10}
            paddingVertical={14}
            marginTop={20}
            alignItems="center"
            opacity={loading ? 0.6 : 1}
            cursor={loading ? "not-allowed" : "pointer"}
            onPress={loading ? undefined : handleSubmit}
            pressStyle={{ opacity: 0.9 }}
          >
            {loading ? <Spinner color="#fff" /> : (
              <Text color="#fff" fontSize={16} fontWeight="600">
                {mode === "login" ? "Sign In" : "Create Account"}
              </Text>
            )}
          </YStack>

          <XStack justifyContent="center" marginTop={20}>
            {mode === "login" ? (
              <>
                <Text color="#aaa" fontSize={14}>Don't have an account? </Text>
                <Text
                  color="#e94560"
                  fontSize={14}
                  fontWeight="600"
                  cursor="pointer"
                  onPress={() => switchMode("register")}
                  pressStyle={{ opacity: 0.7 }}
                >
                  Register
                </Text>
              </>
            ) : (
              <>
                <Text color="#aaa" fontSize={14}>Already have an account? </Text>
                <Text
                  color="#e94560"
                  fontSize={14}
                  fontWeight="600"
                  cursor="pointer"
                  onPress={() => switchMode("login")}
                  pressStyle={{ opacity: 0.7 }}
                >
                  Sign In
                </Text>
              </>
            )}
          </XStack>
        </YStack>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
