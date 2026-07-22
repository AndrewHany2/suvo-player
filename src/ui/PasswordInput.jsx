/**
 * PasswordInput — a masked text field with a show/hide eye toggle.
 *
 * Cross-platform (web + native via react-native / react-native-web). Wraps the
 * shared `Input` primitive and overlays a tappable eye icon at the trailing
 * edge that toggles `secureTextEntry`. Defaults to masked (secure) so the eye
 * is a reveal affordance, not the resting state.
 *
 * Style props for the underlying field are passed via `inputStyle` (the same
 * object callers already spread onto a bare <Input>); all other props
 * (placeholder, value, onChangeText, disabled, …) forward straight through.
 */
import { useState, forwardRef } from "react";
import { Pressable } from "react-native";
import { Stack, Input } from "./primitives";
import Icon from "./Icon";
import { colors, iconSizes } from "./tokens";
import { ss } from "../utils/scaleSize";

// forwardRef so callers can focus the field programmatically (e.g. a login form
// advancing focus from email → password on the keyboard's "next" key). The ref
// lands on the underlying Input/TextInput.
const PasswordInput = forwardRef(function PasswordInput({ inputStyle, ...props }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <Stack position="relative" width="100%">
      <Input
        ref={ref}
        {...props}
        {...inputStyle}
        secureTextEntry={!visible}
        paddingRight={ss(44)}
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={visible ? "Hide password" : "Show password"}
        style={{
          position: "absolute",
          right: ss(10),
          top: 0,
          bottom: 0,
          width: ss(34),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={visible ? "eye-off" : "eye"} size={ss(iconSizes.md)} color={colors.muted} />
      </Pressable>
    </Stack>
  );
});

export default PasswordInput;
