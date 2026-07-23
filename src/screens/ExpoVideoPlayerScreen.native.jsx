import { useEffect, useRef, useCallback, useState, useMemo, memo, forwardRef, useImperativeHandle } from "react";
import { Modal, StatusBar, Platform, TouchableOpacity, AppState, PanResponder, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as ScreenOrientation from "expo-screen-orientation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { YStack, XStack, Text, ScrollView, Spinner } from "../ui/primitives";
import { colors, accentAlpha, fonts, overlay, playerScrim, seekTrack } from "../ui/tokens";
import Icon from "../ui/Icon";
import Button from "../ui/Button";
import StatePanel from "../ui/StatePanel";
import { useChannels, usePlayback, useWatchHistory } from "../context/AppContext";
import { contentService } from "../domain/services/ContentService";
import { reportFatalPlayback } from "../services/observability";
import storage from "../utils/storage";
import { createExpoVideoDriver } from "../playback/drivers/expoVideoDriver";
import { FATAL_TITLE, FATAL_HEADLINE, fatalDetail } from "../playback/playerCopy";
import { controlIcon, controlLabel, fitLabel } from "../playback/playerControls";
import { findNextEpisode, buildNextEpisodeVideo } from "../playback/episodeNav";
import { useResilientPlayback } from "../playback/useResilientPlayback";
import { useDeviceIntegrity } from "../security/useDeviceIntegrity";
import { useReducedMotion } from "../hooks/useReducedMotion";

// Phase 2 shared modules.
import { usePlayerPreferences } from "../playback/usePlayerPreferences";
import { useResumePosition } from "../playback/useResumePosition";
import { useSleepTimer, SLEEP_PRESETS, formatRemaining } from "../playback/useSleepTimer";
import { clampOffset, DEFAULT_SUBTITLE_STYLE } from "../playback/subtitleStyle";
import { nextChannel, prevChannel, fetchNowNext } from "../playback/liveExtras";
import ResumePrompt from "../playback/components/ResumePrompt";
import SubtitleSettings from "../playback/components/SubtitleSettings";
import StatsOverlay from "../playback/components/StatsOverlay";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

// The player locks the window to PORTRAIT_UP on mount (see the mount effect
// below). We still declare both orientations on every menu <Modal> as a safety
// net: RN's <Modal> defaults supportedOrientations to ['portrait'], and any
// momentary mismatch with the window orientation makes UIKit raise
// UIApplicationInvalidInterfaceOrientation (SIGABRT). An overlapping mask is safe.
const MODAL_ORIENTATIONS = ["portrait", "landscape"];

// Namespaced storage key remembering the last-watched live channel stream id.
const LAST_CHANNEL_KEY = "player_last_live_channel";

// One-time flag: has the viewer seen the touch-gesture legend? Shown once ever on
// first VOD playback so the (otherwise invisible) swipe/tap gestures are learnable.
const GESTURE_HINT_KEY = "player_gesture_hint_seen";

// Valid expo-video VideoView contentFit values (module scope so its identity is
// stable — a per-render array literal would churn effect/callback deps).
const VALID_CONTENT_FITS = ["contain", "cover", "fill"];

// Gesture tuning. Pixels of vertical travel that map to the full 0..1 range for
// volume/brightness, and the horizontal pixels-per-second mapping for seek.
const VERT_SWIPE_RANGE_PX = 220;
const SEEK_PX_PER_SEC = 6;
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_SEEK = 10;
const LONG_PRESS_MS = 450;

/**
 * expo-brightness is NOT a declared dependency. Resolve it lazily/guarded so a
 * build without it simply disables the left-half brightness gesture rather than
 * crashing. Returns the module or null.
 */
function loadBrightness() {
  try {
    return require("expo-brightness");
  } catch {
    return null;
  }
}

/**
 * expo-navigation-bar hides the Android system navigation bar (back / home /
 * recents) for an immersive fullscreen. Resolve it lazily/guarded: Android-only,
 * and a dev client that predates the native module simply keeps the bar rather
 * than crashing. Returns the module or null.
 */
function loadNavigationBar() {
  if (Platform.OS !== "android") return null;
  try {
    return require("expo-navigation-bar");
  } catch {
    return null;
  }
}

import { formatDuration as formatTime } from "../utils/formatDuration";

/**
 * Transient gesture indicator ("Vol 60%", "+10s", "2x", …). A memoized leaf that
 * owns its own state and exposes an imperative show(kind, label) via ref, so a
 * ~60 Hz PanResponder move updates only this node instead of re-rendering the
 * whole ~1000-line player. Auto-hides after 700ms.
 */
const GestureHint = memo(
  forwardRef(function GestureHint(_props, ref) {
    const [hint, setHint] = useState(null); // { kind, label }
    const timerRef = useRef(null);
    useImperativeHandle(
      ref,
      () => ({
        show(kind, label) {
          setHint({ kind, label });
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setHint(null), 700);
        },
      }),
      [],
    );
    useEffect(() => () => clearTimeout(timerRef.current), []);
    if (!hint) return null;
    return (
      <YStack position="absolute" top="45%" left={0} right={0} alignItems="center" pointerEvents="none" zIndex={50}>
        <Text color={colors.text} fontSize={20} fontWeight="700" backgroundColor={playerScrim.hint} paddingHorizontal={18} paddingVertical={10} borderRadius={10}>
          {hint.label}
        </Text>
      </YStack>
    );
  }),
);

// TEMP DIAGNOSTIC — remove before release. `__DEV__` is false in release APKs,
// and the controls-blackhole bug reproduces ONLY on real Android hardware (never
// the emulator), so this HUD is gated behind a manual constant, not __DEV__.
// It renders an always-visible magenta panel (ungated by showControls) as the
// top sibling and live-counts every touch/responder callback, so one release
// install decisively separates the surviving hypotheses:
//   • Panel NOT visible over playing video  -> compositing (SurfaceView paints
//     over RN siblings; textureView not applied/insufficient).
//   • Panel visible but rawTouch/startAsk DON'T increment on tap -> native
//     VideoView swallows touches before RN's responder system sees them.
//   • Panel visible, counters increment, but showControls stays false / tap
//     doesn't flip it -> state/render issue in the controls overlay.
const DEBUG_HUD = true;

/**
 * Imperative diagnostic overlay. Like GestureHint, it owns its own state and
 * exposes bump(key) via ref so the ~60Hz PanResponder callbacks re-render only
 * this leaf, not the whole player. `showControls` is a prop (parent re-renders
 * when it toggles) so the panel always shows the live value.
 */
const DebugHud = memo(
  forwardRef(function DebugHud({ showControls }, ref) {
    const [c, setC] = useState({ rawTouch: 0, touchEnd: 0, startAsk: 0, moveAsk: 0, grant: 0, move: 0, release: 0, terminate: 0, tap: 0 });
    useImperativeHandle(ref, () => ({
      bump(key) { setC((p) => ({ ...p, [key]: (p[key] || 0) + 1 })); },
    }), []);
    return (
      <View
        pointerEvents="none"
        style={{ position: "absolute", top: 56, left: 8, backgroundColor: "#ff00ff", padding: 8, borderRadius: 6, zIndex: 9999, elevation: 9999 }}
      >
        <Text color="#fff" fontSize={13} fontWeight="700">HUD showControls={String(showControls)}</Text>
        <Text color="#fff" fontSize={12}>rawTouch={c.rawTouch} touchEnd={c.touchEnd} startAsk={c.startAsk} moveAsk={c.moveAsk}</Text>
        <Text color="#fff" fontSize={12}>grant={c.grant} move={c.move} rel={c.release} term={c.terminate} tap={c.tap}</Text>
      </View>
    );
  }),
);

