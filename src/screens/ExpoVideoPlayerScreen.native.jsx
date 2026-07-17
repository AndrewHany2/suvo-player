import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { Modal, StatusBar, Platform, TouchableOpacity, AppState, PanResponder, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as ScreenOrientation from "expo-screen-orientation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { YStack, XStack, Text, ScrollView, Spinner } from "../ui/primitives";
import { colors, accentAlpha, fonts } from "../ui/tokens";
import Icon from "../ui/Icon";
import Button from "../ui/Button";
import StatePanel from "../ui/StatePanel";
import { useApp, usePlayback, useWatchHistory } from "../context/AppContext";
import iptvApi from "../services/iptvApi";
import { contentService } from "../domain/services/ContentService";
import storage from "../utils/storage";
import { createExpoVideoDriver } from "../playback/drivers/expoVideoDriver";
import { findNextEpisode, buildNextEpisodeVideo } from "../playback/episodeNav";
import { useResilientPlayback } from "../playback/useResilientPlayback";
import { useDeviceIntegrity } from "../security/useDeviceIntegrity";

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

export default function ExpoVideoPlayerScreen({ navigation }) {
  const { channels } = useApp();
  const { currentVideo, closeVideo, playVideo } = usePlayback();
  const { updateWatchProgress, addToWatchHistory, flushProgress } = useWatchHistory();
  const insets = useSafeAreaInsets();
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

  // Phase 2 UI state.
  const [showSubtitleSettings, setShowSubtitleSettings] = useState(false);
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  // VOD seek bar: live-polled position/duration/buffered, and the in-progress
  // scrub preview (null when not dragging). Track width is measured on layout.
  const [progress, setProgress] = useState({ position: 0, duration: 0, buffered: 0 });
  const [scrubSec, setScrubSec] = useState(null);
  const seekTrackWidth = useRef(0);
  const [gestureHint, setGestureHint] = useState(null); // { kind, label }
  const gestureHintTimerRef = useRef(null);
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

  // Transient gesture indicator helper.
  const flashHint = useCallback((kind, label) => {
    setGestureHint({ kind, label });
    clearTimeout(gestureHintTimerRef.current);
    gestureHintTimerRef.current = setTimeout(() => setGestureHint(null), 700);
  }, []);
  useEffect(() => () => clearTimeout(gestureHintTimerRef.current), []);

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
      // Restore portrait on exit. We must NOT unlockAsync() here: the app's
      // default orientation allows all, so unlocking lets the OS immediately
      // rotate the (portrait-designed) browse UI back to landscape whenever the
      // device still reports a landscape sensor reading. Lock to portrait and
      // keep it locked — only the player runs in landscape.
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
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
    fetchNowNext(iptvApi, currentVideo.streamId)
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
    if (!player || isLive) return undefined;
    const id = setInterval(() => {
      if (scrubSec != null) return;
      const duration = Number.isFinite(player.duration) ? player.duration : 0;
      const position = Number.isFinite(player.currentTime) ? player.currentTime : 0;
      const buffered = Number.isFinite(player.bufferedPosition) ? player.bufferedPosition : 0;
      setProgress({ position, duration, buffered });
    }, 500);
    return () => clearInterval(id);
  }, [player, isLive, scrubSec]);

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
      try { if (typeof p.replace === "function") p.replace(null); } catch {}
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
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
    onPanResponderGrant: (e) => {
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
      <YStack flex={1} backgroundColor="#000" alignItems="center" justifyContent="center" padding={24} gap={16}>
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
        {...panResponder.panHandlers}
      >
        <VideoView
          ref={videoViewRef}
          player={player}
          style={{ flex: 1 }}
          contentFit={contentFit}
          nativeControls={false}
          fullscreenOptions={{ enable: true }}
          allowsPictureInPicture
        />
      </View>

      {/* Gesture indicator */}
      {gestureHint && (
        <YStack position="absolute" top="45%" left={0} right={0} alignItems="center" pointerEvents="none" zIndex={50}>
          <Text color={colors.text} fontSize={20} fontWeight="700" backgroundColor="rgba(0,0,0,0.6)" paddingHorizontal={18} paddingVertical={10} borderRadius={10}>
            {gestureHint.label}
          </Text>
        </YStack>
      )}

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
          backgroundColor="rgba(0,0,0,0.35)"
          pointerEvents="none"
          zIndex={35}
        >
          <Spinner size="large" color={colors.accent} />
          <Text color={colors.text} fontFamily={fonts.body} fontSize={16} fontWeight="600">
            {isRecovering ? "Reconnecting…" : "Loading…"}
          </Text>
        </YStack>
      )}

      {/* Fatal error screen */}
      {isFatal && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} backgroundColor="rgba(0,0,0,0.85)" zIndex={40}>
          <StatePanel
            mode="error"
            title="Failed to load stream"
            message={
              playback.fatalReason === "GONE"
                ? "This stream is no longer available."
                : playback.fatalReason === "AUTH_EXPIRED"
                  ? "Stream unavailable. The server rejected the connection."
                  : "The stream could not be played."
            }
            onRetry={() => playback.retry()}
          />
          <XStack justifyContent="center" paddingBottom={32}>
            <Button variant="secondary" size="md" icon="close" onPress={handleClose}>Close</Button>
          </XStack>
        </YStack>
      )}

      {/* Center play/pause transport. Shown with the controls, hidden during
          load / fatal error / resume prompt so it never overlaps them. The
          box-none wrapper lets the surrounding video gestures still fire. */}
      {showControls && !isLoading && !isFatal && !needsResumeChoice && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center" pointerEvents="box-none" zIndex={30}>
          <YStack width={72} height={72} backgroundColor="rgba(0,0,0,0.55)" borderRadius={36} justifyContent="center" alignItems="center" cursor="pointer" onPress={togglePlayPause} pressStyle={{ opacity: 0.8 }}>
            <Icon name={isPlaying ? "pause" : "play"} size={34} color={colors.text} />
          </YStack>
        </YStack>
      )}

      {/* Top controls bar */}
      {showControls && (
        <YStack position="absolute" top={0} left={0} right={0} paddingTop={insets.top + topPadding} pointerEvents="box-none">
          <XStack alignItems="center" paddingHorizontal={12} paddingVertical={8} backgroundColor="rgba(0,0,0,0.7)" flexWrap="wrap" gap={8}>
            <YStack width={34} height={34} backgroundColor={accentAlpha(0.9)} borderRadius={17} justifyContent="center" alignItems="center" cursor="pointer" onPress={handleClose} pressStyle={{ opacity: 0.8 }}>
              <Icon name="close" size={16} color={colors.text} />
            </YStack>

            <Text color={colors.text} fontFamily={fonts.display} fontSize={14} fontWeight="600" flex={1} minWidth={60} numberOfLines={1}>{currentVideo.name}</Text>

            {isLive && channels.length > 1 && (
              <>
                <Button variant="secondary" size="sm" icon="back" onPress={() => zapChannel("prev")}>Ch</Button>
                <Button variant="secondary" size="sm" icon="chevron-right" onPress={() => zapChannel("next")}>Ch</Button>
              </>
            )}

            {nextEpisode && (
              <Button variant="primary" size="sm" icon="play" onPress={handleNextEpisode}>Next</Button>
            )}
          </XStack>

          {/* EPG now/next strip for live */}
          {isLive && (nowNext.now || nowNext.next) && (
            <XStack paddingHorizontal={12} paddingVertical={6} backgroundColor="rgba(0,0,0,0.55)" gap={16} flexWrap="wrap">
              {nowNext.now && (
                <Text color={colors.text} fontSize={12} numberOfLines={1} flex={1} minWidth={120}>
                  Now: {nowNext.now.title}{typeof nowNext.now.progressPct === "number" ? ` (${nowNext.now.progressPct}%)` : ""}
                </Text>
              )}
              {nowNext.next && (
                <Text color={colors.muted} fontSize={12} numberOfLines={1} flex={1} minWidth={120}>
                  Next: {nowNext.next.title}
                </Text>
              )}
            </XStack>
          )}
        </YStack>
      )}

      {/* Bottom control container — settings icon row + (VOD) seek bar */}
      {showControls && (
        <YStack position="absolute" bottom={0} left={0} right={0} paddingBottom={insets.bottom + 12} backgroundColor="rgba(0,0,0,0.7)" zIndex={20}>
          {/* Settings icon row (horizontally scrollable so it never overflows). */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
            {!isLive && (
              <Button variant="secondary" size="sm" icon="speed" onPress={() => { setShowSpeedMenu(true); setShowAudioMenu(false); setShowSubtitleMenu(false); }}>{`${speed}x`}</Button>
            )}
            {audioTracks.length > 1 && (
              <Button variant="secondary" size="sm" icon="audio" onPress={() => { setShowAudioMenu(true); setShowSpeedMenu(false); setShowSubtitleMenu(false); }} />
            )}
            {subtitleTracks.length > 0 && (
              <Button variant="secondary" size="sm" icon="cc" onPress={() => { setShowSubtitleMenu(true); setShowSpeedMenu(false); setShowAudioMenu(false); }} />
            )}
            <Button variant="secondary" size="sm" icon="tune" onPress={() => setShowSubtitleSettings(true)} />
            <Button variant="secondary" size="sm" icon="aspect" onPress={cycleContentFit} />
            <Button variant={isFullscreen ? "primary" : "secondary"} size="sm" icon="fullscreen" onPress={toggleFullscreen} />
            <Button variant={showStats ? "primary" : "secondary"} size="sm" icon="info" onPress={() => setShowStats((s) => !s)} />
            <Button variant={sleep.active ? "primary" : "secondary"} size="sm" icon="timer" onPress={() => setShowSleepMenu(true)}>{sleep.active ? formatRemaining(sleep.secondsLeft) : undefined}</Button>
            <Button variant="secondary" size="sm" icon="pip" onPress={handlePip} />
          </ScrollView>

          {/* Seek bar (VOD only) */}
          {!isLive && progress.duration > 0 && (() => {
            const shown = scrubSec != null ? scrubSec : progress.position;
            const playedPct = Math.max(0, Math.min(100, (shown / progress.duration) * 100));
            const bufferedPct = Math.max(0, Math.min(100, (progress.buffered / progress.duration) * 100));
            return (
              <YStack paddingHorizontal={16} paddingTop={4}>
                <View
                  style={{ height: 26, justifyContent: "center" }}
                  onLayout={(e) => { seekTrackWidth.current = e.nativeEvent.layout.width; }}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={(e) => scrubToX(e.nativeEvent.locationX)}
                  onResponderMove={(e) => scrubToX(e.nativeEvent.locationX)}
                  onResponderRelease={commitScrub}
                  onResponderTerminate={commitScrub}
                >
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" }} />
                  <View style={{ position: "absolute", left: 0, height: 4, borderRadius: 2, width: `${bufferedPct}%`, backgroundColor: "rgba(255,255,255,0.4)" }} />
                  <View style={{ position: "absolute", left: 0, height: 4, borderRadius: 2, width: `${playedPct}%`, backgroundColor: colors.accent }} />
                  <View style={{ position: "absolute", left: `${playedPct}%`, width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: colors.accent }} />
                </View>
                <XStack justifyContent="space-between" marginTop={4}>
                  <Text color={colors.text} fontSize={12} fontWeight="600">{formatTime(shown)}</Text>
                  <Text color={colors.muted} fontSize={12}>{formatTime(progress.duration)}</Text>
                </XStack>
              </YStack>
            );
          })()}
        </YStack>
      )}

      {/* Speed Menu */}
      <Modal visible={showSpeedMenu} transparent animationType="fade" supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowSpeedMenu(false)}>
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

      {/* Audio Menu */}
      <Modal visible={showAudioMenu} transparent animationType="fade" supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowAudioMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" }} activeOpacity={1} onPress={() => setShowAudioMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={220} maxHeight={350} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.muted} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Audio Track</Text>
            <ScrollView>
              {audioTracks.map((track, idx) => (
                <YStack key={idx} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedAudio === track ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleAudioChange(track)} pressStyle={{ opacity: 0.7 }}>
                  <Text color={selectedAudio === track ? colors.accent : colors.muted} fontSize={15} fontWeight={selectedAudio === track ? "700" : "400"}>{track.language || track.label || `Track ${idx + 1}`}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* Subtitle Menu */}
      <Modal visible={showSubtitleMenu} transparent animationType="fade" supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowSubtitleMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" }} activeOpacity={1} onPress={() => setShowSubtitleMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={220} maxHeight={350} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.muted} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Subtitles</Text>
            <ScrollView>
              <YStack paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedSubtitle === null ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleSubtitleChange(null)} pressStyle={{ opacity: 0.7 }}>
                <Text color={selectedSubtitle === null ? colors.accent : colors.muted} fontSize={15} fontWeight={selectedSubtitle === null ? "700" : "400"}>Off</Text>
              </YStack>
              {subtitleTracks.map((track, idx) => (
                <YStack key={idx} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedSubtitle === track ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleSubtitleChange(track)} pressStyle={{ opacity: 0.7 }}>
                  <Text color={selectedSubtitle === track ? colors.accent : colors.muted} fontSize={15} fontWeight={selectedSubtitle === track ? "700" : "400"}>{track.language || track.label || `Track ${idx + 1}`}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* Subtitle & Audio tuning panel */}
      <Modal visible={showSubtitleSettings} transparent animationType="fade" supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowSubtitleSettings(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" }} activeOpacity={1} onPress={() => setShowSubtitleSettings(false)}>
          <TouchableOpacity activeOpacity={1}>
            <SubtitleSettings
              style={subtitleStyleValue}
              subtitleOffsetMs={typeof prefs.subtitleOffsetMs === "number" ? prefs.subtitleOffsetMs : 0}
              audioOffsetMs={typeof prefs.audioOffsetMs === "number" ? prefs.audioOffsetMs : 0}
              onChange={handleSettingsChange}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Sleep-timer menu */}
      <Modal visible={showSleepMenu} transparent animationType="fade" supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowSleepMenu(false)}>
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
                      // No fixed duration: cancel any active timer; the playToEnd
                      // listener already advances/closes at end of media.
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
