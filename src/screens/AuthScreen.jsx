import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
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
      setError(
        "Username must be 3–30 characters: letters, numbers, underscores only.",
      );
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
        // signUp now upserts the profile when email confirmation is disabled.
        // onAuthStateChange in AppContext will fire automatically if a session
        // was returned. We also call signIn to ensure the session is set.
        await signIn(email.trim(), password);
      }
    } catch (err) {
      const msg = err.message || "";
      if (
        msg.toLowerCase().includes("rate limit") ||
        msg.toLowerCase().includes("email rate limit")
      ) {
        setError(
          "Too many sign-up attempts. Please wait a few minutes and try again.",
        );
      } else if (msg.toLowerCase().includes("email not confirmed")) {
        setError(
          "Please check your email and confirm your account before signing in.",
        );
      } else if (
        msg.toLowerCase().includes("invalid login credentials") ||
        msg.toLowerCase().includes("invalid username or password")
      ) {
        setError("Invalid username/email or password.");
      } else if (
        msg.toLowerCase().includes("already registered") ||
        msg.toLowerCase().includes("already been registered")
      ) {
        setError("This email is already registered. Please sign in instead.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.logo}>📺</Text>
          <Text style={styles.title}>IPTV Player</Text>
          <Text style={styles.subtitle}>
            {mode === "login" ? "Sign in to your account" : "Create an account"}
          </Text>

          <Text style={styles.label}>
            {mode === "login" ? "Username or Email" : "Username"}
          </Text>
          <TextInput
            style={styles.input}
            placeholder={
              mode === "login"
                ? "your_username or you@example.com"
                : "your_username"
            }
            placeholderTextColor="#666"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />

          {mode === "register" && (
            <>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="#666"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
              />
            </>
          )}

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor="#666"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!loading}
          />

          {mode === "register" && (
            <>
              <Text style={styles.label}>Confirm Password</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor="#666"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                editable={!loading}
              />
            </>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>
                {mode === "login" ? "Sign In" : "Create Account"}
              </Text>
            )}
          </TouchableOpacity>

          <View style={styles.toggle}>
            {mode === "login" ? (
              <>
                <Text style={styles.toggleText}>Don't have an account? </Text>
                <TouchableOpacity onPress={() => switchMode("register")}>
                  <Text style={styles.toggleLink}>Register</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.toggleText}>Already have an account? </Text>
                <TouchableOpacity onPress={() => switchMode("login")}>
                  <Text style={styles.toggleLink}>Sign In</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 20 },
  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    padding: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  logo: { fontSize: 48, textAlign: "center", marginBottom: 8 },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#fff",
    textAlign: "center",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#aaa",
    textAlign: "center",
    marginBottom: 24,
  },
  label: { fontSize: 13, color: "#ccc", marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: "#0f0f23",
    color: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#333",
  },
  error: { color: "#e94560", fontSize: 13, marginTop: 12, textAlign: "center" },
  btn: {
    backgroundColor: "#e94560",
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: 20,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  toggle: { flexDirection: "row", justifyContent: "center", marginTop: 20 },
  toggleText: { color: "#aaa", fontSize: 14 },
  toggleLink: { color: "#e94560", fontSize: 14, fontWeight: "600" },
});