export default function ExpoVideoPlayerScreen({ navigation }) {
  const { channels } = useChannels();
  const { currentVideo, closeVideo, playVideo } = usePlayback();
  const { updateWatchProgress, addToWatchHistory, flushProgress } = useWatchHistory();
  const insets = useSafeAreaInsets();
  // Honor OS "Reduce Motion": drop the <Modal> slide/fade transitions when set.
  const reducedMotion = useReducedMotion();
  const modalAnimation = reducedMotion ? "none" : "fade";
  const progressIntervalRef = useRef(null);
  const hasAddedToHistory = useRef(false);

  const [speed, setSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [audioTracks, setAudioTracks] = useState([]);
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState(null);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const controlsTimerRef = useRef(null);
  // Mirror showControls in a ref so the memoized PanResponder can read the
  // current value without being re-created every time controls toggle.
  const showControlsRef = useRef(true);
  showControlsRef.current = showControls;

  // Phase 2 UI state.
  const [showSubtitleSettings, setShowSubtitleSettings] = useState(false);
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  // One-time gesture legend (first VOD playback ever); persisted so it shows once.
  const [showGestureHint, setShowGestureHint] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  // VOD seek bar: live-polled position/duration/buffered, and the in-progress
  // scrub preview (null when not dragging). Track width is measured on layout.
  const [progress, setProgress] = useState({ position: 0, duration: 0, buffered: 0 });
  const [scrubSec, setScrubSec] = useState(null);
  const seekTrackWidth = useRef(0);
  // Transient gesture indicator: rendered by the memoized <GestureHint> leaf and
  // driven imperatively via this ref, so a 60 Hz gesture move touches only that
  // node rather than re-rendering the whole player.
  const hintRef = useRef(null);
  // TEMP DIAGNOSTIC — drives the always-on <DebugHud> counters. Remove with DEBUG_HUD.
  const hudRef = useRef(null);
  const [nowNext, setNowNext] = useState({ now: null, next: null });

  const isLive = currentVideo?.type === "live";
  const streamKey = currentVideo ? `${currentVideo.type}_${currentVideo.streamId}` : null;

  // ---- Group 1: remembered preferences (per-stream merged over global) ----
  const { prefs, loaded: prefsLoaded, setPref } = usePlayerPreferences(streamKey);
  const prefsAppliedRef = useRef(false);

  // ---- Group 1: resume position ----
  const resume = useResumePosition(currentVideo);
  // For VOD with a resume point we must not LOAD until the user picks. We gate
  // the driver source on this; live + non-resume start immediately.
  const needsResumeChoice = resume.hasResume && !resume.decided && !isLive;
  const [resolvedStart, setResolvedStart] = useState(0);

  // The expo-video player instance. The resilient-playback hook owns the
  // initial load/seek/play (via driver.load -> player.replace), so we create the
  // player with a NULL source. Passing the real URI here would make expo-video
  // start buffering the stream immediately, only for the hook's load to
  // player.replace() it moments later — a redundant teardown/rebuild of the
  // whole pipeline that doubles time-to-first-frame. Let the machine load once.
  const player = useVideoPlayer(null, () => {});

  // expo-video VideoView ref — needed for startPictureInPicture().
  const videoViewRef = useRef(null);

  // Mirror useful values for gesture handlers without re-creating the responder.
  const playerRef = useRef(player);
  playerRef.current = player;

  const driver = useMemo(() => (player ? createExpoVideoDriver(player) : null), [player]);

  const playback = useResilientPlayback({
    driver,
    // Hold the source until the resume choice is made for VOD so the chosen
    // startTime is honoured by the machine's single LOAD.
    source: currentVideo && !needsResumeChoice ? { uri: currentVideo.url } : null,
    isLive,
    startTime: isLive ? 0 : resolvedStart || currentVideo?.startTime || 0,
    refreshCredentials: () => {},
    onFatal: (reason) =>
      reportFatalPlayback({ reason, isLive, streamId: currentVideo?.streamId, engine: "expo-video" }),
  });

  const isLoading = playback.status === "idle" || playback.status === "loading";
  const isRecovering = playback.isRecovering;
  const isFatal = playback.isFatal;

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 4000);
  }, []);

  useEffect(() => { resetControlsTimer(); return () => clearTimeout(controlsTimerRef.current); }, [resetControlsTimer]);

  // Transient gesture indicator helper — routes to the memoized leaf so a move
  // frame doesn't re-render the player. The leaf owns the 700ms auto-hide.
  const flashHint = useCallback((kind, label) => {
    hintRef.current?.show(kind, label);
  }, []);

  // Show the one-time gesture legend on first VOD playback (persisted). Gestures
  // are touch-only affordances a viewer can't otherwise discover.
  useEffect(() => {
    if (isLive) return undefined;
    let cancelled = false;
    storage.getItem(GESTURE_HINT_KEY).then((seen) => {
      if (!cancelled && !seen) setShowGestureHint(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isLive]);
  const dismissGestureHint = useCallback(() => {
    setShowGestureHint(false);
    storage.setItem(GESTURE_HINT_KEY, "1").catch(() => {});
  }, []);

  // Keep the screen awake while a video is mounted and lock to landscape;
  // restore both on unmount. Also opt the player into background audio /
  // now-playing controls where expo-video supports it (guarded).
  useEffect(() => {
    activateKeepAwakeAsync().catch(() => {});
    // Keep the video in portrait, fitted on screen — don't auto-rotate to
    // landscape/fullscreen on open. The app's native orientation is "default"
    // (all orientations), so merely unlocking lets the sensor swing it to
    // landscape; we must actively lock PORTRAIT_UP to hold it upright.
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    return () => {
      try { deactivateKeepAwake(); } catch {}
      // Return orientation to the app default on exit. Previously we re-locked
      // PORTRAIT_UP here, which pinned the ENTIRE app portrait for the rest of
      // the session after the first playback — the lock outlived the player.
      // Unlock instead so the rest of the app follows its native (default)
      // orientation policy; the player owns orientation only while it's mounted
      // (portrait by default, landscape via toggleFullscreen).
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);

  // Now-playing controls + external playback — expo-video player config. Guarded:
  // these setters are no-ops on platforms/builds that don't expose them.
  // staysActiveInBackground is left false (the expo-video default) so playback
  // pauses when the app is backgrounded / the screen locks — otherwise video
  // keeps playing (audio) in the background. See the AppState effect below, which
  // also pauses explicitly for builds where the flag setter is a no-op.
  useEffect(() => {
    if (!player) return;
    try { player.staysActiveInBackground = false; } catch {}
    try { player.showNowPlayingNotification = true; } catch {}
    try { if (typeof player.allowsExternalPlayback !== "undefined") player.allowsExternalPlayback = true; } catch {}
  }, [player]);

  // Mirror the engine's play/pause state so the center transport button and its
  // icon stay in sync however playback toggles (button, end-of-media, background
  // pause). expo-video getters can throw before a source loads, so seed guarded.
  useEffect(() => {
    if (!player) return undefined;
    try { setIsPlaying(!!player.playing); } catch {}
    const sub = player.addListener("playingChange", (e) => setIsPlaying(!!e?.isPlaying));
    return () => { try { sub?.remove(); } catch {} };
  }, [player]);

  // Flush watch progress when the app is backgrounded/inactivated, and pause
  // playback so nothing keeps playing in the background. Pause only on a true
  // "background" transition — "inactive" is transient (Control Center, an
  // incoming call/notification) and pausing there would be jarring.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "background" && state !== "inactive") return;
      if (player && currentVideo && currentVideo.type !== "live") {
        updateWatchProgress(currentVideo.streamId, currentVideo.type, player.currentTime, Number.isFinite(player.duration) ? player.duration : 0);
      }
      flushProgress();
      if (state === "background") {
        try { player?.pause(); } catch {}
      }
    });
    return () => sub.remove();
  }, [player, currentVideo, updateWatchProgress, flushProgress]);

  // Track discovery + VOD progress interval.
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener("statusChange", (status) => {
      if (status.status === "readyToPlay") {
        try {
          if (player.availableAudioTracks?.length > 0) { setAudioTracks(player.availableAudioTracks); setSelectedAudio(player.audioTrack ?? null); }
          if (player.availableSubtitleTracks?.length > 0) setSubtitleTracks(player.availableSubtitleTracks);
        } catch {}
        if (currentVideo && currentVideo.type !== "live") {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = setInterval(() => {
            if (player && currentVideo) updateWatchProgress(currentVideo.streamId, currentVideo.type, player.currentTime, Number.isFinite(player.duration) ? player.duration : 0);
          }, 10000);
        }
      }
    });
    return () => { sub?.remove(); clearInterval(progressIntervalRef.current); };
  // Keyed on the URL, not the whole currentVideo object: re-subscribe only when
  // the actual stream changes, not on every metadata-object identity change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, currentVideo?.url, updateWatchProgress]);

  useEffect(() => {
    if (!currentVideo || hasAddedToHistory.current) return;
    if (currentVideo.type !== "live") {
      hasAddedToHistory.current = true;
      addToWatchHistory({ ...currentVideo, currentTime: currentVideo.startTime || 0 });
    }
  // Run once per distinct stream (keyed on URL); the hasAddedToHistory ref
  // guards re-entry within the same stream.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideo?.url]);

  useEffect(() => {
    hasAddedToHistory.current = false;
    prefsAppliedRef.current = false;
    setSpeed(1); setAudioTracks([]); setSubtitleTracks([]); setSelectedAudio(null); setSelectedSubtitle(null);
    setResolvedStart(0);
    setNowNext({ now: null, next: null });
  }, [currentVideo?.url]);

  // ---- Group 4: remember last live channel ----
  useEffect(() => {
    if (isLive && currentVideo?.streamId != null) {
      storage.setItem(LAST_CHANNEL_KEY, String(currentVideo.streamId)).catch(() => {});
    }
  }, [isLive, currentVideo?.streamId]);

  // ---- Group 4: EPG now/next for live ----
  useEffect(() => {
    if (!isLive || currentVideo?.streamId == null) return;
    let cancelled = false;
    // Route through the active backend (ContentService), not the raw Xtream
    // singleton — an M3U channel would otherwise get a prior Xtream account's
    // stale EPG. ContentService returns empty for M3U (no short-EPG API).
    fetchNowNext(contentService, currentVideo.streamId)
      .then((nn) => { if (!cancelled) setNowNext(nn || { now: null, next: null }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isLive, currentVideo?.streamId]);

  // ---- Group 1: aspect ratio is a VideoView prop (contentFit), not a player
  //      property in expo-video. Hold it in state and feed it to <VideoView>. ----
  const [contentFit, setContentFit] = useState("contain");

  useEffect(() => {
    if (!player || !prefsLoaded || prefsAppliedRef.current) return;
    // Speed.
    if (typeof prefs.playbackSpeed === "number" && SPEEDS.includes(prefs.playbackSpeed)) {
      try { player.playbackRate = prefs.playbackSpeed; setSpeed(prefs.playbackSpeed); } catch {}
    }
    // Aspect / contentFit (expo-video VideoView prop).
    if (prefs.aspectRatio && VALID_CONTENT_FITS.includes(prefs.aspectRatio)) {
      setContentFit(prefs.aspectRatio);
    }
    prefsAppliedRef.current = true;
  }, [player, prefsLoaded, prefs.playbackSpeed, prefs.aspectRatio]);

  // Cycle contentFit and remember it.
  const cycleContentFit = useCallback(() => {
    setContentFit((cur) => {
      const idx = VALID_CONTENT_FITS.indexOf(cur);
      const next = VALID_CONTENT_FITS[(idx + 1) % VALID_CONTENT_FITS.length];
      setPref("aspectRatio", next);
      return next;
    });
  }, [setPref]);

  // Fullscreen toggle — rotate the window to landscape (and back to portrait).
  // The player otherwise stays portrait-locked on open (see the mount effect).
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((fs) => {
      const next = !fs;
      ScreenOrientation.lockAsync(
        next
          ? ScreenOrientation.OrientationLock.LANDSCAPE
          : ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => {});
      return next;
    });
  }, []);

  // Play/pause toggle for the center transport button. Routes through the driver
  // (not player.pause() directly) so the recovery machine's play-intent stays
  // consistent — a manual pause won't be undone by a reconnect reload.
  const togglePlayPause = useCallback(() => {
    const p = playerRef.current;
    if (!p || !driver) return;
    let playing = false;
    try { playing = !!p.playing; } catch {}
    if (playing) driver.pause();
    else driver.play();
    resetControlsTimer();
  }, [driver, resetControlsTimer]);

  // Android immersive fullscreen: hide the system navigation bar (back / home /
  // recents) while fullscreen, and restore it on exit or unmount. iOS/web are a
  // no-op (module resolves to null off Android). setVisibilityAsync works under
  // edge-to-edge; the hidden bar falls back to Android's swipe-to-reveal.
  useEffect(() => {
    const NavBar = loadNavigationBar();
    if (!NavBar) return undefined;
    NavBar.setVisibilityAsync(isFullscreen ? "hidden" : "visible").catch(() => {});
    return () => { NavBar.setVisibilityAsync("visible").catch(() => {}); };
  }, [isFullscreen]);

  // Poll position/duration/buffered for the VOD seek bar. Paused while the user
  // is actively scrubbing so our preview doesn't fight the live value.
  useEffect(() => {
    // Poll only while the seek bar is actually on screen (VOD + controls shown).
    // The 10s watch-progress write and every lifecycle save read
    // player.currentTime directly, so gating this UI poll doesn't affect
    // history — it just stops a 2 Hz re-render of the whole player while the
    // viewer is only watching with the chrome hidden.
    if (!player || isLive || !showControls) return undefined;
    const read = () => {
      if (scrubSec != null) return;
      const duration = Number.isFinite(player.duration) ? player.duration : 0;
      const position = Number.isFinite(player.currentTime) ? player.currentTime : 0;
      const buffered = Number.isFinite(player.bufferedPosition) ? player.bufferedPosition : 0;
      setProgress({ position, duration, buffered });
    };
    // Prime immediately so the seek bar shows the live position the instant
    // controls re-appear, instead of the stale frozen value until the first tick.
    read();
    const id = setInterval(read, 500);
    return () => clearInterval(id);
  }, [player, isLive, scrubSec, showControls]);

  // Map a touch x within the seek track to a clamped time, and commit on release.
  const scrubToX = useCallback((x) => {
    const w = seekTrackWidth.current;
    if (!w || !progress.duration) return;
    const frac = Math.max(0, Math.min(1, x / w));
    setScrubSec(frac * progress.duration);
    resetControlsTimer();
  }, [progress.duration, resetControlsTimer]);

  const commitScrub = useCallback(() => {
    setScrubSec((sec) => {
      if (sec != null) {
        try { if (player && Number.isFinite(player.currentTime)) player.currentTime = sec; } catch {}
      }
      return null;
    });
    resetControlsTimer();
  }, [player, resetControlsTimer]);

  // Seek by a relative offset, clamped to [0, duration]. Backs the seek bar's
  // accessibilityActions (increment/decrement) so VoiceOver/TalkBack can scrub.
  const seekBy = useCallback((delta) => {
    const p = playerRef.current;
    try {
      if (p && Number.isFinite(p.currentTime)) {
        const dur = Number.isFinite(p.duration) ? p.duration : Infinity;
        p.currentTime = Math.max(0, Math.min(dur, p.currentTime + delta));
      }
    } catch {}
    resetControlsTimer();
  }, [resetControlsTimer]);

  // Apply remembered audio/subtitle selections once the tracks are discovered.
  useEffect(() => {
    if (!player || !prefsLoaded) return;
    if (prefs.audioTrack && audioTracks.length > 0) {
      const match = audioTracks.find((t) => t.id === prefs.audioTrack || t.language === prefs.audioTrack);
      if (match) { try { player.audioTrack = match; setSelectedAudio(match); } catch {} }
    }
  }, [player, prefsLoaded, prefs.audioTrack, audioTracks]);

  useEffect(() => {
    if (!player || !prefsLoaded) return;
    if (prefs.subtitleTrack && subtitleTracks.length > 0) {
      const match = subtitleTracks.find((t) => t.id === prefs.subtitleTrack || t.language === prefs.subtitleTrack);
      if (match) { try { player.subtitleTrack = match; setSelectedSubtitle(match); } catch {} }
    }
  }, [player, prefsLoaded, prefs.subtitleTrack, subtitleTracks]);

  const getNextEpisode = useCallback(() => findNextEpisode(currentVideo), [currentVideo]);

  const handleNextEpisode = useCallback(() => {
    const video = buildNextEpisodeVideo(
      getNextEpisode(),
      currentVideo,
      (id, ext) => contentService.buildEpisodeUrl(id, ext),
    );
    if (video) playVideo(video);
  }, [getNextEpisode, currentVideo, playVideo]);

  useEffect(() => {
    if (!player || !currentVideo) return;
    const sub = player.addListener("playToEnd", () => { if (currentVideo.type === "series" && getNextEpisode()) handleNextEpisode(); });
    return () => sub?.remove();
  // Keyed on the URL so the playToEnd listener is re-bound per stream, not on
  // every currentVideo object identity change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, currentVideo?.url, handleNextEpisode, getNextEpisode]);

  // ---- Group 4: live channel zap (prev/next) ----
  const zapChannel = useCallback((dir) => {
    if (!isLive || !Array.isArray(channels) || channels.length === 0 || !currentVideo) return;
    const target = dir === "next"
      ? nextChannel(channels, currentVideo.streamId)
      : prevChannel(channels, currentVideo.streamId);
    if (!target) return;
    const sid = target.stream_id ?? target.id;
    if (sid == null || String(sid) === String(currentVideo.streamId)) return;
    if (player && currentVideo.type !== "live") {
      updateWatchProgress(currentVideo.streamId, currentVideo.type, player.currentTime, Number.isFinite(player.duration) ? player.duration : 0);
    }
    playVideo({ type: "live", streamId: sid, name: target.name, url: target.url, cover: target.logo || null });
  }, [isLive, channels, currentVideo, player, playVideo, updateWatchProgress]);

  const handleClose = useCallback(() => {
    if (player && currentVideo && currentVideo.type !== "live") updateWatchProgress(currentVideo.streamId, currentVideo.type, player.currentTime, Number.isFinite(player.duration) ? player.duration : 0);
    flushProgress();
    clearInterval(progressIntervalRef.current);
    // Stop the player explicitly: staysActiveInBackground keeps the audio
    // session alive, so without this the stream keeps playing after the screen
    // pops. Pause now; the unmount effect releases the instance.
    try { playerRef.current?.pause(); } catch {}
    closeVideo();
    navigation.goBack();
  }, [player, currentVideo, updateWatchProgress, flushProgress, closeVideo, navigation]);

  // Stop + release the player when the screen leaves, regardless of how it was
  // dismissed (close button, hardware back, or navigation gesture). Without
  // this, staysActiveInBackground leaves audio playing in the background.
  useEffect(() => {
    return () => {
      const p = playerRef.current;
      if (!p) return;
      try { p.pause(); } catch {}
      // Clear the source before release. Prefer replaceAsync: the synchronous
      // replace() loads on the main thread and fires expo-video's deprecation
      // warning even for a null source. release() follows immediately either way.
      try {
        if (typeof p.replaceAsync === "function") p.replaceAsync(null).catch(() => {});
        else if (typeof p.replace === "function") p.replace(null);
      } catch {}
      try { if (typeof p.release === "function") p.release(); } catch {}
    };
  }, []);

  // ---- Group 3: sleep timer (pause + close on elapse) ----
  const sleep = useSleepTimer(useCallback(() => {
    try { if (playerRef.current) playerRef.current.pause(); } catch {}
    handleClose();
  }, [handleClose]));

  const handleSpeedChange = (rate) => {
    if (player) { try { player.playbackRate = rate; } catch {} setSpeed(rate); }
    setPref("playbackSpeed", rate);
    setShowSpeedMenu(false);
  };
  const handleAudioChange = (track) => {
    try { if (player) player.audioTrack = track; setSelectedAudio(track); } catch {}
    setPref("audioTrack", track ? (track.id ?? track.language ?? null) : null);
    setShowAudioMenu(false);
  };
  const handleSubtitleChange = (track) => {
    try { if (player) player.subtitleTrack = track; setSelectedSubtitle(track); } catch {}
    setPref("subtitleTrack", track ? (track.id ?? track.language ?? null) : null);
    setShowSubtitleMenu(false);
  };

  // ---- Group 1: resume choice ----
  const handleResume = useCallback(() => {
    const t = resume.decide("resume");
    setResolvedStart(t);
  }, [resume]);
  const handleStartOver = useCallback(() => {
    resume.decide("startOver");
    setResolvedStart(0);
  }, [resume]);

  // ---- Group 2: subtitle/audio tuning changes from the SubtitleSettings panel ----
  const subtitleStyleValue = useMemo(
    () => ({ ...DEFAULT_SUBTITLE_STYLE, ...(prefs.subtitleStyle || {}) }),
    [prefs.subtitleStyle],
  );
  const handleSettingsChange = useCallback((partial) => {
    if (!partial) return;
    if (partial.style) {
      setPref("subtitleStyle", { ...subtitleStyleValue, ...partial.style });
    }
    if (typeof partial.subtitleOffsetMs === "number") {
      const v = clampOffset(partial.subtitleOffsetMs);
      setPref("subtitleOffsetMs", v);
      // expo-video has no public subtitle-timing offset API. Best-effort:
      // documented as a no-op on native; the value is persisted so the web
      // path (and a future native engine) can honour it. See report.
    }
    if (typeof partial.audioOffsetMs === "number") {
      const v = clampOffset(partial.audioOffsetMs);
      setPref("audioOffsetMs", v);
      // expo-video exposes no audio-delay API — persisted only (best-effort).
    }
  }, [setPref, subtitleStyleValue]);

  // ---- Group 3: PiP trigger (guarded) ----
  const handlePip = useCallback(async () => {
    const view = videoViewRef.current;
    if (!view || typeof view.startPictureInPicture !== "function") return;
    try { await view.startPictureInPicture(); } catch {}
  }, []);

  // ---- Group 4: stats snapshot from player (tolerate missing fields) ----
  const stats = useMemo(() => {
    if (!showStats || !player) return {};
    let resolution;
    let fps;
    try {
      const vt = player.videoTrack;
      if (vt?.size?.width && vt?.size?.height) resolution = `${vt.size.width}x${vt.size.height}`;
      if (typeof vt?.frameRate === "number") fps = Math.round(vt.frameRate);
    } catch {}
    return {
      resolution,
      fps,
      levelLabel: playback.qualityCap && playback.qualityCap !== "auto" ? String(playback.qualityCap) : "auto",
      bufferSec: typeof player.bufferedPosition === "number" && Number.isFinite(player.currentTime)
        ? Math.max(0, player.bufferedPosition - player.currentTime)
        : undefined,
    };
  }, [showStats, player, playback.qualityCap]);

  // Safety net: when the video is cleared *externally* (profile switch, sign-out)
  // pop this screen off the native stack. handleClose already pops explicitly, so
  // guard on canGoBack() — otherwise its closeVideo() nulls currentVideo and this
  // effect double-pops, which React Navigation rejects ("GO_BACK was not handled").
  useEffect(() => {
    if (!currentVideo && navigation.canGoBack?.()) navigation.goBack();
  }, [currentVideo, navigation]);

  // ---- Group 3: touch gestures via PanResponder (no new deps) ----
  const brightnessRef = useRef(null); // lazy-loaded expo-brightness module
  const gestureState = useRef({ mode: null, startX: 0, startY: 0, startVol: 1, startBright: null, startTime: 0, lastTapTime: 0, lastTapX: 0, longPressTimer: null, longPressed: false, layoutW: 0 });

  if (brightnessRef.current === null) brightnessRef.current = loadBrightness() || false;

  const panResponder = useMemo(() => PanResponder.create({
    // On real Android devices, returning true unconditionally here causes the
    // gesture View to swallow taps before the overlaid controls (play/pause,
    // close, settings, seek bar) can receive them — the user can't pause or
    // seek. The simulator is lenient about this; hardware is not.
    //
    // Fix: while controls are visible, yield every tap (return false) so those
    // on-top buttons get their onPress. Swipes still work anywhere via
    // onMoveShouldSetPanResponder (>6px), so seek/volume/brightness are intact.
    // When controls are hidden there's nothing on top to yield to, so claim the
    // tap to drive tap-to-reveal, double-tap-seek, and long-press 2x.
    onStartShouldSetPanResponder: () => {
      if (DEBUG_HUD) hudRef.current?.bump("startAsk");
      return !showControlsRef.current;
    },
    onMoveShouldSetPanResponder: (_e, g) => {
      const yes = Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6;
      if (DEBUG_HUD && yes) hudRef.current?.bump("moveAsk");
      return yes;
    },
    onPanResponderGrant: (e) => {
      if (DEBUG_HUD) hudRef.current?.bump("grant");
      const gs = gestureState.current;
      const p = playerRef.current;
      gs.mode = null;
      gs.startX = e.nativeEvent.pageX;
      gs.startY = e.nativeEvent.pageY;
      gs.longPressed = false;
      try { gs.startVol = p && typeof p.volume === "number" ? p.volume : 1; } catch { gs.startVol = 1; }
      try { gs.startTime = p && Number.isFinite(p.currentTime) ? p.currentTime : 0; } catch { gs.startTime = 0; }
      gs.startBright = null;
      // Long-press -> temporary 2x speed.
      clearTimeout(gs.longPressTimer);
      gs.longPressTimer = setTimeout(() => {
        gs.longPressed = true;
        try { if (playerRef.current) playerRef.current.playbackRate = 2; } catch {}
        flashHint("speed", "2x");
      }, LONG_PRESS_MS);
    },
    onPanResponderMove: (e, g) => {
      if (DEBUG_HUD) hudRef.current?.bump("move");
      const gs = gestureState.current;
      const p = playerRef.current;
      if (gs.longPressed) return; // long-press active; ignore movement
      // Decide gesture axis once movement is meaningful.
      if (!gs.mode) {
        if (Math.abs(g.dx) < 8 && Math.abs(g.dy) < 8) return;
        clearTimeout(gs.longPressTimer);
        if (Math.abs(g.dx) > Math.abs(g.dy)) {
          gs.mode = "seek";
        } else {
          const w = gs.layoutW || 1;
          gs.mode = gs.startX > w / 2 ? "volume" : "brightness";
          if (gs.mode === "brightness" && brightnessRef.current) {
            try { brightnessRef.current.getBrightnessAsync().then((b) => { gs.startBright = b; }).catch(() => {}); } catch {}
          }
        }
      }
      if (gs.mode === "seek") {
        const deltaSec = g.dx / SEEK_PX_PER_SEC;
        const sign = deltaSec >= 0 ? "+" : "-";
        flashHint("seek", `${sign}${Math.abs(Math.round(deltaSec))}s`);
      } else if (gs.mode === "volume") {
        const next = Math.min(1, Math.max(0, gs.startVol - g.dy / VERT_SWIPE_RANGE_PX));
        try { if (p) p.volume = next; } catch {}
        flashHint("volume", `Vol ${Math.round(next * 100)}%`);
      } else if (gs.mode === "brightness") {
        const mod = brightnessRef.current;
        if (mod && gs.startBright != null) {
          const next = Math.min(1, Math.max(0, gs.startBright - g.dy / VERT_SWIPE_RANGE_PX));
          try { mod.setBrightnessAsync(next).catch(() => {}); } catch {}
          flashHint("brightness", `Bright ${Math.round(next * 100)}%`);
        }
      }
    },
    onPanResponderRelease: (e, g) => {
      if (DEBUG_HUD) hudRef.current?.bump("release");
      const gs = gestureState.current;
      const p = playerRef.current;
      clearTimeout(gs.longPressTimer);
      if (gs.longPressed) {
        // Restore the user's chosen speed.
        try { if (p) p.playbackRate = speed; } catch {}
        gs.longPressed = false;
        gs.mode = null;
        return;
      }
      if (gs.mode === "seek") {
        const deltaSec = g.dx / SEEK_PX_PER_SEC;
        try { if (p && Number.isFinite(p.currentTime)) p.currentTime = Math.max(0, gs.startTime + deltaSec); } catch {}
        gs.mode = null;
        return;
      }
      if (!gs.mode) {
        // A tap. Detect double-tap left/right for -/+ seek; else toggle controls.
        const now = Date.now();
        const x = e.nativeEvent.pageX;
        const w = gs.layoutW || 1;
        if (now - gs.lastTapTime < DOUBLE_TAP_MS && Math.abs(x - gs.lastTapX) < w / 2) {
          const right = x > w / 2;
          try {
            if (p && Number.isFinite(p.currentTime)) {
              p.currentTime = Math.max(0, p.currentTime + (right ? DOUBLE_TAP_SEEK : -DOUBLE_TAP_SEEK));
            }
          } catch {}
          flashHint("seek", right ? `+${DOUBLE_TAP_SEEK}s` : `-${DOUBLE_TAP_SEEK}s`);
          gs.lastTapTime = 0;
        } else {
          if (DEBUG_HUD) hudRef.current?.bump("tap");
          gs.lastTapTime = now;
          gs.lastTapX = x;
          resetControlsTimer();
        }
      }
      gs.mode = null;
    },
    onPanResponderTerminate: () => {
      if (DEBUG_HUD) hudRef.current?.bump("terminate");
      const gs = gestureState.current;
      clearTimeout(gs.longPressTimer);
      if (gs.longPressed) { try { if (playerRef.current) playerRef.current.playbackRate = speed; } catch {} }
      gs.longPressed = false;
      gs.mode = null;
    },
  }), [flashHint, resetControlsTimer, speed]);

  const deviceCompromised = useDeviceIntegrity();

  if (!currentVideo || !player) return null;

  // Jailbreak/root soft-block: refuse playback + warn (native only; false on
  // web/TV/Electron). Fail-open — see integrityPolicy. Browsing stays allowed;
  // only streaming is gated. Server attestation is the authoritative check.
  if (deviceCompromised) {
    return (
      <YStack flex={1} backgroundColor={colors.bg} alignItems="center" justifyContent="center" padding={24} gap={16}>
        <Icon name="warning" size={40} color={colors.danger} />
        <Text color={colors.danger} fontSize={20} fontWeight="700" textAlign="center">
          Playback blocked
        </Text>
        <Text color={colors.muted} fontSize={14} textAlign="center">
          This device appears to be jailbroken or rooted. Streaming is disabled
          for security. Contact support if you believe this is a mistake.
        </Text>
        <Button variant="primary" size="lg" onPress={closeVideo}>
          Go back
        </Button>
      </YStack>
    );
  }

  const nextEpisode = getNextEpisode();
  const topPadding = Platform.OS === "ios" ? 12 : 8;
  const brightnessAvailable = !!brightnessRef.current;

  return (
    <YStack flex={1} backgroundColor="#000">
      <StatusBar hidden />

      {/* Video + gesture surface. nativeControls disabled so PanResponder owns
          touches; gesture indicators + custom controls replace them. */}
      <View
        style={{ position: "absolute", top: insets.top, left: 0, right: 0, bottom: insets.bottom }}
        onLayout={(ev) => { gestureState.current.layoutW = ev.nativeEvent.layout.width; }}
        onTouchStart={DEBUG_HUD ? () => hudRef.current?.bump("rawTouch") : undefined}
        onTouchEnd={DEBUG_HUD ? () => hudRef.current?.bump("touchEnd") : undefined}
        {...panResponder.panHandlers}
      >
        <VideoView
          ref={videoViewRef}
          player={player}
          style={{ flex: 1 }}
          contentFit={contentFit}
          nativeControls={false}
          // Android: default SurfaceView composites the video in a separate
          // window layer whose z-order vs. the RN tree is GPU/device-dependent.
          // On real hardware it paints over our sibling control overlays (they
          // never appear, though the emulator renders them fine). TextureView
          // renders in-hierarchy so overlays composite + hit-test normally.
          surfaceType="textureView"
          fullscreenOptions={{ enable: true }}
          allowsPictureInPicture
          onPictureInPictureStart={() => setIsPip(true)}
          onPictureInPictureStop={() => setIsPip(false)}
        />
      </View>

      {/* Gesture indicator (imperative leaf; see flashHint) */}
      <GestureHint ref={hintRef} />

      {/* Stats overlay */}
      {showStats && <StatsOverlay stats={stats} />}

      {/* Resume prompt (VOD only, before playback) */}
      <ResumePrompt
        visible={needsResumeChoice}
        resumeTime={resume.resumeTime}
        percent={resume.percent}
        onResume={handleResume}
        onStartOver={handleStartOver}
      />

      {/* Busy overlay — initial load, transient buffering, or a genuine
          reconnect. A translucent scrim (NOT the opaque StatePanel) so the
          VideoView's retained last frame stays visible with the loader on top,
          instead of a solid black panel. Ordinary buffering never triggers a
          reconnect on native (the recovery machine ignores buffering status and
          only the 6s stall watchdog escalates), so this no longer flashes
          "reconnecting" on every buffer blip.
          NOTE: expo-video can't hand us the decoded frame, so across a genuine
          reconnect (player.replace blanks the view) the backdrop is briefly
          black; during transient buffering the real last frame shows through. */}
      {(isLoading || isRecovering) && !isFatal && !needsResumeChoice && (
        <YStack
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          justifyContent="center"
          alignItems="center"
          gap={16}
          backgroundColor={playerScrim.busy}
          pointerEvents="none"
          zIndex={35}
        >
          <Spinner size="large" color={colors.accent2} />
          <Text color={colors.text} fontFamily={fonts.body} fontSize={16} fontWeight="600">
            {isRecovering ? "Reconnecting…" : "Loading…"}
          </Text>
        </YStack>
      )}

      {/* Fatal error screen */}
      {isFatal && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} backgroundColor={playerScrim.fatal} zIndex={40}>
          <StatePanel
            mode="error"
            title={FATAL_TITLE}
            message={FATAL_HEADLINE}
            onRetry={() => playback.retry()}
          />
          {/* Raw reason as quiet secondary detail — informs without alarming,
              matching the web surface so the failure tone is identical. */}
          <Text color={colors.textDim} fontFamily={fonts.body} fontSize={12} textAlign="center" paddingHorizontal={24}>
            {fatalDetail(playback.fatalReason)}
          </Text>
          <XStack justifyContent="center" paddingTop={16} paddingBottom={32}>
            <Button variant="secondary" size="md" icon="close" onPress={handleClose}>Close</Button>
          </XStack>
        </YStack>
      )}

      {/* Center play/pause transport. Shown with the controls, hidden during
          load / fatal error / resume prompt so it never overlaps them. The
          box-none wrapper lets the surrounding video gestures still fire. */}
      {showControls && !isLoading && !isRecovering && !isFatal && !needsResumeChoice && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center" pointerEvents="box-none" zIndex={30}>
          <YStack width={72} height={72} backgroundColor={playerScrim.panel} borderRadius={36} justifyContent="center" alignItems="center" cursor="pointer" onPress={togglePlayPause} pressStyle={{ opacity: 0.8 }} accessibilityRole="button" accessibilityLabel={isPlaying ? "Pause" : "Play"}>
            <Icon name={isPlaying ? "pause" : "play"} size={34} color={colors.text} />
          </YStack>
        </YStack>
      )}

      {/* Top controls bar */}
      {showControls && (
        <YStack position="absolute" top={0} left={0} right={0} paddingTop={insets.top + topPadding} paddingLeft={insets.left} paddingRight={insets.right} pointerEvents="box-none">
          <XStack alignItems="center" paddingHorizontal={12} paddingVertical={8} backgroundColor={playerScrim.bar} flexWrap="wrap" gap={8}>
            <YStack width={44} height={44} backgroundColor={overlay} borderWidth={1} borderColor={colors.border} borderRadius={22} justifyContent="center" alignItems="center" cursor="pointer" onPress={handleClose} pressStyle={{ opacity: 0.8 }} accessibilityRole="button" accessibilityLabel={controlLabel.close}>
              <Icon name={controlIcon.close} size={16} color={colors.text} />
            </YStack>

            <Text color={colors.text} fontFamily={fonts.display} fontSize={14} fontWeight="600" flex={1} minWidth={60} numberOfLines={1}>{currentVideo.name}</Text>

            {isLive && channels.length > 1 && (
              <>
                <Button variant="secondary" size="sm" icon={controlIcon.prevChannel} onPress={() => zapChannel("prev")} accessibilityLabel={controlLabel.prevChannel} />
                <Button variant="secondary" size="sm" icon={controlIcon.nextChannel} onPress={() => zapChannel("next")} accessibilityLabel={controlLabel.nextChannel} />
              </>
            )}

            {nextEpisode && (
              <Button variant="primary" size="sm" icon={controlIcon.nextEpisode} onPress={handleNextEpisode} accessibilityLabel={controlLabel.nextEpisode}>Next</Button>
            )}
          </XStack>

          {/* EPG now/next strip for live */}
          {isLive && (nowNext.now || nowNext.next) && (
            <XStack paddingHorizontal={12} paddingVertical={6} backgroundColor={playerScrim.panel} gap={16} flexWrap="wrap">
              {nowNext.now && (
                <Text color={colors.text} fontSize={12} numberOfLines={1} flex={1} minWidth={120}>
                  Now: {nowNext.now.title}{typeof nowNext.now.progressPct === "number" ? ` (${nowNext.now.progressPct}%)` : ""}
                </Text>
              )}
              {nowNext.next && (
                <Text color={colors.textDim} fontSize={12} numberOfLines={1} flex={1} minWidth={120}>
                  Next: {nowNext.next.title}
                </Text>
              )}
            </XStack>
          )}
        </YStack>
      )}

      {/* Bottom control container — settings icon row + (VOD) seek bar */}
      {showControls && (
        <YStack position="absolute" bottom={0} left={0} right={0} paddingBottom={insets.bottom + 12} paddingLeft={insets.left} paddingRight={insets.right} backgroundColor={playerScrim.bar} zIndex={20}>
          {/* Ruthlessly small primary row — the same three everywhere: Subtitles,
              Fullscreen, More. Everything secondary (speed, audio, fit, sleep,
              stats, PiP, subtitle tuning) lives behind the single "More" sheet, so
              a non-technical viewer sees at most three obvious controls, not a wall
              of glyphs. More takes the active indigo fill when anything inside it
              is engaged. Subtitles only appears when the stream actually has any. */}
          <XStack flexWrap="wrap" justifyContent="center" alignItems="center" gap={8} paddingHorizontal={12} paddingVertical={8}>
            {subtitleTracks.length > 0 && (
              <Button variant="secondary" size="sm" icon={controlIcon.subtitles} onPress={() => { setShowSubtitleMenu(true); setShowSpeedMenu(false); setShowAudioMenu(false); }} accessibilityLabel={controlLabel.subtitles} />
            )}
            <Button variant={isFullscreen ? "primary" : "secondary"} size="sm" icon={controlIcon.fullscreen} onPress={toggleFullscreen} accessibilityLabel={isFullscreen ? controlLabel.exitFullscreen : controlLabel.fullscreen} />
            <Button variant={showStats || sleep.active || isPip ? "primary" : "secondary"} size="sm" icon={controlIcon.more} onPress={() => setShowMoreMenu(true)} accessibilityLabel={controlLabel.more}>{sleep.active ? formatRemaining(sleep.secondsLeft) : controlLabel.more}</Button>
          </XStack>

          {/* Seek bar (VOD only) */}
          {!isLive && progress.duration > 0 && (() => {
            const shown = scrubSec != null ? scrubSec : progress.position;
            const playedPct = Math.max(0, Math.min(100, (shown / progress.duration) * 100));
            const bufferedPct = Math.max(0, Math.min(100, (progress.buffered / progress.duration) * 100));
            return (
              <YStack paddingHorizontal={16} paddingTop={4}>
                <View
                  style={{ height: 44, justifyContent: "center" }}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel="Seek bar"
                  accessibilityValue={{
                    min: 0,
                    max: Math.round(progress.duration),
                    now: Math.round(shown),
                    text: `${formatTime(shown)} of ${formatTime(progress.duration)}`,
                  }}
                  accessibilityActions={[
                    { name: "increment", label: "Forward 10 seconds" },
                    { name: "decrement", label: "Back 10 seconds" },
                  ]}
                  onAccessibilityAction={(e) => {
                    if (e.nativeEvent.actionName === "increment") seekBy(DOUBLE_TAP_SEEK);
                    else if (e.nativeEvent.actionName === "decrement") seekBy(-DOUBLE_TAP_SEEK);
                  }}
                  onLayout={(e) => { seekTrackWidth.current = e.nativeEvent.layout.width; }}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={(e) => scrubToX(e.nativeEvent.locationX)}
                  onResponderMove={(e) => scrubToX(e.nativeEvent.locationX)}
                  onResponderRelease={commitScrub}
                  onResponderTerminate={commitScrub}
                >
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: seekTrack.track }} />
                  <View style={{ position: "absolute", left: 0, height: 4, borderRadius: 2, width: `${bufferedPct}%`, backgroundColor: seekTrack.buffered }} />
                  <View style={{ position: "absolute", left: 0, height: 4, borderRadius: 2, width: `${playedPct}%`, backgroundColor: colors.accent }} />
                  <View style={{ position: "absolute", left: `${playedPct}%`, width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: colors.accent }} />
                </View>
                <XStack justifyContent="space-between" marginTop={4}>
                  <Text color={colors.text} fontSize={12} fontWeight="600">{formatTime(shown)}</Text>
                  {/* textDim (not muted): the secondary duration must hold AA over
                      bright frames — #7A86A8 can dip below 4.5:1, #B8C0DA holds. */}
                  <Text color={colors.textDim} fontSize={12}>{formatTime(progress.duration)}</Text>
                </XStack>
              </YStack>
            );
          })()}
        </YStack>
      )}

      {/* Speed Menu */}
      <Modal visible={showSpeedMenu} transparent animationType={modalAnimation} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowSpeedMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: playerScrim.hint, justifyContent: "center", alignItems: "center" }} activeOpacity={1} accessible={false} onPress={() => setShowSpeedMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={220} maxHeight={350} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.textDim} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Playback Speed</Text>
            <ScrollView>
              {SPEEDS.map((rate) => (
                <YStack key={rate} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={speed === rate ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleSpeedChange(rate)} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityState={{ selected: speed === rate }} accessibilityLabel={`${rate}x speed`}>
                  <Text color={speed === rate ? colors.accent : colors.text} fontSize={15} fontWeight={speed === rate ? "700" : "400"}>{rate}x{rate === 1 ? " (Normal)" : ""}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* Audio Menu */}
      <Modal visible={showAudioMenu} transparent animationType={modalAnimation} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowAudioMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: playerScrim.hint, justifyContent: "center", alignItems: "center" }} activeOpacity={1} accessible={false} onPress={() => setShowAudioMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={220} maxHeight={350} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.textDim} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Audio Track</Text>
            <ScrollView>
              {audioTracks.map((track, idx) => (
                <YStack key={idx} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedAudio === track ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleAudioChange(track)} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityState={{ selected: selectedAudio === track }} accessibilityLabel={`Audio track ${track.language || track.label || idx + 1}`}>
                  <Text color={selectedAudio === track ? colors.accent : colors.text} fontSize={15} fontWeight={selectedAudio === track ? "700" : "400"}>{track.language || track.label || `Track ${idx + 1}`}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* Subtitle Menu */}
      <Modal visible={showSubtitleMenu} transparent animationType={modalAnimation} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowSubtitleMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: playerScrim.hint, justifyContent: "center", alignItems: "center" }} activeOpacity={1} accessible={false} onPress={() => setShowSubtitleMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={220} maxHeight={350} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.textDim} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Subtitles</Text>
            <ScrollView>
              <YStack paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedSubtitle === null ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleSubtitleChange(null)} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityState={{ selected: selectedSubtitle === null }} accessibilityLabel="Subtitles off">
                <Text color={selectedSubtitle === null ? colors.accent : colors.text} fontSize={15} fontWeight={selectedSubtitle === null ? "700" : "400"}>Off</Text>
              </YStack>
              {subtitleTracks.map((track, idx) => (
                <YStack key={idx} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedSubtitle === track ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleSubtitleChange(track)} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityState={{ selected: selectedSubtitle === track }} accessibilityLabel={`Subtitle ${track.language || track.label || idx + 1}`}>
                  <Text color={selectedSubtitle === track ? colors.accent : colors.text} fontSize={15} fontWeight={selectedSubtitle === track ? "700" : "400"}>{track.language || track.label || `Track ${idx + 1}`}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* Subtitle & Audio tuning panel */}
      <Modal visible={showSubtitleSettings} transparent animationType={modalAnimation} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowSubtitleSettings(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: playerScrim.hint, justifyContent: "center", alignItems: "center" }} activeOpacity={1} accessible={false} onPress={() => setShowSubtitleSettings(false)}>
          <TouchableOpacity activeOpacity={1} accessible={false}>
            {/* Unlike the option-picker sheets, nothing here auto-dismisses on
                tap (steppers/toggles just adjust), so a screen-reader user has no
                select-to-close path — give this one sheet an explicit Done. */}
            <YStack gap={8}>
              <SubtitleSettings
                style={subtitleStyleValue}
                subtitleOffsetMs={typeof prefs.subtitleOffsetMs === "number" ? prefs.subtitleOffsetMs : 0}
                audioOffsetMs={typeof prefs.audioOffsetMs === "number" ? prefs.audioOffsetMs : 0}
                // expo-video exposes no subtitle/audio delay API — hide the offset
                // steppers so they never present a control that does nothing here.
                showOffsets={false}
                onChange={handleSettingsChange}
              />
              <Button variant="secondary" size="md" onPress={() => setShowSubtitleSettings(false)}>Done</Button>
            </YStack>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Sleep-timer menu */}
      <Modal visible={showSleepMenu} transparent animationType={modalAnimation} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowSleepMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: playerScrim.hint, justifyContent: "center", alignItems: "center" }} activeOpacity={1} accessible={false} onPress={() => setShowSleepMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={240} maxHeight={400} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.textDim} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Sleep Timer</Text>
            <ScrollView>
              {SLEEP_PRESETS.map((preset) => (
                <YStack
                  key={preset.label}
                  paddingVertical={12}
                  paddingHorizontal={16}
                  borderRadius={8}
                  cursor="pointer"
                  onPress={() => {
                    if (preset.kind === "end-of-episode") {
                      // No fixed duration: cancel any active timer; the playToEnd
                      // listener already advances/closes at end of media.
                      sleep.cancel();
                    } else if (typeof preset.minutes === "number") {
                      sleep.start(preset.minutes);
                    }
                    setShowSleepMenu(false);
                  }}
                  pressStyle={{ opacity: 0.7 }}
                  accessibilityRole="button"
                  accessibilityLabel={preset.label}
                >
                  <Text color={colors.text} fontSize={15}>{preset.label}</Text>
                </YStack>
              ))}
              {sleep.active && (
                <YStack paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={accentAlpha(0.2)} cursor="pointer" onPress={() => { sleep.cancel(); setShowSleepMenu(false); }} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityLabel="Cancel sleep timer">
                  <Text color={colors.accent} fontSize={15} fontWeight="700">Cancel timer ({formatRemaining(sleep.secondsLeft)})</Text>
                </YStack>
              )}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* More options sheet — the rarer controls (tuning, stats, sleep, PiP) with
          text labels, so the inline row stays a small, decipherable set. */}
      <Modal visible={showMoreMenu} transparent animationType={modalAnimation} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowMoreMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: playerScrim.hint, justifyContent: "center", alignItems: "center" }} activeOpacity={1} accessible={false} onPress={() => setShowMoreMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={280} maxHeight={440} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.textDim} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>{controlLabel.more}</Text>
            <ScrollView>
            {!isLive && (
              <XStack alignItems="center" gap={12} paddingVertical={12} paddingHorizontal={16} borderRadius={8} cursor="pointer" onPress={() => { setShowMoreMenu(false); setShowSpeedMenu(true); }} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityLabel={controlLabel.speed}>
                <Icon name={controlIcon.speed} size={20} color={colors.text} />
                <Text color={colors.text} fontSize={15} flex={1}>{controlLabel.speed}</Text>
                <Text color={colors.textDim} fontSize={13}>{`${speed}x`}</Text>
              </XStack>
            )}
            {audioTracks.length > 1 && (
              <XStack alignItems="center" gap={12} paddingVertical={12} paddingHorizontal={16} borderRadius={8} cursor="pointer" onPress={() => { setShowMoreMenu(false); setShowAudioMenu(true); }} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityLabel={controlLabel.audio}>
                <Icon name={controlIcon.audio} size={20} color={colors.text} />
                <Text color={colors.text} fontSize={15} flex={1}>{controlLabel.audio}</Text>
              </XStack>
            )}
            <XStack alignItems="center" gap={12} paddingVertical={12} paddingHorizontal={16} borderRadius={8} cursor="pointer" onPress={cycleContentFit} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityLabel={controlLabel.fit}>
              <Icon name={controlIcon.fit} size={20} color={colors.text} />
              <Text color={colors.text} fontSize={15} flex={1}>{controlLabel.fit}</Text>
              <Text color={colors.textDim} fontSize={13}>{fitLabel(contentFit)}</Text>
            </XStack>
            <XStack alignItems="center" gap={12} paddingVertical={12} paddingHorizontal={16} borderRadius={8} cursor="pointer" onPress={() => { setShowMoreMenu(false); setShowSubtitleSettings(true); }} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityLabel="Subtitle and audio settings">
              <Icon name="tune" size={20} color={colors.text} />
              <Text color={colors.text} fontSize={15} flex={1}>Subtitle &amp; audio settings</Text>
            </XStack>
            <XStack alignItems="center" gap={12} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={sleep.active ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => { setShowMoreMenu(false); setShowSleepMenu(true); }} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityState={{ selected: sleep.active }} accessibilityLabel={controlLabel.sleep}>
              <Icon name={controlIcon.sleep} size={20} color={sleep.active ? colors.accent : colors.text} />
              <Text color={sleep.active ? colors.accent : colors.text} fontSize={15} flex={1}>{controlLabel.sleep}</Text>
              {sleep.active ? <Text color={colors.accent} fontSize={13}>{formatRemaining(sleep.secondsLeft)}</Text> : null}
            </XStack>
            <XStack alignItems="center" gap={12} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={isPip ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => { setShowMoreMenu(false); handlePip(); }} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityState={{ selected: isPip }} accessibilityLabel={controlLabel.pip}>
              <Icon name={controlIcon.pip} size={20} color={isPip ? colors.accent : colors.text} />
              <Text color={isPip ? colors.accent : colors.text} fontSize={15} flex={1}>{controlLabel.pip}</Text>
            </XStack>
            <XStack alignItems="center" gap={12} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={showStats ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => setShowStats((s) => !s)} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityState={{ selected: showStats }} accessibilityLabel={controlLabel.stats}>
              <Icon name={controlIcon.stats} size={20} color={showStats ? colors.accent : colors.text} />
              <Text color={showStats ? colors.accent : colors.text} fontSize={15} flex={1}>{controlLabel.stats}</Text>
              <Text color={showStats ? colors.accent : colors.textDim} fontSize={13}>{showStats ? "On" : "Off"}</Text>
            </XStack>
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* One-time gesture legend (first VOD playback). The swipe/tap gestures are
          otherwise invisible; this teaches them once. Reduced-motion safe (no
          animation of its own). */}
      {showGestureHint && !isLoading && !isRecovering && !needsResumeChoice && !isFatal && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center" backgroundColor={playerScrim.legend} zIndex={60} padding={24} gap={16}>
          <Text color={colors.text} fontFamily={fonts.display} fontSize={18} fontWeight="700">Gesture controls</Text>
          <YStack gap={8} alignItems="flex-start" maxWidth={320}>
            <Text color={colors.textDim} fontSize={14}>• Drag left / right — seek</Text>
            <Text color={colors.textDim} fontSize={14}>• Double-tap left / right — skip back / forward 10s</Text>
            <Text color={colors.textDim} fontSize={14}>• Press &amp; hold — 2× speed</Text>
            <Text color={colors.textDim} fontSize={14}>• Swipe right side up / down — volume</Text>
            {brightnessAvailable && (
              <Text color={colors.textDim} fontSize={14}>• Swipe left side up / down — brightness</Text>
            )}
          </YStack>
          <Button variant="primary" size="md" onPress={dismissGestureHint}>Got it</Button>
        </YStack>
      )}

      {/* TEMP DIAGNOSTIC — always-on HUD (top of z-order, not gated by
          showControls). Remove with DEBUG_HUD. */}
      {DEBUG_HUD && <DebugHud ref={hudRef} showControls={showControls} />}
    </YStack>
  );
}
