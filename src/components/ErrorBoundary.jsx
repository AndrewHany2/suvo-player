import { Component } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors } from "../ui/tokens";
import { reportError } from "../services/observability";

/**
 * App-level error boundary. Before this, a render throw anywhere in the tree
 * white-screened the app silently on all six targets. Now it renders a
 * recoverable fallback and reports the error (with component stack) to the
 * observability layer. Uses RN primitives so it works identically on native and
 * react-native-web (web/Electron/TV).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportError(error, { source: "ErrorBoundary", componentStack: info?.componentStack });
  }

  handleRetry() {
    this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.root}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            The app ran into an unexpected error. You can try again.
          </Text>
          <Pressable
            onPress={this.handleRetry}
            style={styles.button}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: colors.bg,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  body: {
    color: colors.muted,
    fontSize: 15,
    marginBottom: 20,
    textAlign: "center",
    maxWidth: 420,
  },
  button: {
    backgroundColor: colors.accent,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    minHeight: 48,
    justifyContent: "center",
  },
  buttonText: { color: colors.bg, fontSize: 16, fontWeight: "600" },
});
