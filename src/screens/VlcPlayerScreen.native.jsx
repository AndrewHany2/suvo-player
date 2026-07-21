import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { StatusBar, Platform, TouchableOpacity, AppState, Modal, View, PanResponder } from "react-native";
import { VLCPlayer } from "react-native-vlc-media-player";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as ScreenOrientation from "expo-screen-orientation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { YStack, XStack, Text, ScrollView, Spinner } from "../ui/primitives";
import { colors, accentAlpha, fonts } from "../ui/tokens";
import Icon from "../ui/Icon";
import Button from "../ui/Button";
import StatePanel from "../ui/StatePanel";
import { usePlayback, useWatchHistory } from "../context/AppContext";
import { contentService } from "../domain/services/ContentService";
import { reportFatalPlayback } from "../services/observability";
import { createVlcDriver } from "../playback/drivers/vlcDriver";
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

  // Volume: VLC's `volume` prop scale is engine-dependent, so we only send it
  // AFTER the user gestures (never touching the default full-volume playback).
  const [volume, setVolume] = useState(100); // 0..100 while adjusting
  const [volumeAdjusted, setVolumeAdjusted] = useState(false);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  // Transient gesture indicator ("Vol 60%", "+10s", "2x", …).
  const [gestureHint, setGestureHint] = useState(null);
  const gestureHintTimerRef = useRef(null);

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

  // Refs mirroring latest progress for lifecycle writes + gesture math.
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 4000);
  }, []);
  useEffect(() => {
    resetControlsTimer();
    return () => clearTimeout(controlsTimerRef.current);
  }, [resetControlsTimer]);

  // Transient gesture indicator helper.
  const flashHint = useCallback((kind, label) => {
    setGestureHint({ kind, label });
    clearTimeout(gestureHintTimerRef.current);
    gestureHintTimerRef.current = setTimeout(() => setGestureHint(null), 700);
  }, []);
  useEffect(() => () => clearTimeout(gestureHintTimerRef.current), []);

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
      <YStack flex={1} backgroundColor="#000" alignItems="center" justifyContent="center" padding={24} gap={16}>
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
  const brightnessAvailable = !!brightnessRef.current;

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
              setProgress({
                position: typeof e?.position === "number" ? e.position : 0,
                currentTimeSec: (e?.currentTime || 0) / 1000,
                durationSec: (e?.duration || 0) / 1000,
              });
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

      {/* Transient gesture indicator */}
      {gestureHint && (
        <YStack position="absolute" top="45%" left={0} right={0} alignItems="center" pointerEvents="none" zIndex={50}>
          <Text color={colors.text} fontSize={20} fontWeight="700" backgroundColor="rgba(0,0,0,0.6)" paddingHorizontal={18} paddingVertical={10} borderRadius={10}>
            {gestureHint.label}
          </Text>
        </YStack>
      )}

      <ResumePrompt
        visible={needsResumeChoice}
        resumeTime={resume.resumeTime}
        percent={resume.percent}
        onResume={handleResume}
        onStartOver={handleStartOver}
      />

      {(isLoading || isRecovering) && !isFatal && !needsResumeChoice && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center" gap={16} backgroundColor="rgba(0,0,0,0.35)" pointerEvents="none" zIndex={35}>
          <Spinner size="large" color={colors.accent} />
          <Text color={colors.text} fontFamily={fonts.body} fontSize={16} fontWeight="600">
            {isRecovering ? "Reconnecting…" : "Loading…"}
          </Text>
        </YStack>
      )}

      {isFatal && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} backgroundColor="rgba(0,0,0,0.85)" zIndex={40}>
          <StatePanel
            mode="error"
            title="Failed to load stream"
            message={
              playback.fatalReason === "GONE"
                ? "This stream is no longer available."
                : "The stream could not be played."
            }
            onRetry={() => playback.retry()}
          />
          <XStack justifyContent="center" paddingBottom={32}>
            <Button variant="secondary" size="md" icon="close" onPress={handleClose}>Close</Button>
          </XStack>
        </YStack>
      )}

      {showControls && (
        <YStack position="absolute" top={0} left={0} right={0} paddingTop={insets.top + topPadding} pointerEvents="box-none" zIndex={30}>
          <XStack alignItems="center" paddingHorizontal={12} paddingVertical={8} backgroundColor="rgba(0,0,0,0.7)" gap={8} flexWrap="wrap">
            <YStack width={44} height={44} backgroundColor={accentAlpha(0.9)} borderRadius={22} justifyContent="center" alignItems="center" cursor="pointer" onPress={handleClose} pressStyle={{ opacity: 0.8 }} accessibilityRole="button" accessibilityLabel="Close player">
              <Icon name="close" size={16} color={colors.text} />
            </YStack>
            <Text color={colors.text} fontFamily={fonts.display} fontSize={14} fontWeight="600" flex={1} minWidth={60} numberOfLines={1}>{currentVideo.name}</Text>
            {nextEpisode && <Button variant="primary" size="sm" icon="play" onPress={handleNextEpisode} accessibilityLabel="Next episode">Next</Button>}
          </XStack>
        </YStack>
      )}

      {showControls && (
        <YStack position="absolute" bottom={0} left={0} right={0} paddingBottom={insets.bottom + 12} backgroundColor="rgba(0,0,0,0.7)" zIndex={30}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Button variant="secondary" size="sm" icon={paused ? "play" : "pause"} onPress={() => setPaused((p) => !p)} accessibilityLabel={paused ? "Play" : "Pause"} />
            <Button variant="secondary" size="sm" icon="speed" onPress={() => { setShowSpeedMenu(true); setShowAudioMenu(false); setShowTextMenu(false); setShowSleepMenu(false); }} accessibilityLabel="Playback speed">{`${speed}x`}</Button>
            {audioTracks.length > 1 && (
              <Button variant="secondary" size="sm" icon="audio" onPress={() => { setShowAudioMenu(true); setShowTextMenu(false); setShowSpeedMenu(false); setShowSleepMenu(false); }} accessibilityLabel="Audio track" />
            )}
            {textTracks.length > 0 && (
              <Button variant="secondary" size="sm" icon="cc" onPress={() => { setShowTextMenu(true); setShowAudioMenu(false); setShowSpeedMenu(false); setShowSleepMenu(false); }} accessibilityLabel="Subtitles" />
            )}
            <Button variant="secondary" size="sm" icon="aspect" onPress={cycleResizeMode} accessibilityLabel="Aspect ratio" />
            <Button variant={isFullscreen ? "primary" : "secondary"} size="sm" icon="fullscreen" onPress={toggleFullscreen} accessibilityLabel="Toggle fullscreen" />
            <Button variant={sleep.active ? "primary" : "secondary"} size="sm" icon="timer" onPress={() => { setShowSleepMenu(true); setShowSpeedMenu(false); setShowAudioMenu(false); setShowTextMenu(false); }} accessibilityLabel="Sleep timer">{sleep.active ? formatRemaining(sleep.secondsLeft) : undefined}</Button>
          </ScrollView>

          {progress.durationSec > 0 && (
            <YStack paddingHorizontal={16} paddingTop={4}>
              <View
                style={{ height: 26, justifyContent: "center" }}
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
                <View style={{ height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" }} />
                <View style={{ position: "absolute", left: 0, height: 4, borderRadius: 2, width: `${playedPct}%`, backgroundColor: colors.accent }} />
                <View style={{ position: "absolute", left: `${playedPct}%`, width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: colors.accent }} />
              </View>
              <XStack justifyContent="space-between" marginTop={4}>
                <Text color={colors.text} fontSize={12} fontWeight="600">{formatTime(shownFrac * progress.durationSec)}</Text>
                <Text color={colors.muted} fontSize={12}>{formatTime(progress.durationSec)}</Text>
              </XStack>
            </YStack>
          )}
        </YStack>
      )}

      {/* Speed menu */}
      <Modal visible={showSpeedMenu} transparent animationType={reducedMotion ? "none" : "fade"} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowSpeedMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" }} activeOpacity={1} onPress={() => setShowSpeedMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={220} maxHeight={350} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.muted} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Playback Speed</Text>
            <ScrollView>
              {SPEEDS.map((rate) => (
                <YStack key={rate} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={speed === rate ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleSpeedChange(rate)} pressStyle={{ opacity: 0.7 }}>
                  <Text color={speed === rate ? colors.accent : colors.muted} fontSize={15} fontWeight={speed === rate ? "700" : "400"}>{rate}x{rate === 1 ? " (Normal)" : ""}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* Audio menu */}
      <Modal visible={showAudioMenu} transparent animationType={reducedMotion ? "none" : "fade"} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowAudioMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" }} activeOpacity={1} onPress={() => setShowAudioMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={240} maxHeight={360} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.muted} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Audio Track</Text>
            <ScrollView>
              {audioTracks.map((track) => (
                <YStack key={track.id} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedAudio === track.id ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleAudioChange(track)} pressStyle={{ opacity: 0.7 }}>
                  <Text color={selectedAudio === track.id ? colors.accent : colors.muted} fontSize={15}>{track.name || `Track ${track.id}`}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* Subtitle menu */}
      <Modal visible={showTextMenu} transparent animationType={reducedMotion ? "none" : "fade"} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowTextMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" }} activeOpacity={1} onPress={() => setShowTextMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={240} maxHeight={360} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.muted} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Subtitles</Text>
            <ScrollView>
              <YStack paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedText === -1 ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleTextChange(-1)} pressStyle={{ opacity: 0.7 }}>
                <Text color={selectedText === -1 ? colors.accent : colors.muted} fontSize={15}>Off</Text>
              </YStack>
              {textTracks.map((track) => (
                <YStack key={track.id} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedText === track.id ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleTextChange(track.id)} pressStyle={{ opacity: 0.7 }}>
                  <Text color={selectedText === track.id ? colors.accent : colors.muted} fontSize={15}>{track.name || `Track ${track.id}`}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* Sleep-timer menu */}
      <Modal visible={showSleepMenu} transparent animationType={reducedMotion ? "none" : "fade"} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowSleepMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" }} activeOpacity={1} onPress={() => setShowSleepMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={240} maxHeight={400} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.muted} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Sleep Timer</Text>
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
                >
                  <Text color={colors.muted} fontSize={15}>{preset.label}</Text>
                </YStack>
              ))}
              {sleep.active && (
                <YStack paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={accentAlpha(0.2)} cursor="pointer" onPress={() => { sleep.cancel(); setShowSleepMenu(false); }} pressStyle={{ opacity: 0.7 }}>
                  <Text color={colors.accent} fontSize={15} fontWeight="700">Cancel timer ({formatRemaining(sleep.secondsLeft)})</Text>
                </YStack>
              )}
            </ScrollView>
            {!brightnessAvailable && (
              <Text color={colors.faint} fontSize={10} textAlign="center" paddingTop={6}>
                Brightness gesture unavailable (expo-brightness not installed)
              </Text>
            )}
          </YStack>
        </TouchableOpacity>
      </Modal>
    </YStack>
  );
}
