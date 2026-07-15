import { useRef } from "react";
import { Platform } from "react-native";
import { usePlayback } from "../context/AppContext";
import { needsVlcEngine } from "../playback/nativeEngine";
import ExpoVideoPlayerScreen from "./ExpoVideoPlayerScreen.native.jsx";
import VlcPlayerScreen from "./VlcPlayerScreen.native.jsx";

/**
 * Native video-player dispatcher. Picks the engine by container:
 * AVPlayer-unsupported containers (mkv/avi/flv/wmv/webm) on iOS go to the VLC
 * screen; everything else uses the expo-video screen. The choice is re-made when
 * currentVideo.url changes (episode advance), but is held across the brief
 * currentVideo===null render during close so the engine doesn't flip mid-teardown.
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
