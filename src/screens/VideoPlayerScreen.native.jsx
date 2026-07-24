import { useRef } from "react";
import { Platform } from "react-native";
import { usePlayback } from "../context/AppContext";
import { needsVlcEngine } from "../playback/nativeEngine";
import ExpoVideoPlayerScreen from "./ExpoVideoPlayerScreen.native.jsx";
import VlcPlayerScreen from "./VlcPlayerScreen.native.jsx";

/**
 * Native video-player dispatcher. Picks the engine by container: mkv/avi/flv/
 * wmv/webm VOD go to the VLC screen on BOTH iOS and Android (iOS AVPlayer can't
 * demux them; Android ExoPlayer starts them catastrophically slowly on these
 * providers — see nativeEngine.js), everything else uses the expo-video screen.
 * Live is never routed to VLC. The choice is re-made when currentVideo.url
 * changes (episode advance), but is held across the brief currentVideo===null
 * render during close so the engine doesn't flip mid-teardown.
 */
export default function VideoPlayerScreen(props) {
  const { currentVideo } = usePlayback();
  const lastUseVlcRef = useRef(false);

  const useVlc = currentVideo
    ? currentVideo.type !== "live" && needsVlcEngine(currentVideo.url, Platform.OS)
    : lastUseVlcRef.current;
  lastUseVlcRef.current = useVlc;

  return useVlc ? <VlcPlayerScreen {...props} /> : <ExpoVideoPlayerScreen {...props} />;
}
