import { useEffect, useRef, useCallback, useState, useMemo, memo, forwardRef, useImperativeHandle } from "react";
import { StatusBar, Platform, TouchableOpacity, AppState, Modal, View, PanResponder } from "react-native";
import { VLCPlayer } from "react-native-vlc-media-player";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as ScreenOrientation from "expo-screen-orientation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { YStack, XStack, Text, ScrollView, Spinner } from "../ui/primitives";
import { colors, accentAlpha, fonts, overlay, playerScrim, seekTrack } from "../ui/tokens";
import Icon from "../ui/Icon";
import Button from "../ui/Button";
import StatePanel from "../ui/StatePanel";
import { usePlayback, useWatchHistory } from "../context/AppContext";
import storage from "../utils/storage";
import { contentService } from "../domain/services/ContentService";
import { reportFatalPlayback } from "../services/observability";
import { createVlcDriver } from "../playback/drivers/vlcDriver";
import { FATAL_TITLE, FATAL_HEADLINE, fatalDetail } from "../playback/playerCopy";
import { controlIcon, controlLabel, fitLabel } from "../playback/playerControls";
import { findNextEpisode, buildNextEpisodeVideo } from "../playback/episodeNav";
import { useResilientPlayback } from "../playback/useResilientPlayback";
import { useResumePosition } from "../playback/useResumePosition";
import { usePlayerPreferences } from "../playback/usePlayerPreferences";
import { useSleepTimer, SLEEP_PRESETS, formatRemaining } from "../playback/useSleepTimer";
import { useDeviceIntegrity } from "../security/useDeviceIntegrity";
import ResumePrompt from "../playback/components/ResumePrompt";
import { formatDuration as formatTime } from "../utils/formatDuration";
import { useReducedMotion } from "../hooks/useReducedMotion";

const MODAL_ORIENTATIONS = ["portrait", "landscape"];
// VLCPlayer resizeMode values; cycled by the aspect button.
const RESIZE_MODES = ["contain", "cover", "fill"];
// Shared with the expo screen so the one-time gesture legend shows once across
// either native engine (both implement the identical gesture set).
const GESTURE_HINT_KEY = "player_gesture_hint_seen";
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

// Gesture tuning (mirrors the expo player).
const VERT_SWIPE_RANGE_PX = 220; // vertical px that maps to the full 0..1 range
const SEEK_PX_PER_SEC = 6; // horizontal px per second of seek
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_SEEK = 10;
const LONG_PRESS_MS = 450;

