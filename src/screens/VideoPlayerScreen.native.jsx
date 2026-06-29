import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { Modal, StatusBar, Platform, TouchableOpacity, AppState, PanResponder, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as ScreenOrientation from "expo-screen-orientation";
import { YStack, XStack, Text, ScrollView, Spinner } from "../ui/primitives";
import { colors } from "../ui/tokens";
import { useApp } from "../context/AppContext";
import iptvApi from "../services/iptvApi";
import storage from "../utils/storage";
import { createExpoVideoDriver } from "../playback/drivers/expoVideoDriver";
import { useResilientPlayback } from "../playback/useResilientPlayback";

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

// Namespaced storage key remembering the last-watched live channel stream id.
const LAST_CHANNEL_KEY = "player_last_live_channel";

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
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    return require("expo-brightness");
  } catch {
    return null;
  }
}

export default function VideoPlayerScreen({ navigation }) {
  const {
    currentVideo,
    closeVideo,
    updateWatchProgress,
    addToWatchHistory,
    playVideo,
    flushProgress,
    channels,
  } = useApp();
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
  // initial load/seek/play, so the init callback only mirrors the player.
  const player = useVideoPlayer(
    currentVideo ? { uri: currentVideo.url } : null,
    () => {},
  );

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

  useEffect(() => { resetControlsTimer(); return () => clearTimeout(controlsTimerRef.current); }, []);

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
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => {
      try { deactivateKeepAwake(); } catch {}
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);

  // Background audio / now-playing controls — expo-video player config. Guarded:
  // these setters are no-ops on platforms/builds that don't expose them.
  useEffect(() => {
    if (!player) return;
    try { player.staysActiveInBackground = true; } catch {}
    try { player.showNowPlayingNotification = true; } catch {}
    try { if (typeof player.allowsExternalPlayback !== "undefined") player.allowsExternalPlayback = true; } catch {}
  }, [player]);

  // Flush watch progress when the app is backgrounded/inactivated.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "background" && state !== "inactive") return;
      if (player && currentVideo && currentVideo.type !== "live") {
        updateWatchProgress(currentVideo.streamId, currentVideo.type, player.currentTime, Number.isFinite(player.duration) ? player.duration : 0);
      }
      flushProgress();
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
  }, [player, currentVideo?.url, updateWatchProgress]);

  useEffect(() => {
    if (!currentVideo || hasAddedToHistory.current) return;
    if (currentVideo.type !== "live") {
      hasAddedToHistory.current = true;
      addToWatchHistory({ ...currentVideo, currentTime: currentVideo.startTime || 0 });
    }
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
  const VALID_CONTENT_FITS = ["contain", "cover", "fill"];
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

  const getNextEpisode = useCallback(() => {
    if (!currentVideo || currentVideo.type !== "series" || !currentVideo.seriesSeasons) return null;
    const allEpisodes = Object.keys(currentVideo.seriesSeasons).map(Number).sort((a, b) => a - b)
      .flatMap((sNum) => [...(currentVideo.seriesSeasons[String(sNum)] || [])].sort((a, b) => Number(a.episode_num) - Number(b.episode_num)).map((ep) => ({ ...ep, seasonNum: String(sNum) })));
    const currentIdx = allEpisodes.findIndex((ep) => String(ep.id) === String(currentVideo.streamId));
    if (currentIdx === -1 || currentIdx >= allEpisodes.length - 1) return null;
    const next = allEpisodes[currentIdx + 1];
    return { episode: next, seasonNum: next.seasonNum };
  }, [currentVideo]);

  const handleNextEpisode = useCallback(() => {
    const next = getNextEpisode();
    if (!next) return;
    const { episode, seasonNum } = next;
    const streamUrl = iptvApi.buildStreamUrl("series", episode.id, episode.container_extension || "mp4");
    const epNum = String(episode.episode_num).padStart(2, "0");
    const sNum = String(seasonNum).padStart(2, "0");
    playVideo({ type: "series", streamId: episode.id, seriesId: currentVideo.seriesId, seriesName: currentVideo.seriesName, name: `${currentVideo.seriesName} - S${sNum}E${epNum}`, url: streamUrl, seasonNum, episodeNum: episode.episode_num, seriesSeasons: currentVideo.seriesSeasons });
  }, [getNextEpisode, currentVideo, playVideo]);

  useEffect(() => {
    if (!player || !currentVideo) return;
    const sub = player.addListener("playToEnd", () => { if (currentVideo.type === "series" && getNextEpisode()) handleNextEpisode(); });
    return () => sub?.remove();
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
    closeVideo();
    navigation.goBack();
  }, [player, currentVideo, updateWatchProgress, flushProgress, closeVideo, navigation]);

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
  }, [showStats, player, playback.qualityCap, playback.currentTime]);

  useEffect(() => { if (!currentVideo) navigation.goBack(); }, [currentVideo]);

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

  if (!currentVideo || !player) return null;

  const nextEpisode = getNextEpisode();
  const topPadding = Platform.OS === "ios" ? 12 : 8;
  const brightnessAvailable = !!brightnessRef.current;

  return (
    <YStack flex={1} backgroundColor="#000">
      <StatusBar hidden />

      {/* Video + gesture surface. nativeControls disabled so PanResponder owns
          touches; gesture indicators + custom controls replace them. */}
      <View
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        onLayout={(ev) => { gestureState.current.layoutW = ev.nativeEvent.layout.width; }}
        {...panResponder.panHandlers}
      >
        <VideoView
          ref={videoViewRef}
          player={player}
          style={{ flex: 1 }}
          contentFit={contentFit}
          nativeControls={false}
          allowsFullscreen
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

      {/* Loading overlay */}
      {isLoading && !isFatal && !needsResumeChoice && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center" backgroundColor="rgba(0,0,0,0.5)" pointerEvents="none">
          <Spinner size="large" color={colors.accent} />
          <Text color={colors.text} marginTop={10} fontSize={14}>Loading stream...</Text>
        </YStack>
      )}

      {/* Reconnecting badge */}
      {isRecovering && !isFatal && (
        <XStack position="absolute" bottom={16} right={16} backgroundColor="rgba(108, 92, 231,0.92)" paddingHorizontal={14} paddingVertical={8} borderRadius={8} alignItems="center" gap={8} pointerEvents="none" zIndex={30}>
          <Spinner size="small" color={colors.text} />
          <Text color={colors.text} fontSize={13} fontWeight="600">Reconnecting…</Text>
        </XStack>
      )}

      {/* Sleep-timer countdown badge */}
      {sleep.active && (
        <XStack position="absolute" bottom={16} left={16} backgroundColor="rgba(0,0,0,0.7)" paddingHorizontal={12} paddingVertical={7} borderRadius={8} alignItems="center" gap={6} pointerEvents="none" zIndex={30}>
          <Text color={colors.text} fontSize={13} fontWeight="600">⏾ {formatRemaining(sleep.secondsLeft)}</Text>
        </XStack>
      )}

      {/* Fatal error screen */}
      {isFatal && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center" backgroundColor="rgba(0,0,0,0.85)" gap={10} zIndex={40}>
          <Text color={colors.text} fontSize={20} fontWeight="700">Failed to load stream</Text>
          <Text color={colors.muted} fontSize={14}>
            {playback.fatalReason === "GONE"
              ? "This stream is no longer available."
              : playback.fatalReason === "AUTH_EXPIRED"
                ? "Stream unavailable. The server rejected the connection."
                : "The stream could not be played."}
          </Text>
          <XStack gap={16} marginTop={8}>
            <YStack backgroundColor="rgba(255,255,255,0.15)" paddingHorizontal={28} paddingVertical={12} borderRadius={10} borderWidth={1} borderColor="rgba(255,255,255,0.2)" cursor="pointer" onPress={() => playback.retry()} pressStyle={{ opacity: 0.7 }}>
              <Text color={colors.text} fontSize={15} fontWeight="600">Retry</Text>
            </YStack>
            <YStack backgroundColor="rgba(108, 92, 231,0.9)" paddingHorizontal={28} paddingVertical={12} borderRadius={10} cursor="pointer" onPress={handleClose} pressStyle={{ opacity: 0.8 }}>
              <Text color={colors.text} fontSize={15} fontWeight="600">Close</Text>
            </YStack>
          </XStack>
        </YStack>
      )}

      {/* Top controls bar */}
      {showControls && (
        <YStack position="absolute" top={0} left={0} right={0} paddingTop={topPadding} pointerEvents="box-none">
          <XStack alignItems="center" paddingHorizontal={12} paddingVertical={8} backgroundColor="rgba(0,0,0,0.7)" flexWrap="wrap" gap={8}>
            <YStack width={34} height={34} backgroundColor="rgba(108, 92, 231,0.9)" borderRadius={17} justifyContent="center" alignItems="center" cursor="pointer" onPress={handleClose} pressStyle={{ opacity: 0.8 }}>
              <Text color={colors.text} fontSize={14} fontWeight="700">✕</Text>
            </YStack>

            <Text color={colors.text} fontSize={14} fontWeight="600" flex={1} minWidth={60} numberOfLines={1}>{currentVideo.name}</Text>

            {/* Live channel zap */}
            {isLive && channels.length > 1 && (
              <>
                <YStack backgroundColor="rgba(255,255,255,0.15)" paddingHorizontal={10} paddingVertical={6} borderRadius={8} borderWidth={1} borderColor="rgba(255,255,255,0.2)" cursor="pointer" onPress={() => zapChannel("prev")} pressStyle={{ opacity: 0.7 }}>
                  <Text color={colors.text} fontSize={12} fontWeight="600">⏮ Ch</Text>
                </YStack>
                <YStack backgroundColor="rgba(255,255,255,0.15)" paddingHorizontal={10} paddingVertical={6} borderRadius={8} borderWidth={1} borderColor="rgba(255,255,255,0.2)" cursor="pointer" onPress={() => zapChannel("next")} pressStyle={{ opacity: 0.7 }}>
                  <Text color={colors.text} fontSize={12} fontWeight="600">Ch ⏭</Text>
                </YStack>
              </>
            )}

            {!isLive && (
              <YStack backgroundColor="rgba(255,255,255,0.15)" paddingHorizontal={10} paddingVertical={6} borderRadius={8} borderWidth={1} borderColor="rgba(255,255,255,0.2)" cursor="pointer" onPress={() => { setShowSpeedMenu(true); setShowAudioMenu(false); setShowSubtitleMenu(false); }} pressStyle={{ opacity: 0.7 }}>
                <Text color={colors.text} fontSize={12} fontWeight="600">▶ {speed}x</Text>
              </YStack>
            )}

            {audioTracks.length > 1 && (
              <YStack backgroundColor="rgba(255,255,255,0.15)" paddingHorizontal={10} paddingVertical={6} borderRadius={8} borderWidth={1} borderColor="rgba(255,255,255,0.2)" cursor="pointer" onPress={() => { setShowAudioMenu(true); setShowSpeedMenu(false); setShowSubtitleMenu(false); }} pressStyle={{ opacity: 0.7 }}>
                <Text color={colors.text} fontSize={12} fontWeight="600">♪ Audio</Text>
              </YStack>
            )}

            {subtitleTracks.length > 0 && (
              <YStack backgroundColor="rgba(255,255,255,0.15)" paddingHorizontal={10} paddingVertical={6} borderRadius={8} borderWidth={1} borderColor="rgba(255,255,255,0.2)" cursor="pointer" onPress={() => { setShowSubtitleMenu(true); setShowSpeedMenu(false); setShowAudioMenu(false); }} pressStyle={{ opacity: 0.7 }}>
                <Text color={colors.text} fontSize={12} fontWeight="600">CC</Text>
              </YStack>
            )}

            {/* Subtitle & audio tuning panel */}
            <YStack backgroundColor="rgba(255,255,255,0.15)" paddingHorizontal={10} paddingVertical={6} borderRadius={8} borderWidth={1} borderColor="rgba(255,255,255,0.2)" cursor="pointer" onPress={() => setShowSubtitleSettings(true)} pressStyle={{ opacity: 0.7 }}>
              <Text color={colors.text} fontSize={12} fontWeight="600">⚙ Tune</Text>
            </YStack>

            {/* Aspect / contentFit cycle */}
            <YStack backgroundColor="rgba(255,255,255,0.15)" paddingHorizontal={10} paddingVertical={6} borderRadius={8} borderWidth={1} borderColor="rgba(255,255,255,0.2)" cursor="pointer" onPress={cycleContentFit} pressStyle={{ opacity: 0.7 }}>
              <Text color={colors.text} fontSize={12} fontWeight="600">⤢ {contentFit}</Text>
            </YStack>

            {/* Stats toggle */}
            <YStack backgroundColor={showStats ? "rgba(108, 92, 231,0.9)" : "rgba(255,255,255,0.15)"} paddingHorizontal={10} paddingVertical={6} borderRadius={8} borderWidth={1} borderColor="rgba(255,255,255,0.2)" cursor="pointer" onPress={() => setShowStats((s) => !s)} pressStyle={{ opacity: 0.7 }}>
              <Text color={colors.text} fontSize={12} fontWeight="600">ⓘ Stats</Text>
            </YStack>

            {/* Sleep timer */}
            <YStack backgroundColor={sleep.active ? "rgba(108, 92, 231,0.9)" : "rgba(255,255,255,0.15)"} paddingHorizontal={10} paddingVertical={6} borderRadius={8} borderWidth={1} borderColor="rgba(255,255,255,0.2)" cursor="pointer" onPress={() => setShowSleepMenu(true)} pressStyle={{ opacity: 0.7 }}>
              <Text color={colors.text} fontSize={12} fontWeight="600">⏾ Sleep</Text>
            </YStack>

            {/* PiP */}
            <YStack backgroundColor="rgba(255,255,255,0.15)" paddingHorizontal={10} paddingVertical={6} borderRadius={8} borderWidth={1} borderColor="rgba(255,255,255,0.2)" cursor="pointer" onPress={handlePip} pressStyle={{ opacity: 0.7 }}>
              <Text color={colors.text} fontSize={12} fontWeight="600">⧉ PiP</Text>
            </YStack>

            {nextEpisode && (
              <YStack backgroundColor="rgba(108, 92, 231,0.9)" paddingHorizontal={12} paddingVertical={6} borderRadius={8} cursor="pointer" onPress={handleNextEpisode} pressStyle={{ opacity: 0.8 }}>
                <Text color={colors.text} fontSize={12} fontWeight="600">Next ▶</Text>
              </YStack>
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

      {/* Speed Menu */}
      <Modal visible={showSpeedMenu} transparent animationType="fade" onRequestClose={() => setShowSpeedMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" }} activeOpacity={1} onPress={() => setShowSpeedMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={220} maxHeight={350} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.muted} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Playback Speed</Text>
            <ScrollView>
              {SPEEDS.map((rate) => (
                <YStack key={rate} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={speed === rate ? "rgba(108, 92, 231,0.2)" : "transparent"} cursor="pointer" onPress={() => handleSpeedChange(rate)} pressStyle={{ opacity: 0.7 }}>
                  <Text color={speed === rate ? colors.accent : colors.muted} fontSize={15} fontWeight={speed === rate ? "700" : "400"}>{rate}x{rate === 1 ? " (Normal)" : ""}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* Audio Menu */}
      <Modal visible={showAudioMenu} transparent animationType="fade" onRequestClose={() => setShowAudioMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" }} activeOpacity={1} onPress={() => setShowAudioMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={220} maxHeight={350} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.muted} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Audio Track</Text>
            <ScrollView>
              {audioTracks.map((track, idx) => (
                <YStack key={idx} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedAudio === track ? "rgba(108, 92, 231,0.2)" : "transparent"} cursor="pointer" onPress={() => handleAudioChange(track)} pressStyle={{ opacity: 0.7 }}>
                  <Text color={selectedAudio === track ? colors.accent : colors.muted} fontSize={15} fontWeight={selectedAudio === track ? "700" : "400"}>{track.language || track.label || `Track ${idx + 1}`}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* Subtitle Menu */}
      <Modal visible={showSubtitleMenu} transparent animationType="fade" onRequestClose={() => setShowSubtitleMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" }} activeOpacity={1} onPress={() => setShowSubtitleMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={220} maxHeight={350} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.muted} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Subtitles</Text>
            <ScrollView>
              <YStack paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedSubtitle === null ? "rgba(108, 92, 231,0.2)" : "transparent"} cursor="pointer" onPress={() => handleSubtitleChange(null)} pressStyle={{ opacity: 0.7 }}>
                <Text color={selectedSubtitle === null ? colors.accent : colors.muted} fontSize={15} fontWeight={selectedSubtitle === null ? "700" : "400"}>Off</Text>
              </YStack>
              {subtitleTracks.map((track, idx) => (
                <YStack key={idx} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedSubtitle === track ? "rgba(108, 92, 231,0.2)" : "transparent"} cursor="pointer" onPress={() => handleSubtitleChange(track)} pressStyle={{ opacity: 0.7 }}>
                  <Text color={selectedSubtitle === track ? colors.accent : colors.muted} fontSize={15} fontWeight={selectedSubtitle === track ? "700" : "400"}>{track.language || track.label || `Track ${idx + 1}`}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* Subtitle & Audio tuning panel */}
      <Modal visible={showSubtitleSettings} transparent animationType="fade" onRequestClose={() => setShowSubtitleSettings(false)}>
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
      <Modal visible={showSleepMenu} transparent animationType="fade" onRequestClose={() => setShowSleepMenu(false)}>
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
                <YStack paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor="rgba(108, 92, 231,0.2)" cursor="pointer" onPress={() => { sleep.cancel(); setShowSleepMenu(false); }} pressStyle={{ opacity: 0.7 }}>
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
