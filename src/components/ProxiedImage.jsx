import { useState } from "react";
import { Image, View } from "react-native";
import { colors } from "../ui/tokens";
import Icon from "../ui/Icon";

/**
 * Simplified Image component - loads directly for performance
 * Shows placeholder on error
 */
export default function ProxiedImage({
  source,
  style,
  resizeMode = "cover",
  fallbackColor = colors.surface,
  showPlaceholder = true,
  ...props
}) {
  const [hasError, setHasError] = useState(false);

  const handleError = () => {
    setHasError(true);
  };

  const handleLoad = () => {
    setHasError(false);
  };

  // Show placeholder if no URL or error occurred
  if (!source?.uri || hasError) {
    if (!showPlaceholder) return null;

    return (
      <View style={[style, { backgroundColor: fallbackColor, justifyContent: "center", alignItems: "center" }]} {...props}>
        <Icon name="film" color={colors.faint} size={32} />
      </View>
    );
  }

  return (
    <Image
      source={source}
      style={style}
      resizeMode={resizeMode}
      onError={handleError}
      onLoad={handleLoad}
      {...props}
    />
  );
}