/**
 * expo-brightness is not a declared dependency. Resolve it lazily so a build
 * without it simply disables the left-half brightness gesture instead of
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
 * Transient gesture indicator ("Vol 60%", "+10s", "2x", …). A memoized leaf that
 * owns its own state and exposes an imperative show(kind, label) via ref, so a
 * ~60 Hz PanResponder move updates only this node instead of re-rendering the
 * whole ~800-line player. Auto-hides after 700ms.
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

export default function VlcPlayerScreen({ navigation }) {
  const { currentVideo, closeVideo, playVideo } = usePlayback();
  const { updateWatchProgress, addToWatchHistory, flushProgress } = useWatchHistory();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const progressIntervalRef = useRef(null);
  const hasAddedToHistory = useRef(false);
  const controlsTimerRef = useRef(null);

  const [showControls, setShowControls] = useState(true);
  const [resizeMode, setResizeMode] = useState("contain");
  const [audioTracks, setAudioTracks] = useState([]);
  const [textTracks, setTextTracks] = useState([]);
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [selectedText, setSelectedText] = useState(-1); // -1 = subtitles off
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showTextMenu, setShowTextMenu] = useState(false);

  // Playback speed (VLC `rate`), fullscreen (screen rotation), and a long-press
  // 2× "boost" that temporarily overrides rate.
  const [speed, setSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [boost, setBoost] = useState(false);
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  // One-time gesture legend (shared flag with the expo engine).
  const [showGestureHint, setShowGestureHint] = useState(false);

  // Volume: VLC's `volume` prop scale is engine-dependent, so we only send it
  // AFTER the user gestures (never touching the default full-volume playback).
  const [volume, setVolume] = useState(100); // 0..100 while adjusting
  const [volumeAdjusted, setVolumeAdjusted] = useState(false);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  // Transient gesture indicator ("Vol 60%", "+10s", "2x", …). Rendered by the
  // memoized <GestureHint> leaf below; driven imperatively via this ref so a
  // 60 Hz gesture move touches only that node, not the whole player.
  const hintRef = useRef(null);

  // VOD seek bar: fraction (0..1) + seconds, from onProgress.
  const [progress, setProgress] = useState({ position: 0, currentTimeSec: 0, durationSec: 0 });
  const [scrubFrac, setScrubFrac] = useState(null);
  const seekTrackWidth = useRef(0);

  const streamKey = currentVideo ? `${currentVideo.type}_${currentVideo.streamId}` : null;
  const { prefs, loaded: prefsLoaded, setPref } = usePlayerPreferences(streamKey);
  const prefsAppliedRef = useRef(false);

  const resume = useResumePosition(currentVideo);
  const needsResumeChoice = resume.hasResume && !resume.decided;
  const [resolvedStart, setResolvedStart] = useState(0);

  // ── VLC host state driven by the driver via `handle` ──
  const vlcRef = useRef(null);
  const [vlcSource, setVlcSource] = useState(null);
  const [paused, setPaused] = useState(false);

  const handle = useMemo(
    () => ({
      setSource: (s) => setVlcSource(s),
      setPaused: (p) => setPaused(p),
      seek: (frac) => {
        try {
          vlcRef.current?.seek?.(frac);
        } catch {
          /* noop */
        }
      },
    }),
    [],
  );
  const { driver, ingest } = useMemo(() => createVlcDriver(handle), [handle]);

  const playback = useResilientPlayback({
    driver,
    source: currentVideo && !needsResumeChoice ? { uri: currentVideo.url } : null,
    isLive: false,
    startTime: resolvedStart || currentVideo?.startTime || 0,
    refreshCredentials: () => {},
    onFatal: (reason) =>
      reportFatalPlayback({ reason, isLive: false, streamId: currentVideo?.streamId, engine: "vlc" }),
  });

  const isLoading = playback.status === "idle" || playback.status === "loading";
  const isRecovering = playback.isRecovering;
  const isFatal = playback.isFatal;

  // Latest progress lives in a ref, updated on EVERY onProgress tick, so
  // lifecycle writes + gesture math always read a fresh value without
  // re-rendering the player. The `progress` STATE (above) drives only the seek
  // bar and is updated solely while the controls are on screen — otherwise
  // VLC's ~4 Hz progress event would re-render the whole screen while the
  // viewer is just watching with the chrome hidden. Primed on reveal below.
  const progressRef = useRef({ position: 0, currentTimeSec: 0, durationSec: 0 });

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 4000);
  }, []);
  useEffect(() => {
    resetControlsTimer();
    return () => clearTimeout(controlsTimerRef.current);
  }, [resetControlsTimer]);

  // Prime the seek bar with the live position the instant controls re-appear —
  // the onProgress → setProgress path only runs while controls are shown, so
  // without this the bar would show the last frozen value until the next tick.
  useEffect(() => {
    if (showControls) setProgress(progressRef.current);
  }, [showControls]);

  // Transient gesture indicator helper — routes to the memoized leaf so a move
  // frame doesn't re-render the player. The leaf owns the 700ms auto-hide.
  const flashHint = useCallback((kind, label) => {
    hintRef.current?.show(kind, label);
  }, []);

  // Show the one-time gesture legend on first playback (persisted; shared flag
  // with the expo engine so it appears once across either native player).
  useEffect(() => {
    let cancelled = false;
    storage.getItem(GESTURE_HINT_KEY).then((seen) => {
      if (!cancelled && !seen) setShowGestureHint(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const dismissGestureHint = useCallback(() => {
    setShowGestureHint(false);
    storage.setItem(GESTURE_HINT_KEY, "1").catch(() => {});
  }, []);

  // Keep awake while playing (mirrors the expo screen). We deliberately do NOT
  // force a PORTRAIT_UP lock on mount/unmount — that pinned the whole app to
  // portrait after playback. Orientation is only changed by the fullscreen
  // toggle, which restores portrait itself when the user exits fullscreen.
  useEffect(() => {
    activateKeepAwakeAsync().catch(() => {});
    return () => {
      try {
        deactivateKeepAwake();
      } catch {
        /* noop */
      }
    };
  }, []);

  // Reset per-stream state when the URL changes.
  useEffect(() => {
    hasAddedToHistory.current = false;
    prefsAppliedRef.current = false;
    setAudioTracks([]);
    setTextTracks([]);
    setSelectedAudio(null);
    setSelectedText(-1);
    setResolvedStart(0);
    setSpeed(1);
    setBoost(false);
    progressRef.current = { position: 0, currentTimeSec: 0, durationSec: 0 };
    setProgress({ position: 0, currentTimeSec: 0, durationSec: 0 });
  }, [currentVideo?.url]);

  // Apply remembered aspect + speed once prefs load.
  useEffect(() => {
    if (!prefsLoaded || prefsAppliedRef.current) return;
    if (prefs.aspectRatio && RESIZE_MODES.includes(prefs.aspectRatio)) setResizeMode(prefs.aspectRatio);
    if (typeof prefs.playbackSpeed === "number" && SPEEDS.includes(prefs.playbackSpeed)) setSpeed(prefs.playbackSpeed);
    prefsAppliedRef.current = true;
  }, [prefsLoaded, prefs.aspectRatio, prefs.playbackSpeed]);

  // Add to history once per stream (VOD).
  useEffect(() => {
    if (!currentVideo || hasAddedToHistory.current) return;
    if (currentVideo.type !== "live") {
      hasAddedToHistory.current = true;
      addToWatchHistory({ ...currentVideo, currentTime: currentVideo.startTime || 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideo?.url]);

  // Periodic progress recording (every 10s) — mirrors the expo path cadence.
  useEffect(() => {
    if (!currentVideo || currentVideo.type === "live") return undefined;
    clearInterval(progressIntervalRef.current);
    progressIntervalRef.current = setInterval(() => {
      const p = progressRef.current;
      if (p.durationSec > 0) {
        updateWatchProgress(currentVideo.streamId, currentVideo.type, p.currentTimeSec, p.durationSec);
      }
    }, 10000);
    return () => clearInterval(progressIntervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideo?.url, updateWatchProgress]);

  // Flush progress + pause on background.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "background" && state !== "inactive") return;
      const p = progressRef.current;
      if (currentVideo && currentVideo.type !== "live" && p.durationSec > 0) {
        updateWatchProgress(currentVideo.streamId, currentVideo.type, p.currentTimeSec, p.durationSec);
      }
      flushProgress();
      if (state === "background") setPaused(true);
    });
    return () => sub.remove();
  }, [currentVideo, updateWatchProgress, flushProgress]);

  // Next-episode helpers.
  const getNextEpisode = useCallback(() => findNextEpisode(currentVideo), [currentVideo]);
  const handleNextEpisode = useCallback(() => {
    const video = buildNextEpisodeVideo(getNextEpisode(), currentVideo, (id, ext) =>
      contentService.buildEpisodeUrl(id, ext),
    );
    if (video) playVideo(video);
  }, [getNextEpisode, currentVideo, playVideo]);

  const handleEnded = useCallback(() => {
    if (currentVideo?.type === "series" && getNextEpisode()) handleNextEpisode();
  }, [currentVideo, getNextEpisode, handleNextEpisode]);

  const handleClose = useCallback(() => {
    const p = progressRef.current;
    if (currentVideo && currentVideo.type !== "live" && p.durationSec > 0) {
      updateWatchProgress(currentVideo.streamId, currentVideo.type, p.currentTimeSec, p.durationSec);
    }
    flushProgress();
    clearInterval(progressIntervalRef.current);
    setPaused(true);
    closeVideo();
    navigation.goBack();
  }, [currentVideo, updateWatchProgress, flushProgress, closeVideo, navigation]);

  // Sleep timer: pause + close on elapse.
  const sleep = useSleepTimer(
    useCallback(() => {
      setPaused(true);
      handleClose();
    }, [handleClose]),
  );

  // Resume choice.
  const handleResume = useCallback(() => {
    setResolvedStart(resume.decide("resume"));
  }, [resume]);
  const handleStartOver = useCallback(() => {
    resume.decide("startOver");
    setResolvedStart(0);
  }, [resume]);

  // Play/pause routed through the driver (NOT setPaused directly) so the recovery
  // machine's play-intent stays consistent — a manual pause won't be undone by a
  // reconnect reload. Mirrors the expo screen's togglePlayPause.
  const togglePlayPause = useCallback(() => {
    if (!driver) return;
    if (paused) driver.play();
    else driver.pause();
    resetControlsTimer();
  }, [driver, paused, resetControlsTimer]);

  const cycleResizeMode = useCallback(() => {
    setResizeMode((cur) => {
      const next = RESIZE_MODES[(RESIZE_MODES.indexOf(cur) + 1) % RESIZE_MODES.length];
      setPref("aspectRatio", next);
      return next;
    });
  }, [setPref]);

  const handleSpeedChange = useCallback((rate) => {
    setSpeed(rate);
    setPref("playbackSpeed", rate);
    setShowSpeedMenu(false);
  }, [setPref]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((fs) => {
      const next = !fs;
      ScreenOrientation.lockAsync(
        next ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => {});
      return next;
    });
  }, []);

  const handleAudioChange = (track) => {
    setSelectedAudio(track ? track.id : null);
    setShowAudioMenu(false);
  };
  const handleTextChange = (id) => {
    setSelectedText(id);
    setShowTextMenu(false);
  };

  // Seek helper used by gestures: jump to an absolute second (clamped).
  const seekToSeconds = useCallback((sec) => {
    const dur = progressRef.current.durationSec;
    if (!(dur > 0)) return;
    const clamped = Math.max(0, Math.min(dur, sec));
    try {
      vlcRef.current?.seek?.(clamped / dur);
    } catch {
      /* noop */
    }
  }, []);

  // Seek-bar scrub (fraction of duration).
  const scrubToX = useCallback((x) => {
    const w = seekTrackWidth.current;
    if (!w) return;
    setScrubFrac(Math.max(0, Math.min(1, x / w)));
    resetControlsTimer();
  }, [resetControlsTimer]);
  const commitScrub = useCallback(() => {
    setScrubFrac((frac) => {
      if (frac != null) {
        try {
          vlcRef.current?.seek?.(frac);
        } catch {
          /* noop */
        }
      }
      return null;
    });
    resetControlsTimer();
  }, [resetControlsTimer]);

  // Screen-reader seek: ±10s via the same clamped seek helper the gestures use.
  const handleSeekAccessibilityAction = useCallback((e) => {
    const name = e?.nativeEvent?.actionName;
    const cur = progressRef.current.currentTimeSec || 0;
    if (name === "increment") seekToSeconds(cur + DOUBLE_TAP_SEEK);
    else if (name === "decrement") seekToSeconds(cur - DOUBLE_TAP_SEEK);
  }, [seekToSeconds]);

  // ── Touch gestures (PanResponder) — volume (right half) / brightness (left
  //    half) / horizontal drag-to-seek / double-tap ±10s / long-press 2× ──
  const brightnessRef = useRef(null); // lazy expo-brightness module or false
  if (brightnessRef.current === null) brightnessRef.current = loadBrightness() || false;
  const gestureState = useRef({
    mode: null, startX: 0, startY: 0, startVol: 100, startBright: null,
    startTime: 0, lastTapTime: 0, lastTapX: 0, longPressTimer: null, longPressed: false, layoutW: 0,
  });

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
    onPanResponderGrant: (e) => {
      const gs = gestureState.current;
      gs.mode = null;
      gs.startX = e.nativeEvent.pageX;
      gs.startY = e.nativeEvent.pageY;
      gs.longPressed = false;
      gs.startVol = volumeRef.current;
      gs.startTime = progressRef.current.currentTimeSec || 0;
      gs.startBright = null;
      clearTimeout(gs.longPressTimer);
      gs.longPressTimer = setTimeout(() => {
        gs.longPressed = true;
        setBoost(true);
        flashHint("speed", "2x");
      }, LONG_PRESS_MS);
    },
    onPanResponderMove: (e, g) => {
      const gs = gestureState.current;
      if (gs.longPressed) return;
      if (!gs.mode) {
        if (Math.abs(g.dx) < 8 && Math.abs(g.dy) < 8) return;
        clearTimeout(gs.longPressTimer);
        if (Math.abs(g.dx) > Math.abs(g.dy)) {
          gs.mode = "seek";
        } else {
          const w = gs.layoutW || 1;
          gs.mode = gs.startX > w / 2 ? "volume" : "brightness";
          if (gs.mode === "brightness" && brightnessRef.current) {
            try {
              brightnessRef.current.getBrightnessAsync().then((b) => { gs.startBright = b; }).catch(() => {});
            } catch {
              /* noop */
            }
          }
        }
      }
      if (gs.mode === "seek") {
        const deltaSec = g.dx / SEEK_PX_PER_SEC;
        const sign = deltaSec >= 0 ? "+" : "-";
        flashHint("seek", `${sign}${Math.abs(Math.round(deltaSec))}s`);
      } else if (gs.mode === "volume") {
        const next = Math.min(100, Math.max(0, gs.startVol - (g.dy / VERT_SWIPE_RANGE_PX) * 100));
        setVolume(next);
        setVolumeAdjusted(true);
        flashHint("volume", `Vol ${Math.round(next)}%`);
      } else if (gs.mode === "brightness") {
        const mod = brightnessRef.current;
        if (mod && gs.startBright != null) {
          const next = Math.min(1, Math.max(0, gs.startBright - g.dy / VERT_SWIPE_RANGE_PX));
          try { mod.setBrightnessAsync(next).catch(() => {}); } catch { /* noop */ }
          flashHint("brightness", `Bright ${Math.round(next * 100)}%`);
        }
      }
    },
    onPanResponderRelease: (e, g) => {
      const gs = gestureState.current;
      clearTimeout(gs.longPressTimer);
      if (gs.longPressed) {
        setBoost(false); // rate reverts to `speed`
        gs.longPressed = false;
        gs.mode = null;
        return;
      }
      if (gs.mode === "seek") {
        const deltaSec = g.dx / SEEK_PX_PER_SEC;
        seekToSeconds(gs.startTime + deltaSec);
        gs.mode = null;
        return;
      }
      if (!gs.mode) {
        // A tap. Double-tap left/right = ∓/±10s; single tap toggles controls.
        const now = Date.now();
        const x = e.nativeEvent.pageX;
        const w = gs.layoutW || 1;
        if (now - gs.lastTapTime < DOUBLE_TAP_MS && Math.abs(x - gs.lastTapX) < w / 2) {
          const right = x > w / 2;
          seekToSeconds((progressRef.current.currentTimeSec || 0) + (right ? DOUBLE_TAP_SEEK : -DOUBLE_TAP_SEEK));
          flashHint("seek", right ? `+${DOUBLE_TAP_SEEK}s` : `-${DOUBLE_TAP_SEEK}s`);
          gs.lastTapTime = 0;
        } else {
          gs.lastTapTime = now;
          gs.lastTapX = x;
          resetControlsTimer();
        }
      }
      gs.mode = null;
    },
    onPanResponderTerminate: () => {
      const gs = gestureState.current;
      clearTimeout(gs.longPressTimer);
      if (gs.longPressed) setBoost(false);
      gs.longPressed = false;
      gs.mode = null;
    },
  }), [flashHint, resetControlsTimer, seekToSeconds]);

  // Pop when the video is cleared externally (profile switch / sign-out). handleClose
  // already pops explicitly; guard on canGoBack() so we never double-pop.
  useEffect(() => {
    if (!currentVideo && navigation.canGoBack?.()) navigation.goBack();
  }, [currentVideo, navigation]);

  const deviceCompromised = useDeviceIntegrity();

  if (!currentVideo) return null;

  if (deviceCompromised) {
    return (
      <YStack flex={1} backgroundColor={colors.bg} alignItems="center" justifyContent="center" padding={24} gap={16}>
        <Icon name="warning" size={40} color={colors.danger} />
        <Text color={colors.danger} fontSize={20} fontWeight="700" textAlign="center">Playback blocked</Text>
        <Text color={colors.muted} fontSize={14} textAlign="center">
          This device appears to be jailbroken or rooted. Streaming is disabled for security.
        </Text>
        <Button variant="primary" size="lg" onPress={closeVideo}>Go back</Button>
      </YStack>
    );
  }

  const nextEpisode = getNextEpisode();
  const topPadding = Platform.OS === "ios" ? 12 : 8;
  const shownFrac = scrubFrac != null ? scrubFrac : progress.position;
  const playedPct = Math.max(0, Math.min(100, shownFrac * 100));

  return (
    <YStack flex={1} backgroundColor="#000">
      <StatusBar hidden />

      <View style={{ position: "absolute", top: insets.top, left: 0, right: 0, bottom: insets.bottom }}>
        {vlcSource && (
          <VLCPlayer
            ref={vlcRef}
            style={{ flex: 1 }}
            // Pass a FRESH copy every render: <VLCPlayer> mutates the source
            // object in place (sets source.isNetwork/autoplay/initOptions in its
            // render) and also hands the same object to the native view, which RN
            // deep-freezes on commit in dev. Reusing our stored state object would
            // then throw "set key `isNetwork` on a frozen object" on the next
            // render. A throwaway object (with its own initOptions array) lets the
            // library mutate freely; the native side diffs by uri, so this adds no
            // reload.
            source={{ uri: vlcSource.uri, initOptions: [...(vlcSource.initOptions || [])] }}
            paused={paused}
            rate={boost ? 2 : speed}
            resizeMode={resizeMode}
            audioTrack={selectedAudio ?? undefined}
            textTrack={selectedText}
            volume={volumeAdjusted ? volume : undefined}
            onProgress={(e) => {
              ingest.progress(e);
              const next = {
                position: typeof e?.position === "number" ? e.position : 0,
                currentTimeSec: (e?.currentTime || 0) / 1000,
                durationSec: (e?.duration || 0) / 1000,
              };
              // Always refresh the ref (lifecycle/gestures read it); only touch
              // state — the seek bar — while the controls are actually visible.
              progressRef.current = next;
              if (showControls) setProgress(next);
            }}
            onPlaying={(e) => ingest.playing(e)}
            onPaused={() => ingest.paused()}
            onStopped={() => ingest.stopped()}
            onError={(e) => ingest.error(e)}
            onEnded={handleEnded}
            onEnd={handleEnded}
            onLoad={(e) => {
              // Best-effort track discovery; absent on some versions (safe no-op).
              if (Array.isArray(e?.audioTracks)) setAudioTracks(e.audioTracks);
              if (Array.isArray(e?.textTracks)) setTextTracks(e.textTracks);
            }}
          />
        )}
      </View>

      {/* Gesture + tap surface (behind the controls, which have higher zIndex). */}
      <View
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        onLayout={(ev) => { gestureState.current.layoutW = ev.nativeEvent.layout.width; }}
        {...panResponder.panHandlers}
      />

      {/* Transient gesture indicator (imperative leaf; see flashHint) */}
      <GestureHint ref={hintRef} />

      <ResumePrompt
        visible={needsResumeChoice}
        resumeTime={resume.resumeTime}
        percent={resume.percent}
        onResume={handleResume}
        onStartOver={handleStartOver}
      />

      {/* Center play/pause transport — a prominent 72px target, matching the expo
          screen so the primary action is identical across native engines (was a
          tiny button buried in the wrapping row). */}
      {showControls && !isLoading && !isRecovering && !isFatal && !needsResumeChoice && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center" pointerEvents="box-none" zIndex={30}>
          <YStack width={72} height={72} backgroundColor={playerScrim.panel} borderRadius={36} justifyContent="center" alignItems="center" cursor="pointer" onPress={togglePlayPause} pressStyle={{ opacity: 0.8 }} accessibilityRole="button" accessibilityLabel={paused ? "Play" : "Pause"}>
            <Icon name={paused ? "play" : "pause"} size={34} color={colors.text} />
          </YStack>
        </YStack>
      )}

      {(isLoading || isRecovering) && !isFatal && !needsResumeChoice && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center" gap={16} backgroundColor={playerScrim.busy} pointerEvents="none" zIndex={35}>
          <Spinner size="large" color={colors.accent2} />
          <Text color={colors.text} fontFamily={fonts.body} fontSize={16} fontWeight="600">
            {isRecovering ? "Reconnecting…" : "Loading…"}
          </Text>
        </YStack>
      )}

      {isFatal && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} backgroundColor={playerScrim.fatal} zIndex={40}>
          <StatePanel
            mode="error"
            title={FATAL_TITLE}
            message={FATAL_HEADLINE}
            onRetry={() => playback.retry()}
          />
          {/* Raw reason as quiet secondary detail — matches web/expo tone. */}
          <Text color={colors.textDim} fontFamily={fonts.body} fontSize={12} textAlign="center" paddingHorizontal={24}>
            {fatalDetail(playback.fatalReason)}
          </Text>
          <XStack justifyContent="center" paddingTop={16} paddingBottom={32}>
            <Button variant="secondary" size="md" icon="close" onPress={handleClose}>Close</Button>
          </XStack>
        </YStack>
      )}

      {showControls && (
        <YStack position="absolute" top={0} left={0} right={0} paddingTop={insets.top + topPadding} paddingLeft={insets.left} paddingRight={insets.right} pointerEvents="box-none" zIndex={30}>
          <XStack alignItems="center" paddingHorizontal={12} paddingVertical={8} backgroundColor={playerScrim.bar} gap={8} flexWrap="wrap">
            <YStack width={44} height={44} backgroundColor={overlay} borderWidth={1} borderColor={colors.border} borderRadius={22} justifyContent="center" alignItems="center" cursor="pointer" onPress={handleClose} pressStyle={{ opacity: 0.8 }} accessibilityRole="button" accessibilityLabel={controlLabel.close}>
              <Icon name={controlIcon.close} size={16} color={colors.text} />
            </YStack>
            <Text color={colors.text} fontFamily={fonts.display} fontSize={14} fontWeight="600" flex={1} minWidth={60} numberOfLines={1}>{currentVideo.name}</Text>
            {nextEpisode && <Button variant="primary" size="sm" icon={controlIcon.nextEpisode} onPress={handleNextEpisode} accessibilityLabel={controlLabel.nextEpisode}>Next</Button>}
          </XStack>
        </YStack>
      )}

      {showControls && (
        <YStack position="absolute" bottom={0} left={0} right={0} paddingBottom={insets.bottom + 12} paddingLeft={insets.left} paddingRight={insets.right} backgroundColor={playerScrim.bar} zIndex={30}>
          {/* Ruthlessly small primary row — identical to every other Suvo player:
              Subtitles, Fullscreen, More. Speed, audio, fit-to-screen and the
              sleep timer all live behind the single "More" sheet below, so a
              non-technical viewer sees the same three obvious controls here as on
              phone-expo, TV, and desktop. Subtitles only shows when the stream has
              any; More takes the indigo fill while the sleep timer is running. */}
          <XStack flexWrap="wrap" justifyContent="center" alignItems="center" gap={8} paddingHorizontal={12} paddingVertical={8}>
            {textTracks.length > 0 && (
              <Button variant="secondary" size="sm" icon={controlIcon.subtitles} onPress={() => { setShowTextMenu(true); setShowAudioMenu(false); setShowSpeedMenu(false); setShowSleepMenu(false); }} accessibilityLabel={controlLabel.subtitles} />
            )}
            <Button variant={isFullscreen ? "primary" : "secondary"} size="sm" icon={controlIcon.fullscreen} onPress={toggleFullscreen} accessibilityLabel={isFullscreen ? controlLabel.exitFullscreen : controlLabel.fullscreen} />
            <Button variant={sleep.active ? "primary" : "secondary"} size="sm" icon={controlIcon.more} onPress={() => setShowMoreMenu(true)} accessibilityLabel={controlLabel.more}>{sleep.active ? formatRemaining(sleep.secondsLeft) : controlLabel.more}</Button>
          </XStack>

          {progress.durationSec > 0 && (
            <YStack paddingHorizontal={16} paddingTop={4}>
              <View
                style={{ height: 44, justifyContent: "center" }}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel="Seek bar"
                accessibilityValue={{
                  min: 0,
                  max: Math.round(progress.durationSec),
                  now: Math.round(shownFrac * progress.durationSec),
                  text: `${formatTime(shownFrac * progress.durationSec)} of ${formatTime(progress.durationSec)}`,
                }}
                accessibilityActions={[
                  { name: "increment", label: "Forward 10 seconds" },
                  { name: "decrement", label: "Back 10 seconds" },
                ]}
                onAccessibilityAction={handleSeekAccessibilityAction}
                onLayout={(e) => { seekTrackWidth.current = e.nativeEvent.layout.width; }}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(e) => scrubToX(e.nativeEvent.locationX)}
                onResponderMove={(e) => scrubToX(e.nativeEvent.locationX)}
                onResponderRelease={commitScrub}
                onResponderTerminate={commitScrub}
              >
                {/* No buffered segment (unlike the expo seek bar): the VLC engine
                    exposes no buffered-position value via onProgress / the driver's
                    buffered() returns 0, so there is nothing truthful to shade. */}
                <View style={{ height: 4, borderRadius: 2, backgroundColor: seekTrack.track }} />
                <View style={{ position: "absolute", left: 0, height: 4, borderRadius: 2, width: `${playedPct}%`, backgroundColor: colors.accent }} />
                <View style={{ position: "absolute", left: `${playedPct}%`, width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: colors.accent }} />
              </View>
              <XStack justifyContent="space-between" marginTop={4}>
                <Text color={colors.text} fontSize={12} fontWeight="600">{formatTime(shownFrac * progress.durationSec)}</Text>
                {/* textDim (not muted) so the duration holds AA over bright frames. */}
                <Text color={colors.textDim} fontSize={12}>{formatTime(progress.durationSec)}</Text>
              </XStack>
            </YStack>
          )}
        </YStack>
      )}

      {/* One-time gesture legend — mirrors the expo screen so both native engines
          teach the identical (otherwise invisible) touch gestures once. */}
      {showGestureHint && !isLoading && !isRecovering && !needsResumeChoice && !isFatal && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center" backgroundColor={playerScrim.legend} zIndex={60} padding={24} gap={16}>
          <Text color={colors.text} fontFamily={fonts.display} fontSize={18} fontWeight="700">Gesture controls</Text>
          <YStack gap={8} alignItems="flex-start" maxWidth={320}>
            <Text color={colors.textDim} fontSize={14}>• Drag left / right — seek</Text>
            <Text color={colors.textDim} fontSize={14}>• Double-tap left / right — skip back / forward 10s</Text>
            <Text color={colors.textDim} fontSize={14}>• Press &amp; hold — 2× speed</Text>
            <Text color={colors.textDim} fontSize={14}>• Swipe right side up / down — volume</Text>
            {!!brightnessRef.current && (
              <Text color={colors.textDim} fontSize={14}>• Swipe left side up / down — brightness</Text>
            )}
          </YStack>
          <Button variant="primary" size="md" onPress={dismissGestureHint}>Got it</Button>
        </YStack>
      )}

      {/* Speed menu */}
      <Modal visible={showSpeedMenu} transparent animationType={reducedMotion ? "none" : "fade"} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowSpeedMenu(false)}>
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

      {/* Audio menu */}
      <Modal visible={showAudioMenu} transparent animationType={reducedMotion ? "none" : "fade"} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowAudioMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: playerScrim.hint, justifyContent: "center", alignItems: "center" }} activeOpacity={1} accessible={false} onPress={() => setShowAudioMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={240} maxHeight={360} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.textDim} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Audio Track</Text>
            <ScrollView>
              {audioTracks.map((track) => (
                <YStack key={track.id} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedAudio === track.id ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleAudioChange(track)} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityState={{ selected: selectedAudio === track.id }} accessibilityLabel={`Audio track ${track.name || track.id}`}>
                  <Text color={selectedAudio === track.id ? colors.accent : colors.text} fontSize={15}>{track.name || `Track ${track.id}`}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* Subtitle menu */}
      <Modal visible={showTextMenu} transparent animationType={reducedMotion ? "none" : "fade"} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowTextMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: playerScrim.hint, justifyContent: "center", alignItems: "center" }} activeOpacity={1} accessible={false} onPress={() => setShowTextMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={240} maxHeight={360} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.textDim} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Subtitles</Text>
            <ScrollView>
              <YStack paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedText === -1 ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleTextChange(-1)} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityState={{ selected: selectedText === -1 }} accessibilityLabel="Subtitles off">
                <Text color={selectedText === -1 ? colors.accent : colors.text} fontSize={15}>Off</Text>
              </YStack>
              {textTracks.map((track) => (
                <YStack key={track.id} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedText === track.id ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleTextChange(track.id)} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityState={{ selected: selectedText === track.id }} accessibilityLabel={`Subtitle ${track.name || track.id}`}>
                  <Text color={selectedText === track.id ? colors.accent : colors.text} fontSize={15}>{track.name || `Track ${track.id}`}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* Sleep-timer menu */}
      <Modal visible={showSleepMenu} transparent animationType={reducedMotion ? "none" : "fade"} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowSleepMenu(false)}>
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
                      // No fixed duration: cancel any timer; onEnded already advances/closes.
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

      {/* "More" sheet — the single home for every secondary control, matching the
          expo/web/TV players so the grouping is identical across engines. VLC has
          no PiP / stats / subtitle-tuning, so those rows simply don't appear; the
          rows it does show keep the shared order (speed → audio → fit → sleep). */}
      <Modal visible={showMoreMenu} transparent animationType={reducedMotion ? "none" : "fade"} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowMoreMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: playerScrim.hint, justifyContent: "center", alignItems: "center" }} activeOpacity={1} accessible={false} onPress={() => setShowMoreMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={280} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.textDim} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>{controlLabel.more}</Text>
            <XStack alignItems="center" gap={12} paddingVertical={12} paddingHorizontal={16} borderRadius={8} cursor="pointer" onPress={() => { setShowMoreMenu(false); setShowSpeedMenu(true); }} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityLabel={controlLabel.speed}>
              <Icon name={controlIcon.speed} size={20} color={colors.text} />
              <Text color={colors.text} fontSize={15} flex={1}>{controlLabel.speed}</Text>
              <Text color={colors.textDim} fontSize={13}>{`${speed}x`}</Text>
            </XStack>
            {audioTracks.length > 1 && (
              <XStack alignItems="center" gap={12} paddingVertical={12} paddingHorizontal={16} borderRadius={8} cursor="pointer" onPress={() => { setShowMoreMenu(false); setShowAudioMenu(true); }} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityLabel={controlLabel.audio}>
                <Icon name={controlIcon.audio} size={20} color={colors.text} />
                <Text color={colors.text} fontSize={15} flex={1}>{controlLabel.audio}</Text>
              </XStack>
            )}
            <XStack alignItems="center" gap={12} paddingVertical={12} paddingHorizontal={16} borderRadius={8} cursor="pointer" onPress={cycleResizeMode} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityLabel={controlLabel.fit}>
              <Icon name={controlIcon.fit} size={20} color={colors.text} />
              <Text color={colors.text} fontSize={15} flex={1}>{controlLabel.fit}</Text>
              <Text color={colors.textDim} fontSize={13}>{fitLabel(resizeMode)}</Text>
            </XStack>
            <XStack alignItems="center" gap={12} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={sleep.active ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => { setShowMoreMenu(false); setShowSleepMenu(true); }} pressStyle={{ opacity: 0.7 }} accessibilityRole="button" accessibilityState={{ selected: sleep.active }} accessibilityLabel={controlLabel.sleep}>
              <Icon name={controlIcon.sleep} size={20} color={sleep.active ? colors.accent : colors.text} />
              <Text color={sleep.active ? colors.accent : colors.text} fontSize={15} flex={1}>{controlLabel.sleep}</Text>
              {sleep.active ? <Text color={colors.accent} fontSize={13}>{formatRemaining(sleep.secondsLeft)}</Text> : null}
            </XStack>
          </YStack>
        </TouchableOpacity>
      </Modal>
    </YStack>
  );
}
