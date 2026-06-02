import { useState } from "react";
import { Image, View } from "react-native";
import { YStack, Text } from "tamagui";

/**
 * Simplified Image component - loads directly for performance
 * Shows placeholder on error
 */
export default function ProxiedImage({
  source,
  style,
  resizeMode = "cover",
  fallbackColor = "#16213e",
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
      <View style={[style, { backgroundColor: fallbackColor }]} {...props}>
        <YStack
          flex={1}
          justifyContent="center"
          alignItems="center"
          backgroundColor={fallbackColor}
        >
          <Text color="#555" fontSize={32}>
            🎬
          </Text>
        </YStack>
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

// Made with Bob
