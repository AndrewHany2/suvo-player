import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Hls from "hls.js";
import { useApp } from "../context/AppContext";
import iptvApi from "../services/iptvApi";
import { usePlatform } from "../platform";
import { createHlsDriver } from "../playback/drivers/hlsDriver";
import { useResilientPlayback } from "../playback/useResilientPlayback";
import { usePlayerPreferences } from "../playback/usePlayerPreferences";
import { useResumePosition } from "../playback/useResumePosition";
import { useSleepTimer, SLEEP_PRESETS, formatRemaining } from "../playback/useSleepTimer";
import {
  DEFAULT_SUBTITLE_STYLE,
  toCssTextTrackStyle,
  clampOffset,
} from "../playback/subtitleStyle";
import { nextChannel, prevChannel, fetchNowNext } from "../playback/liveExtras";
import {
  isPipSupported,
  enterPip,
  exitPip,
  isPipActive,
  isWebCastAvailable,
  isRemotePlaybackSupported,
  promptRemotePlayback,
  setMediaSessionMetadata,
  setMediaSessionHandlers,
  setMediaSessionPosition,
} from "../playback/mediaCapabilities";
import ResumePrompt from "../playback/components/ResumePrompt";
import SubtitleSettings from "../playback/components/SubtitleSettings";
import StatsOverlay from "../playback/components/StatsOverlay";
import storage from "../utils/storage";
import Icon from "../ui/Icon";
import StatePanel from "../ui/StatePanel";
import Button from "../ui/Button";
import {
  colors,
  accentAlpha,
  radii,
  fonts,
  fontWeights,
  focusRing,
  motion,
  easing,
} from "../ui/tokens";

/** Namespaced storage key remembering the last live channel stream_id. */
const LAST_CHANNEL_KEY = "lumen_last_live_channel";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const ASPECT_RATIOS = [
  { value: "default", label: "Default" },
  { value: "16:9", label: "16:9" },
  { value: "4:3", label: "4:3" },
  { value: "fill", label: "Fill" },
  { value: "stretch", label: "Stretch" },
];

// LG webOS remote key codes
const TV_KEYS = {
  PLAY: 415,
  PAUSE: 19,
  STOP: 413,
  FF: 417,
  REW: 412,
  BACK: new Set([27, 461, 10009, 8, 91]),
};

// Map an hls.js level height to a quality-cap ladder value (see backoff.js
// QUALITY_CAPS). Used so a manual quality pick sets the hook's manualCap, which
// the recovery machine treats as the *best* quality auto-downgrade may restore
// to — auto-downgrade can drop below the user's pick but never exceed it.
function heightToCap(height) {
  if (!height) return "auto";
  if (height >= 1080) return "1080";
  if (height >= 720) return "720";
  if (height >= 480) return "480";
  return "data-saver";
}

// Numeric ceiling for a quality-cap ladder value, used to pick the best hls
// level at or below a remembered cap. 'auto' (or unknown) => Infinity (no cap).
function capToMaxHeight(cap) {
  switch (cap) {
    case "1080": return 1080;
    case "720": return 720;
    case "480": return 480;
    case "data-saver": return 360;
    default: return Infinity;
  }
}

// Given the available hls levels and a remembered cap, return the index of the
// best (tallest) level whose height is at/below the cap, or -1 for Auto.
function levelForCap(levels, cap) {
  if (!cap || cap === "auto" || !Array.isArray(levels) || levels.length === 0) return -1;
  const max = capToMaxHeight(cap);
  let bestIdx = -1;
  let bestH = -1;
  for (let i = 0; i < levels.length; i++) {
    const h = levels[i]?.height || 0;
    if (h <= max && h > bestH) { bestH = h; bestIdx = i; }
  }
  return bestIdx;
}

const S = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000",
    zIndex: 9999,
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    backgroundColor: "rgba(0,0,0,0.85)",
    flexShrink: 0,
    flexWrap: "wrap",
  },
  title: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 14,
    fontWeight: 600,
    minWidth: 60,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  videoWrapper: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    display: "block",
  },
  btn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.15)",
    border: "1px solid rgba(255,255,255,0.2)",
    color: colors.text,
    borderRadius: radii.sm,
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: fonts.body,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: `box-shadow ${motion.base}ms ${easing}, outline-color ${motion.fast}ms ${easing}`,
  },
  closeBtn: {
    backgroundColor: accentAlpha(0.9),
    border: "none",
    color: colors.text,
    borderRadius: "50%",
    width: 32,
    height: 32,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  nextBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    backgroundColor: accentAlpha(0.9),
    border: "none",
    color: colors.text,
    borderRadius: radii.sm,
    padding: "6px 12px",
    fontSize: 12,
    fontFamily: fonts.body,
    fontWeight: 600,
    cursor: "pointer",
  },
  dropdown: { position: "relative" },
  menu: {
    position: "absolute",
    top: "110%",
    right: 0,
    backgroundColor: colors.surface2,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    padding: 4,
    minWidth: 130,
    zIndex: 100,
    maxHeight: 220,
    overflowY: "auto",
  },
  menuItem: (active) => ({
    display: "block",
    width: "100%",
    textAlign: "left",
    fontFamily: fonts.body,
    border: "none",
    padding: "9px 14px",
    borderRadius: radii.sm,
    cursor: "pointer",
    fontSize: 14,
    color: active ? colors.accent : colors.muted,
    fontWeight: active ? 700 : 400,
    backgroundColor: active ? accentAlpha(0.12) : "transparent",
  }),
  stateOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  footer: {
    padding: "4px 12px",
    backgroundColor: "rgba(0,0,0,0.7)",
    color: colors.faint,
    fontFamily: fonts.body,
    fontSize: 11,
    flexShrink: 0,
  },
};

// ── TV-specific styles ────────────────────────────────────────────────────────
const TV = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000",
    zIndex: 9999,
    overflow: "hidden",
  },
  controls: (visible) => ({
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    background:
      "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.85) 100%)",
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? "auto" : "none",
  }),
  topBar: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "28px 48px 20px",
    flexShrink: 0,
  },
  closeBtn: {
    background: accentAlpha(0.9),
    border: "none",
    color: colors.text,
    borderRadius: "50%",
    width: 52,
    height: 52,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 26,
    fontWeight: 700,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  nextBtn: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: accentAlpha(0.9),
    border: "none",
    color: colors.text,
    borderRadius: radii.sm,
    padding: "12px 24px",
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
  },
  center: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  playIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "rgba(255,255,255,0.9)",
  },
  bottomBar: {
    padding: "0 48px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  timeRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    color: colors.text,
    fontSize: 20,
    fontWeight: 600,
  },
  progressTrack: {
    height: 6,
    background: "rgba(255,255,255,0.25)",
    borderRadius: 3,
    overflow: "hidden",
    cursor: "pointer",
  },
  progressFill: (pct) => ({
    height: "100%",
    width: `${pct}%`,
    background: colors.accent2,
    borderRadius: 3,
  }),
  seekHint: {
    textAlign: "center",
    color: "rgba(255,255,255,0.6)",
    fontSize: 16,
  },
};

import { formatDuration as fmtTime } from "../utils/formatDuration";

export default function VideoPlayerScreen() {
  const { isTV } = usePlatform();
  const {
    currentVideo,
    closeVideo,
    updateWatchProgress,
    addToWatchHistory,
    playVideo,
    flushProgress,
    channels,
  } = useApp();

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const progressRef = useRef(null);
  const controlsTimerRef = useRef(null);

  const [qualityLevels, setQualityLevels] = useState([]);
  const [selectedLevel, setSelectedLevel] = useState(-1);
  const [openMenu, setOpenMenu] = useState(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [audioTracks, setAudioTracks] = useState([]);
  const [selectedAudio, setSelectedAudio] = useState(0);
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState(-1);
  const [aspectRatio, setAspectRatio] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("lumen_settings") || "{}").defaultAspect || "default";
    } catch { return "default"; }
  });

  // TV-specific state
  const [tvControlsVisible, setTvControlsVisible] = useState(true);
  const [tvPaused, setTvPaused] = useState(false);
  const [tvCurrentTime, setTvCurrentTime] = useState(0);
  const [tvDuration, setTvDuration] = useState(0);

  // Transient buffering (ordinary rebuffering) — surfaced as a spinner over the
  // last frame, WITHOUT triggering the recovery machine's reconnect/reload. Only
  // a sustained stall (handled by the driver watchdog) escalates to recovery.
  const [isBuffering, setIsBuffering] = useState(false);
  // Frozen last-decoded frame, captured when playback goes busy so a genuine
  // reconnect (which tears down hls.js and blanks the <video>) still shows the
  // last image behind the spinner instead of a black screen.
  const frameCanvasRef = useRef(null);
  const [hasFrozenFrame, setHasFrozenFrame] = useState(false);

  const isLive = currentVideo?.type === "live";

  // User-pinned quality ceiling fed to the recovery machine. A manual quality
  // pick sets this (mapped from the chosen level's height); auto-downgrade may
  // drop below it but never restore above it. 'auto' = no ceiling.
  const [manualCap, setManualCap] = useState("auto");

  // Menu refs (outside-click dismissal, web only)
  const qualityRef = useRef(null);
  const speedRef = useRef(null);
  const audioRef = useRef(null);
  const subtitleRef = useRef(null);
  const aspectRef = useRef(null);
  const moreRef = useRef(null);

  // ── Phase 2 state ───────────────────────────────────────────────────────────
  // Remembered preferences (per-stream, merged over global) — see usePlayerPreferences.
  const streamKey = currentVideo
    ? `${currentVideo.type}_${currentVideo.streamId}`
    : null;
  const { prefs, loaded: prefsLoaded, setPref } = usePlayerPreferences(streamKey);

  // Resume resolution for VOD. `startTime` fed to the hook is decided once the
  // user picks (web prompt) or auto-resume (TV).
  const resume = useResumePosition(currentVideo);
  const [startTime, setStartTime] = useState(0);
  // Whether we still owe the user a resume decision (web prompt visible).
  const [resumePending, setResumePending] = useState(false);

  // Subtitle styling + a/v delay offsets (live-applied, persisted via prefs).
  const subtitleStyle = useMemo(
    () => ({ ...DEFAULT_SUBTITLE_STYLE, ...(prefs.subtitleStyle || {}) }),
    [prefs.subtitleStyle],
  );
  const subtitleOffsetMs = clampOffset(Number(prefs.subtitleOffsetMs) || 0);
  const audioOffsetMs = clampOffset(Number(prefs.audioOffsetMs) || 0);

  // Stats overlay toggle + gathered stats snapshot.
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState({});

  // PiP / cast capability + active flags.
  const [pipActive, setPipActive] = useState(false);
  const pipSupported = isPipSupported(videoRef.current);
  const castSupported = isWebCastAvailable(videoRef.current);

  // EPG now/next for live.
  const [nowNext, setNowNext] = useState({ now: null, next: null });

  // Sleep timer: pause + close when it elapses.
  const handleSleepElapsed = useCallback(() => {
    const video = videoRef.current;
    if (video) video.pause();
    handleCloseRef.current?.();
  }, []);
  const sleep = useSleepTimer(handleSleepElapsed);
  // handleClose is defined below; capture it in a ref so the sleep callback
  // (created before handleClose) can reach the latest version.
  const handleCloseRef = useRef(null);
  // next-episode handler + availability are computed lower down; mirror them in
  // refs so the MediaSession effect (declared earlier) can reach the latest.
  const handleNextEpisodeRef = useRef(null);
  const nextEpisodeAvailableRef = useRef(false);

  const stopProgress = useCallback(() => {
    clearInterval(progressRef.current);
    progressRef.current = null;
  }, []);

  // (Re)create the hls.js engine instance for a source and wire the listeners
  // that populate the quality / audio / subtitle menus. The driver calls this
  // at the start of every load()/RELOAD so the instance is fresh and exists
  // before loadSource — independent of React effect ordering. The bespoke
  // recovery (reloadCount / liveError / recoverMediaError) is gone; the shared
  // machine owns retries via driver.load.
  const ensureHls = useCallback(
    (url) => {
      if (!videoRef.current) return null;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      // TVs (esp. webOS) have far less memory/CPU headroom — keep buffers small
      // and cap the rendered level to the player size so we don't OOM or stall.
      // enableWorker stays on; note: some older webOS builds break with workers,
      // disable there if playback fails to start.
      const hls = new Hls(
        isTV
          ? {
              enableWorker: true,
              lowLatencyMode: false,
              backBufferLength: 30,
              maxBufferLength: 30,
              maxMaxBufferLength: 30,
              maxBufferSize: 30 * 1000 * 1000,
              capLevelToPlayerSize: true,
            }
          : {
              enableWorker: true,
              lowLatencyMode: false,
              backBufferLength: 90,
              maxBufferLength: 30,
              maxMaxBufferLength: 60,
            },
      );
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => setQualityLevels(hls.levels));
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        setAudioTracks([...hls.audioTracks]);
        setSelectedAudio(Math.max(0, hls.audioTrack));
      });
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_e, d) => setSelectedAudio(d.id));
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () =>
        setSubtitleTracks([...hls.subtitleTracks]),
      );
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_e, d) =>
        setSelectedSubtitle(d.id),
      );
      return hls;
    },
    [isTV],
  );

  // ── Resilient playback: the shared recovery brain drives load / retries /
  // backoff / quality-downgrade / offline / fatal. We hand it an hlsDriver that
  // resolves the <video> element lazily (videoRef getter) and the live hls.js
  // instance (getHls). Building it with getters — rather than the concrete
  // element — keeps the driver non-null from the first render, so the hook's
  // load effect (which fires on the same commit, after the ref is attached) sees
  // a valid driver and a live element. The driver is stable for the session.
  const driver = useMemo(() => {
    if (typeof window === "undefined") return null;
    return createHlsDriver(() => videoRef.current, {
      isTV,
      getHls: () => hlsRef.current,
      ensureHls,
    });
  }, [isTV, ensureHls]);

  const source = useMemo(
    () => (currentVideo ? { uri: currentVideo.url } : null),
    [currentVideo?.url],
  );

  const playback = useResilientPlayback({
    driver,
    source,
    isLive,
    // Resolved resume/start-over decision (web) or auto-resume (TV); falls back
    // to any explicit startTime carried on currentVideo (e.g. next-episode).
    startTime,
    manualCap,
    // AUTH-refresh hook. The recovery machine calls this once on a 401/403 before
    // retrying; re-loading the same signed URL forces a fresh handshake. A real
    // credential-refresh would live in AppContext (out of scope here).
    refreshCredentials: () => {},
  });

  const isLoading = playback.status === "idle" || playback.status === "loading";
  const isRecovering = playback.isRecovering;
  const isFatal = playback.isFatal;
  const fatalReason = playback.fatalReason;

  // "Busy" = any non-clean-playback state where we show a spinner: initial
  // load, transient buffering, or a genuine reconnect. Never while fatal (the
  // error panel owns that).
  const isBusy = (isLoading || isRecovering || isBuffering) && !isFatal;

  // Snapshot the current <video> frame into the offscreen canvas. Used so the
  // frozen last image can stay on screen behind the spinner even after a
  // reconnect tears down hls.js and blanks the element. No-ops (silently) before
  // the first frame decodes or if the frame is CORS-tainted.
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = frameCanvasRef.current;
    if (!video || !canvas) return;
    if (!video.videoWidth || !video.videoHeight) return;
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setHasFrozenFrame(true);
    } catch {
      /* tainted canvas or not yet drawable — fall back to a black scrim */
    }
  }, []);

  // Capture on the rising edge of "busy" (frame is still intact at that point —
  // a reconnect's reload is scheduled, not immediate) and clear the frozen frame
  // once we're cleanly playing again.
  const wasBusyRef = useRef(false);
  useEffect(() => {
    if (isBusy && !wasBusyRef.current) captureFrame();
    if (!isBusy) setHasFrozenFrame(false);
    wasBusyRef.current = isBusy;
  }, [isBusy, captureFrame]);

  const handleRetry = useCallback(() => {
    playback.retry();
  }, [playback]);

  const handleClose = useCallback(() => {
    const video = videoRef.current;
    if (video && currentVideo) {
      updateWatchProgress(
        currentVideo.streamId,
        currentVideo.type,
        video.currentTime,
        Number.isFinite(video.duration) ? video.duration : 0,
      );
      // Don't rely on the 5s debounce — push the position synchronously so
      // closing immediately after seeking still persists resume.
      flushProgress();
    }
    stopProgress();
    closeVideo();
  }, [currentVideo, updateWatchProgress, flushProgress, stopProgress, closeVideo]);

  // Keep the sleep-timer's close handler pointed at the latest handleClose.
  useEffect(() => {
    handleCloseRef.current = handleClose;
  }, [handleClose]);

  // Show TV controls and restart hide timer
  const showTvControls = useCallback(() => {
    setTvControlsVisible(true);
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(
      () => setTvControlsVisible(false),
      4000,
    );
  }, []);

  // ── Per-source reset + watch-history + teardown ─────────────────────────────
  // The resilient-playback hook owns the actual load/seek/play and recovery
  // RELOADs; the hls.js engine instance is (re)created on demand by ensureHls
  // (invoked from the driver's load). This effect only resets per-stream UI
  // state, records watch history, and tears the engine down on source change /
  // unmount.
  useEffect(() => {
    if (!currentVideo || !videoRef.current) return undefined;

    const video = videoRef.current;

    // Reset per-stream UI state.
    setQualityLevels([]);
    setSelectedLevel(-1);
    setOpenMenu(null);
    setManualCap("auto");
    video.playbackRate = 1;
    setPlaybackRate(1);
    setAudioTracks([]);
    setSelectedAudio(0);
    setSubtitleTracks([]);
    setSelectedSubtitle(-1);
    setTvCurrentTime(0);
    setTvDuration(0);
    setIsBuffering(false);
    setHasFrozenFrame(false);
    setShowStats(false);
    setStats({});
    setNowNext({ now: null, next: null });
    setOpenMenu(null);

    if (currentVideo.type !== "live") {
      addToWatchHistory({
        ...currentVideo,
        currentTime: currentVideo.startTime || 0,
      });
    }

    if (isTV) showTvControls();

    return () => {
      stopProgress();
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [currentVideo?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resume resolution ───────────────────────────────────────────────────────
  // The resilient-playback hook reads `startTime` only at source-load time, and
  // the resume decision settles asynchronously (after the load effect captured
  // the old value). So we ALSO carry the desired position in pendingSeekRef and
  // apply it directly to the <video> once it can seek (seekToPending). startTime
  // is still set so a fresh load (e.g. a recovery RELOAD) resumes correctly too.
  const pendingSeekRef = useRef(0);
  // Remembers the source URL whose resume question we've already resolved, so we
  // resolve it at most once per source. Without it, the resume effect re-runs as
  // watchHistory updates during playback (resume.resumeTime grows every tick) and
  // the prompt pops back up after the user dismissed it. Storing the URL (rather
  // than a boolean reset in a separate effect) avoids an effect-ordering hazard
  // on source change.
  const resumeResolvedUrlRef = useRef(null);
  const seekToPending = useCallback(() => {
    const video = videoRef.current;
    const t = pendingSeekRef.current;
    if (video && Number.isFinite(t) && t > 0) {
      try {
        if (Math.abs(video.currentTime - t) > 1) video.currentTime = t;
        // Consume the pending seek so a later buffer-stall 'canplay' can't yank
        // the user back after they've moved away from the resume point.
        pendingSeekRef.current = 0;
      } catch { /* not seekable yet */ }
    }
  }, []);

  // Decide the start time for the new source. An explicit startTime carried on
  // currentVideo (e.g. next-episode auto-advance) always wins. Otherwise, when a
  // resume point exists: TV auto-resumes (no modal — keeps remote focus simple,
  // a 'Start over' control is offered in the overlay); web shows ResumePrompt and
  // holds startTime at 0 until the user chooses.
  useEffect(() => {
    if (!currentVideo) return;
    // Resolve resume once per source. watchHistory updates every progress tick
    // (resume.resumeTime grows), so without this latch the prompt re-appears
    // mid-playback after the user dismissed it. resume.hasResume is a stable
    // boolean (true until ~95% watched), so a late-loading history still flips
    // it once and re-runs this effect to show the prompt.
    if (resumeResolvedUrlRef.current === currentVideo.url) return;
    const explicit = Number(currentVideo.startTime) || 0;
    if (explicit > 0) {
      resumeResolvedUrlRef.current = currentVideo.url;
      setStartTime(explicit);
      pendingSeekRef.current = explicit;
      setResumePending(false);
      return;
    }
    if (resume.hasResume) {
      resumeResolvedUrlRef.current = currentVideo.url;
      if (isTV) {
        // Auto-resume on TV; surface a Start-over control instead of a prompt.
        setStartTime(resume.resumeTime);
        pendingSeekRef.current = resume.resumeTime;
        setResumePending(false);
      } else {
        // Web: hold at 0, show the prompt and let the user decide.
        setStartTime(0);
        pendingSeekRef.current = 0;
        setResumePending(true);
      }
    } else {
      // No resume point (yet). Don't latch — history may still be loading.
      setStartTime(0);
      pendingSeekRef.current = 0;
      setResumePending(false);
    }
    // Keyed on hasResume (stable), NOT resumeTime (changes every tick).
  }, [currentVideo?.url, resume.hasResume, isTV]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply a pending resume seek once the media is ready (covers the case where
  // the hook loaded before the resume decision settled).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    video.addEventListener("loadedmetadata", seekToPending);
    video.addEventListener("canplay", seekToPending);
    return () => {
      video.removeEventListener("loadedmetadata", seekToPending);
      video.removeEventListener("canplay", seekToPending);
    };
  }, [currentVideo?.url, seekToPending]);

  // Resolve a resume choice from the web prompt: feed the chosen start time into
  // the hook and dismiss the prompt. 'startOver' seeks to 0.
  const resolveResume = useCallback(
    (choice) => {
      const t = resume.decide(choice);
      setStartTime(t);
      pendingSeekRef.current = t;
      setResumePending(false);
      const video = videoRef.current;
      if (video && Number.isFinite(t) && t > 0) {
        try { video.currentTime = t; } catch { /* not seekable yet */ }
      }
    },
    [resume],
  );

  // 'Start over' control (both branches): seek to 0 now.
  const handleStartOver = useCallback(() => {
    setStartTime(0);
    pendingSeekRef.current = 0;
    setResumePending(false);
    const video = videoRef.current;
    if (video) {
      try { video.currentTime = 0; } catch { /* ignore */ }
    }
  }, []);

  // ── Remembered preferences: apply on open ───────────────────────────────────
  // Per-source application guards so a remembered value is applied once, then
  // the user's in-session changes (and their persistence) take over.
  const prefsAppliedRef = useRef({ scalar: false, audio: false, subtitle: false, quality: false });

  // Reset the per-source application guards whenever the source changes.
  useEffect(() => {
    prefsAppliedRef.current = { scalar: false, audio: false, subtitle: false, quality: false };
  }, [currentVideo?.url]);

  // Scalar prefs (aspect ratio, playback speed, quality cap) — once loaded.
  useEffect(() => {
    if (!prefsLoaded || !currentVideo || prefsAppliedRef.current.scalar) return;
    prefsAppliedRef.current.scalar = true;

    if (typeof prefs.aspectRatio === "string") setAspectRatio(prefs.aspectRatio);

    const spd = Number(prefs.playbackSpeed);
    if (Number.isFinite(spd) && spd > 0) {
      if (videoRef.current) videoRef.current.playbackRate = spd;
      setPlaybackRate(spd);
    }

    if (typeof prefs.qualityCap === "string" && prefs.qualityCap !== "auto") {
      setManualCap(prefs.qualityCap);
    }
  }, [prefsLoaded, currentVideo, prefs.aspectRatio, prefs.playbackSpeed, prefs.qualityCap]);

  // Audio track — apply once tracks are known (matched by name, falling back to index).
  useEffect(() => {
    if (!prefsLoaded || audioTracks.length <= 1 || prefsAppliedRef.current.audio) return;
    const want = prefs.audioTrack;
    if (want == null) return;
    prefsAppliedRef.current.audio = true;
    let idx = -1;
    if (typeof want === "string") {
      idx = audioTracks.findIndex((t) => (t.name || "") === want);
    }
    if (idx < 0 && Number.isInteger(want) && want >= 0 && want < audioTracks.length) {
      idx = want;
    }
    if (idx >= 0 && idx !== selectedAudio) {
      if (hlsRef.current) hlsRef.current.audioTrack = idx;
      setSelectedAudio(idx);
    }
  }, [prefsLoaded, audioTracks, prefs.audioTrack, selectedAudio]);

  // Subtitle track — apply once tracks are known. -1 / 'off' means disabled.
  useEffect(() => {
    if (!prefsLoaded || subtitleTracks.length === 0 || prefsAppliedRef.current.subtitle) return;
    const want = prefs.subtitleTrack;
    if (want == null) return;
    prefsAppliedRef.current.subtitle = true;
    if (want === "off" || want === -1) {
      if (hlsRef.current) hlsRef.current.subtitleTrack = -1;
      setSelectedSubtitle(-1);
      return;
    }
    let idx = -1;
    if (typeof want === "string") {
      idx = subtitleTracks.findIndex((t) => (t.name || "") === want);
    }
    if (idx < 0 && Number.isInteger(want) && want >= 0 && want < subtitleTracks.length) {
      idx = want;
    }
    if (idx >= 0) {
      if (hlsRef.current) hlsRef.current.subtitleTrack = idx;
      setSelectedSubtitle(idx);
    }
  }, [prefsLoaded, subtitleTracks, prefs.subtitleTrack]);

  // Quality level — apply the remembered cap to a concrete level once levels are
  // known (manualCap already restored above feeds the recovery machine; this
  // also pins the hls currentLevel + the menu's selectedLevel for clarity).
  useEffect(() => {
    if (!prefsLoaded || qualityLevels.length <= 1 || prefsAppliedRef.current.quality) return;
    const cap = prefs.qualityCap;
    if (typeof cap !== "string" || cap === "auto") return;
    prefsAppliedRef.current.quality = true;
    const idx = levelForCap(qualityLevels, cap);
    if (idx >= 0) {
      if (hlsRef.current) hlsRef.current.currentLevel = idx;
      setSelectedLevel(idx);
    }
  }, [prefsLoaded, qualityLevels, prefs.qualityCap]);

  // Video event listeners — progress writes, TV transport state, time mirroring.
  // Loading / error / reconnecting are owned by the recovery hook now, so this
  // listener no longer touches them (no onError reload, no onWait/onCanPlay
  // loading toggles).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentVideo) return undefined;

    const onPlay = () => {
      setTvPaused(false);
      clearInterval(progressRef.current);
      progressRef.current = setInterval(() => {
        if (video && !video.paused && currentVideo) {
          setTvCurrentTime(video.currentTime);
          updateWatchProgress(
            currentVideo.streamId,
            currentVideo.type,
            video.currentTime,
            Number.isFinite(video.duration) ? video.duration : 0,
          );
        }
      }, 1000);
    };
    const onPause = () => {
      setTvPaused(true);
      if (currentVideo)
        updateWatchProgress(
          currentVideo.streamId,
          currentVideo.type,
          video.currentTime,
          Number.isFinite(video.duration) ? video.duration : 0,
        );
    };
    const onDurationChange = () => {
      if (Number.isFinite(video.duration)) setTvDuration(video.duration);
    };
    const onTimeUpdate = () => {
      setTvCurrentTime(video.currentTime);
      // Keep the OS media-controls scrubber in sync (VOD only; live has no duration).
      if (!isLive && Number.isFinite(video.duration)) {
        setMediaSessionPosition({
          duration: video.duration,
          position: video.currentTime,
          playbackRate: video.playbackRate,
        });
      }
    };

    // Transient buffering: 'waiting' means the element ran out of data and is
    // rebuffering; 'playing'/'canplay' mean data is flowing again. This drives
    // only the spinner — NOT the recovery machine — so ordinary rebuffering no
    // longer flashes "reconnecting" or forces a reload.
    const onWaiting = () => {
      if (!video.paused && !video.ended) setIsBuffering(true);
    };
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setIsBuffering(false);

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
    };
  }, [currentVideo, updateWatchProgress, isLive]);

  // Flush progress on teardown — tab hide / app backgrounding is the most
  // common resume-loss case (the unmount cleanup never runs on a hard kill).
  // Push the current position via updateWatchProgress + the synchronous flush.
  useEffect(() => {
    if (!currentVideo) return undefined;
    const flushNow = () => {
      const video = videoRef.current;
      if (video) {
        updateWatchProgress(
          currentVideo.streamId,
          currentVideo.type,
          video.currentTime,
          Number.isFinite(video.duration) ? video.duration : 0,
        );
      }
      flushProgress();
    };
    const onVisibility = () => {
      if (document.hidden) flushNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushNow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushNow);
    };
  }, [currentVideo, updateWatchProgress, flushProgress]);

  // (Keyboard shortcuts effect is declared further down, after the channel-zap /
  // PiP / applySpeed handlers it depends on, to avoid a temporal-dead-zone ref.)

  // Close dropdowns on outside click (web only)
  useEffect(() => {
    if (isTV) return undefined;
    if (!openMenu) return undefined;
    const onClick = (e) => {
      if (
        ![qualityRef, speedRef, audioRef, subtitleRef, aspectRef, moreRef].some((r) =>
          r.current?.contains(e.target),
        )
      ) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [openMenu]);

  // Next-episode auto-advance — fire when the media reaches its end.
  // Next episode helpers
  const getNextEpisode = useCallback(() => {
    if (
      !currentVideo ||
      currentVideo.type !== "series" ||
      !currentVideo.seriesSeasons
    )
      return null;
    const all = Object.keys(currentVideo.seriesSeasons)
      .map(Number)
      .sort((a, b) => a - b)
      .flatMap((s) =>
        [...(currentVideo.seriesSeasons[String(s)] || [])]
          .sort((a, b) => Number(a.episode_num) - Number(b.episode_num))
          .map((ep) => ({ ...ep, seasonNum: String(s) })),
      );
    const idx = all.findIndex(
      (ep) => String(ep.id) === String(currentVideo.streamId),
    );
    if (idx < 0 || idx >= all.length - 1) return null;
    const next = all[idx + 1];
    return { episode: next, seasonNum: next.seasonNum };
  }, [currentVideo]);

  const handleNextEpisode = useCallback(() => {
    const next = getNextEpisode();
    if (!next) return;
    const { episode, seasonNum } = next;
    const url = iptvApi.buildStreamUrl(
      "series",
      episode.id,
      episode.container_extension || "mp4",
    );
    const ep = String(episode.episode_num).padStart(2, "0");
    const sn = String(seasonNum).padStart(2, "0");
    playVideo({
      type: "series",
      streamId: String(episode.id),
      seriesId: currentVideo.seriesId,
      seriesName: currentVideo.seriesName,
      name: `${currentVideo.seriesName} - S${sn}E${ep}`,
      url,
      seasonNum,
      episodeNum: episode.episode_num,
      seriesSeasons: currentVideo.seriesSeasons,
    });
  }, [getNextEpisode, currentVideo, playVideo]);

  // Auto-advance to the next episode when playback ends (series only).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentVideo) return undefined;
    const onEnded = () => {
      if (currentVideo.type === "series" && getNextEpisode()) handleNextEpisode();
    };
    video.addEventListener("ended", onEnded);
    return () => video.removeEventListener("ended", onEnded);
  }, [currentVideo, getNextEpisode, handleNextEpisode]);

  const getLevelLabel = (level, levels) => {
    if (!level.height) return `${Math.round(level.bitrate / 1000)}k`;
    return levels.filter((l) => l.height === level.height).length > 1
      ? `${level.height}p (${Math.round(level.bitrate / 1000)}k)`
      : `${level.height}p`;
  };

  // Apply a manual quality pick: set the hls level directly (preserving the
  // original behavior) AND set the hook's manualCap so auto-downgrade never
  // restores above the user's chosen quality. levelIdx === -1 means Auto.
  const handleSelectLevel = useCallback((levelIdx) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIdx;
    }
    setSelectedLevel(levelIdx);
    let cap;
    if (levelIdx === -1) {
      cap = "auto";
    } else {
      const lvl = qualityLevels[levelIdx];
      cap = heightToCap(lvl?.height);
    }
    setManualCap(cap);
    setPref("qualityCap", cap);
    setOpenMenu(null);
  }, [qualityLevels, setPref]);

  // Centralized, persistence-aware setters (used by both menus and shortcuts).
  const applySpeed = useCallback((r) => {
    if (videoRef.current) videoRef.current.playbackRate = r;
    setPlaybackRate(r);
    setPref("playbackSpeed", r);
  }, [setPref]);

  const applyAudio = useCallback((i) => {
    if (hlsRef.current) hlsRef.current.audioTrack = i;
    setSelectedAudio(i);
    setPref("audioTrack", audioTracks[i]?.name ?? i);
  }, [setPref, audioTracks]);

  const applySubtitle = useCallback((i) => {
    if (hlsRef.current) hlsRef.current.subtitleTrack = i;
    setSelectedSubtitle(i);
    setPref("subtitleTrack", i === -1 ? "off" : (subtitleTracks[i]?.name ?? i));
  }, [setPref, subtitleTracks]);

  const applyAspect = useCallback((value) => {
    setAspectRatio(value);
    setPref("aspectRatio", value);
  }, [setPref]);

  // SubtitleSettings onChange: persist subtitle style + a/v offsets via prefs.
  const handleSubtitleSettingsChange = useCallback((partial) => {
    if (partial.style) {
      setPref("subtitleStyle", { ...subtitleStyle, ...partial.style });
    }
    if ("subtitleOffsetMs" in partial) {
      setPref("subtitleOffsetMs", clampOffset(Number(partial.subtitleOffsetMs) || 0));
    }
    if ("audioOffsetMs" in partial) {
      setPref("audioOffsetMs", clampOffset(Number(partial.audioOffsetMs) || 0));
    }
  }, [setPref, subtitleStyle]);

  // ── PiP / Cast ──────────────────────────────────────────────────────────────
  const handleTogglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPipActive(video)) {
      await exitPip();
    } else {
      await enterPip(video);
    }
    setPipActive(isPipActive(video));
  }, []);

  const handleCast = useCallback(async () => {
    const video = videoRef.current;
    if (video && isRemotePlaybackSupported(video)) {
      await promptRemotePlayback(video);
    }
    // If only the Cast SDK is present (no Remote Playback), there's nothing we
    // can prompt without the framework UI; the button still surfaces presence.
  }, []);

  // ── Live: channel list + zap ────────────────────────────────────────────────
  // Live channels in stable order, restricted to entries that carry a stream_id
  // (the zap helpers key on stream_id). Falls back to the full channels list.
  const liveChannelList = useMemo(
    () => (Array.isArray(channels) ? channels.filter((c) => c && (c.stream_id ?? c.id) != null) : []),
    [channels],
  );

  const zapToChannel = useCallback(
    (ch) => {
      if (!ch) return;
      const sid = ch.stream_id ?? ch.id;
      const url = ch.url || iptvApi.buildStreamUrl("live", sid, ch.stream_type || "ts");
      playVideo({ type: "live", streamId: sid, name: ch.name, url });
      storage.setItem(LAST_CHANNEL_KEY, String(sid)).catch(() => {});
    },
    [playVideo],
  );

  const handleChannelUp = useCallback(() => {
    if (!isLive) return;
    const sid = currentVideo?.streamId;
    zapToChannel(nextChannel(liveChannelList, sid));
  }, [isLive, currentVideo, liveChannelList, zapToChannel]);

  const handleChannelDown = useCallback(() => {
    if (!isLive) return;
    const sid = currentVideo?.streamId;
    zapToChannel(prevChannel(liveChannelList, sid));
  }, [isLive, currentVideo, liveChannelList, zapToChannel]);

  // Keyboard shortcuts (desktop + TV remote). Declared here — after the channel,
  // PiP and speed handlers it references — so none are in the temporal dead zone.
  useEffect(() => {
    const onKey = (e) => {
      if (!currentVideo || !videoRef.current) return;
      const video = videoRef.current;
      const k = e.keyCode || e.which;

      if (isTV) showTvControls();

      // Block D-pad UP/DOWN from moving browser focus to overlay buttons on TV.
      // For LIVE on TV, repurpose Up/Down as channel zap (ch+/ch-).
      if (isTV && (k === 38 || k === 40)) {
        e.preventDefault();
        if (isLive) {
          if (k === 38) handleChannelUp();
          else handleChannelDown();
        }
        return;
      }
      // Dedicated channel +/- remote keys (where present): 427 = ch up, 428 = ch down.
      if (isLive && (k === 427 || k === 428)) {
        e.preventDefault();
        if (k === 427) handleChannelUp();
        else handleChannelDown();
        return;
      }

      // TV remote-specific keys
      if (TV_KEYS.BACK.has(k)) {
        e.preventDefault();
        handleClose();
        return;
      }
      if (k === TV_KEYS.PLAY) {
        e.preventDefault();
        video.play();
        return;
      }
      if (k === TV_KEYS.PAUSE) {
        e.preventDefault();
        video.pause();
        return;
      }
      if (k === TV_KEYS.FF) {
        e.preventDefault();
        video.currentTime += 30;
        return;
      }
      if (k === TV_KEYS.REW) {
        e.preventDefault();
        video.currentTime -= 30;
        return;
      }

      switch (e.key) {
        case "Enter":
          e.preventDefault();
          video.paused ? video.play() : video.pause();
          break;
        case " ":
        case "k":
          e.preventDefault();
          e.stopPropagation();
          video.paused ? video.play() : video.pause();
          break;
        case "f":
          e.preventDefault();
          document.fullscreenElement
            ? document.exitFullscreen()
            : video.requestFullscreen();
          break;
        case "Escape":
          if (!isTV) handleClose();
          break;
        case "ArrowLeft":
          e.preventDefault();
          video.currentTime -= 10;
          break;
        case "ArrowRight":
          e.preventDefault();
          video.currentTime += 10;
          break;
        case "ArrowUp":
          e.preventDefault();
          if (isLive) handleChannelUp();
          else if (!isTV) video.volume = Math.min(1, video.volume + 0.1);
          break;
        case "ArrowDown":
          e.preventDefault();
          if (isLive) handleChannelDown();
          else if (!isTV) video.volume = Math.max(0, video.volume - 0.1);
          break;
        case "[": {
          e.preventDefault();
          const i = SPEEDS.indexOf(video.playbackRate);
          applySpeed(SPEEDS[Math.max(0, (i < 0 ? SPEEDS.indexOf(1) : i) - 1)]);
          break;
        }
        case "]": {
          e.preventDefault();
          const i = SPEEDS.indexOf(video.playbackRate);
          applySpeed(
            SPEEDS[Math.min(SPEEDS.length - 1, (i < 0 ? SPEEDS.indexOf(1) : i) + 1)],
          );
          break;
        }
        case "p":
        case "P":
          e.preventDefault();
          handleTogglePip();
          break;
        case "i":
        case "I":
          e.preventDefault();
          setShowStats((v) => !v);
          break;
        default:
          break;
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [currentVideo, handleClose, showTvControls, isLive, handleChannelUp, handleChannelDown, applySpeed, handleTogglePip]);

  // Remember the last live channel on open + fetch EPG now/next.
  useEffect(() => {
    if (!isLive || !currentVideo?.streamId) return undefined;
    storage.setItem(LAST_CHANNEL_KEY, String(currentVideo.streamId)).catch(() => {});
    let cancelled = false;
    fetchNowNext(iptvApi, currentVideo.streamId)
      .then((nn) => { if (!cancelled) setNowNext(nn || { now: null, next: null }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isLive, currentVideo?.streamId]);

  // ── Subtitle styling: inject a scoped ::cue rule from the remembered style ───
  // DOM ::cue properties aren't settable inline, so we drive them off a one-off
  // <style> element kept in sync with the subtitle-style preference.
  const cueStyleElRef = useRef(/** @type {HTMLStyleElement|null} */ (null));
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    let el = cueStyleElRef.current;
    if (!el) {
      el = document.createElement("style");
      el.setAttribute("data-lumen-cue", "1");
      document.head.appendChild(el);
      cueStyleElRef.current = el;
    }
    const css = toCssTextTrackStyle(subtitleStyle);
    el.textContent =
      `video::cue{` +
      `color:${css.color};` +
      `background-color:${css.backgroundColor};` +
      `font-size:${css.fontSize};` +
      `text-shadow:${css.textShadow};` +
      `}`;
    return undefined;
  }, [subtitleStyle]);

  useEffect(() => {
    return () => {
      const el = cueStyleElRef.current;
      if (el && el.parentNode) el.parentNode.removeChild(el);
      cueStyleElRef.current = null;
    };
  }, []);

  // ── Subtitle delay offset: shift active text-track cue timings ───────────────
  // We can't ask hls.js to re-time cues, but we can nudge the rendered cue
  // start/end on the active TextTrack. Re-applied whenever the offset or the
  // selected subtitle changes. NOTE: audioOffsetMs is persisted and surfaced in
  // the UI, but neither the HTML <video> element nor hls.js exposes an a/v sync
  // delay we can drive on the web, so audio offset is a no-op here (documented).
  const appliedSubOffsetRef = useRef(0);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.textTracks) return undefined;
    const deltaSec = (subtitleOffsetMs - appliedSubOffsetRef.current) / 1000;
    if (deltaSec === 0) return undefined;

    const shiftActive = () => {
      for (let i = 0; i < video.textTracks.length; i++) {
        const tt = video.textTracks[i];
        if (tt.mode === "disabled") continue;
        const cues = tt.cues;
        if (!cues) continue;
        for (let c = 0; c < cues.length; c++) {
          const cue = cues[c];
          // Clamp to non-negative; a cue can't start before 0.
          cue.startTime = Math.max(0, cue.startTime + deltaSec);
          cue.endTime = Math.max(cue.startTime, cue.endTime + deltaSec);
        }
      }
    };
    shiftActive();
    appliedSubOffsetRef.current = subtitleOffsetMs;
    return undefined;
  }, [subtitleOffsetMs, selectedSubtitle, subtitleTracks]);

  // Reset the applied-offset baseline when the source changes.
  useEffect(() => { appliedSubOffsetRef.current = 0; }, [currentVideo?.url]);

  // ── MediaSession metadata + action handlers (OS media controls/lockscreen) ──
  useEffect(() => {
    if (!currentVideo) return undefined;
    setMediaSessionMetadata({
      title: currentVideo.name || "",
      artist: currentVideo.seriesName || (isLive ? "Live" : ""),
      artwork: currentVideo.cover ? [{ src: currentVideo.cover, sizes: "512x512" }] : [],
    });
    const applied = setMediaSessionHandlers({
      play: () => { videoRef.current?.play(); },
      pause: () => { videoRef.current?.pause(); },
      seekbackward: (d) => {
        const v = videoRef.current; if (v) v.currentTime -= (d?.seekOffset || 10);
      },
      seekforward: (d) => {
        const v = videoRef.current; if (v) v.currentTime += (d?.seekOffset || 10);
      },
      nexttrack: isLive ? handleChannelUp : (nextEpisodeAvailableRef.current ? handleNextEpisodeRef.current : null),
      previoustrack: isLive ? handleChannelDown : null,
    });
    return () => {
      // Clear the handlers we set so a stale closure can't fire after teardown.
      const clear = {};
      for (const a of applied) clear[a] = null;
      setMediaSessionHandlers(clear);
    };
  }, [currentVideo, isLive, handleChannelUp, handleChannelDown]);

  // Keep pipActive in sync with the browser (covers native exit from the PiP
  // window's own controls).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const onEnter = () => setPipActive(true);
    const onLeave = () => setPipActive(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [currentVideo?.url]);

  // ── Stats gathering (only while the overlay is shown) ───────────────────────
  useEffect(() => {
    if (!showStats) return undefined;
    const collect = () => {
      const video = videoRef.current;
      const hls = hlsRef.current;
      if (!video) return;
      let resolution;
      if (video.videoWidth && video.videoHeight) {
        resolution = `${video.videoWidth}x${video.videoHeight}`;
      }
      let levelLabel;
      let bitrateKbps;
      if (hls && Array.isArray(hls.levels) && hls.currentLevel >= 0) {
        const lvl = hls.levels[hls.currentLevel];
        if (lvl) {
          levelLabel = lvl.height ? `${lvl.height}p` : `${Math.round((lvl.bitrate || 0) / 1000)}k`;
          if (lvl.bitrate) bitrateKbps = Math.round(lvl.bitrate / 1000);
        }
      } else if (hls && hls.autoLevelEnabled) {
        levelLabel = "auto";
      }
      let bufferSec;
      try {
        const b = video.buffered;
        if (b && b.length) bufferSec = Math.max(0, b.end(b.length - 1) - video.currentTime);
      } catch { /* ignore */ }
      let droppedFrames;
      let fps;
      try {
        if (typeof video.getVideoPlaybackQuality === "function") {
          const q = video.getVideoPlaybackQuality();
          droppedFrames = q.droppedVideoFrames;
        }
      } catch { /* ignore */ }
      let connectionType;
      try {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn && conn.effectiveType) connectionType = conn.effectiveType;
      } catch { /* ignore */ }
      setStats({ resolution, levelLabel, bitrateKbps, bufferSec, droppedFrames, fps, connectionType });
    };
    collect();
    const id = setInterval(collect, 1000);
    return () => clearInterval(id);
  }, [showStats]);

  // ── Sleep timer: keep MediaSession position fresh + nothing else here. The
  // countdown lives in useSleepTimer; the elapse handler pauses + closes.
  // (No effect needed beyond the hook; the control lives in the overlay/menu.)

  const getVideoStyle = useMemo(() => {
    const base = { ...S.video };
    if (aspectRatio === "16:9")
      return {
        ...base,
        width: "auto",
        height: "100%",
        maxWidth: "100%",
        aspectRatio: "16/9",
        objectFit: "fill",
      };
    if (aspectRatio === "4:3")
      return {
        ...base,
        width: "auto",
        height: "100%",
        maxWidth: "100%",
        aspectRatio: "4/3",
        objectFit: "fill",
      };
    if (aspectRatio === "fill") return { ...base, objectFit: "cover" };
    if (aspectRatio === "stretch") return { ...base, objectFit: "fill" };
    return base;
  }, [aspectRatio]);

  // Persist aspect-ratio choice to localStorage (lumen_settings.defaultAspect).
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("lumen_settings") || "{}");
      if (s.defaultAspect !== aspectRatio) {
        localStorage.setItem(
          "lumen_settings",
          JSON.stringify({ ...s, defaultAspect: aspectRatio }),
        );
      }
    } catch { /* ignore */ }
  }, [aspectRatio]);

  // Memoize so we don't recompute the next-episode lookup on every render
  // (e.g. each 1s progress tick). getNextEpisode is stable per currentVideo.
  const nextEpisode = useMemo(() => getNextEpisode(), [getNextEpisode]);

  // Mirror the next-episode handler + availability into refs for the
  // MediaSession effect declared earlier in the component.
  useEffect(() => {
    handleNextEpisodeRef.current = handleNextEpisode;
    nextEpisodeAvailableRef.current = !!nextEpisode;
  }, [handleNextEpisode, nextEpisode]);

  if (!currentVideo) return null;

  const pct =
    tvDuration > 0 ? Math.min((tvCurrentTime / tvDuration) * 100, 100) : 0;

  // Offscreen-but-mounted canvas holding the last decoded frame. Kept mounted so
  // captureFrame() can always draw into it; only painted on top of the (possibly
  // black, post-teardown) <video> while busy and a frame has been captured.
  const frozenFrame = (
    <canvas
      ref={frameCanvasRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "contain",
        backgroundColor: "#000",
        display: hasFrozenFrame && isBusy ? "block" : "none",
        zIndex: 12,
        pointerEvents: "none",
      }}
    />
  );

  // Single busy overlay: spinner over the last frame (or black on first load).
  // Covers initial load, transient buffering, and genuine reconnects — so
  // ordinary buffering no longer flashes a "reconnecting" pill or a black frame.
  const busyOverlay = isBusy && (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 15,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        backgroundColor: hasFrozenFrame ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.6)",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          border: "6px solid rgba(255,255,255,0.22)",
          borderTopColor: colors.accent2,
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <span style={{ color: colors.text, fontFamily: fonts.body, fontSize: 18, fontWeight: 600 }}>
        {isRecovering ? "Reconnecting…" : "Loading…"}
      </span>
    </div>
  );

  const fatalMessage =
    fatalReason === "GONE"
      ? "This stream is no longer available."
      : fatalReason === "AUTH_EXPIRED"
        ? "Stream unavailable. The server rejected the connection."
        : "The stream could not be played.";

  // ── TV render ───────────────────────────────────────────────────────────────
  if (isTV) {
    return (
      <div style={TV.overlay}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          crossOrigin="anonymous"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />

        {/* Controls overlay */}
        <div style={TV.controls(tvControlsVisible)} onClick={showTvControls}>
          {/* Top bar */}
          <div style={TV.topBar}>
            <button style={TV.closeBtn} tabIndex={-1} onClick={handleClose} aria-label="Close">
              <Icon name="back" size={26} color={colors.text} />
            </button>
            <span style={TV.title}>
              {currentVideo.name}
              {isLive && nowNext.now && (
                <span style={{ display: "block", fontSize: 18, fontWeight: 500, color: colors.accent2 }}>
                  {`NOW: ${nowNext.now.title}`}
                  {nowNext.next ? `  ·  NEXT: ${nowNext.next.title}` : ""}
                </span>
              )}
            </span>
            {/* Start over — VOD only, shown when we auto-resumed (TV has no prompt). */}
            {!isLive && resume.hasResume && startTime > 0 && (
              <button
                style={{ ...TV.nextBtn, background: "rgba(255,255,255,0.15)" }}
                tabIndex={-1}
                onClick={handleStartOver}
              >
                <Icon name="back" size={18} color={colors.text} /> Start over
              </button>
            )}
            {nextEpisode && (
              <button style={TV.nextBtn} tabIndex={-1} onClick={handleNextEpisode}>
                <Icon name="play" size={18} color={colors.text} />
                {`Next  S${String(nextEpisode.seasonNum).padStart(2, "0")}E${String(nextEpisode.episode.episode_num).padStart(2, "0")}`}
              </button>
            )}
          </div>

          {/* Center — play/pause icon (spinner is handled by the busy overlay) */}
          <div style={TV.center}>
            {isBusy ? null : (
              <span style={TV.playIcon}>
                {tvPaused ? (
                  <Icon name="play" size={80} color="rgba(255,255,255,0.9)" />
                ) : (
                  <span style={{ display: "flex", gap: 14 }}>
                    <span style={{ width: 22, height: 72, background: "rgba(255,255,255,0.9)", borderRadius: 4 }} />
                    <span style={{ width: 22, height: 72, background: "rgba(255,255,255,0.9)", borderRadius: 4 }} />
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Bottom bar — progress + time */}
          <div style={TV.bottomBar}>
            {currentVideo.type !== "live" ? (
              <>
                <div
                  style={TV.progressTrack}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = (e.clientX - rect.left) / rect.width;
                    if (videoRef.current && tvDuration > 0)
                      videoRef.current.currentTime = ratio * tvDuration;
                  }}
                >
                  <div style={TV.progressFill(pct)} />
                </div>
                <div style={TV.timeRow}>
                  <span>{fmtTime(tvCurrentTime)}</span>
                  <span style={TV.seekHint}>
                    ◀◀ -10s · OK: play/pause · +10s ▶▶
                  </span>
                  <span>{fmtTime(tvDuration)}</span>
                </div>
              </>
            ) : (
              <div style={TV.seekHint}>▲▼ Channel · OK: play/pause</div>
            )}
          </div>
        </div>

        {/* Stats overlay (toggle with 'i' on the remote/keyboard). */}
        {showStats && <StatsOverlay stats={stats} />}

        {/* Error */}
        {isFatal && (
          <div style={{ ...S.stateOverlay, zIndex: 20, backgroundColor: "rgba(0,0,0,0.85)", display: "flex", flexDirection: "column" }}>
            <StatePanel
              mode="error"
              title="Failed to load stream"
              message={fatalMessage}
              onRetry={handleRetry}
            />
            <div style={{ display: "flex", justifyContent: "center", paddingBottom: 48 }}>
              <Button variant="secondary" size="lg" icon="close" onPress={handleClose}>
                Close
              </Button>
            </div>
          </div>
        )}

        {frozenFrame}
        {busyOverlay}

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Web/desktop render ──────────────────────────────────────────────────────
  const currentQualityLabel =
    selectedLevel === -1
      ? "Auto"
      : getLevelLabel(qualityLevels[selectedLevel], qualityLevels);

  return (
    <div style={S.overlay}>
      <div style={S.header}>
        <button style={S.closeBtn} onClick={handleClose} title="Close (Esc)" aria-label="Close">
          <Icon name="close" size={16} color={colors.text} />
        </button>
        <span style={S.title}>{currentVideo.name}</span>

        <div style={S.dropdown} ref={speedRef}>
          <button style={S.btn} onClick={() => setOpenMenu((m) => m === "speed" ? null : "speed")}>
            <Icon name="play" size={13} color={colors.text} /> {playbackRate}x
          </button>
          {openMenu === "speed" && (
            <div style={S.menu}>
              {SPEEDS.map((r) => (
                <button
                  key={r}
                  style={S.menuItem(playbackRate === r)}
                  onClick={() => {
                    applySpeed(r);
                    setOpenMenu(null);
                  }}
                >
                  {r}x{r === 1 ? " (Normal)" : ""}
                </button>
              ))}
            </div>
          )}
        </div>

        {audioTracks.length > 1 && (
          <div style={S.dropdown} ref={audioRef}>
            <button style={S.btn} onClick={() => setOpenMenu((m) => m === "audio" ? null : "audio")}>
              {audioTracks[selectedAudio]?.name || "Audio"}
            </button>
            {openMenu === "audio" && (
              <div style={S.menu}>
                {audioTracks.map((t, i) => (
                  <div
                    key={t.id ?? i}
                    style={S.menuItem(selectedAudio === i)}
                    onClick={() => {
                      applyAudio(i);
                      setOpenMenu(null);
                    }}
                  >
                    {t.name || `Track ${i + 1}`}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {subtitleTracks.length > 0 && (
          <div style={S.dropdown} ref={subtitleRef}>
            <button style={S.btn} onClick={() => setOpenMenu((m) => m === "subtitle" ? null : "subtitle")}>
              CC{" "}
              {selectedSubtitle === -1
                ? "Off"
                : subtitleTracks[selectedSubtitle]?.name ||
                  `Track ${selectedSubtitle + 1}`}
            </button>
            {openMenu === "subtitle" && (
              <div style={S.menu}>
                <button
                  style={S.menuItem(selectedSubtitle === -1)}
                  onClick={() => {
                    applySubtitle(-1);
                    setOpenMenu(null);
                  }}
                >
                  Off
                </button>
                {subtitleTracks.map((t, i) => (
                  <button
                    key={t.id ?? i}
                    style={S.menuItem(selectedSubtitle === i)}
                    onClick={() => {
                      applySubtitle(i);
                      setOpenMenu(null);
                    }}
                  >
                    {t.name || `Track ${i + 1}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={S.dropdown} ref={aspectRef}>
          <button style={S.btn} onClick={() => setOpenMenu((m) => m === "aspect" ? null : "aspect")}>
            {aspectRatio === "default" ? "Aspect" : aspectRatio}
          </button>
          {openMenu === "aspect" && (
            <div style={S.menu}>
              {ASPECT_RATIOS.map(({ value, label }) => (
                <button
                  key={value}
                  style={S.menuItem(aspectRatio === value)}
                  onClick={() => {
                    applyAspect(value);
                    setOpenMenu(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {qualityLevels.length > 1 && (
          <div style={S.dropdown} ref={qualityRef}>
            <button style={S.btn} onClick={() => setOpenMenu((m) => m === "quality" ? null : "quality")}>
              <Icon name="settings" size={13} color={colors.text} /> {currentQualityLabel}
            </button>
            {openMenu === "quality" && (
              <div style={S.menu}>
                <button
                  style={S.menuItem(selectedLevel === -1)}
                  onClick={() => handleSelectLevel(-1)}
                >
                  Auto
                </button>
                {[...qualityLevels]
                  .map((l, i) => ({ l, i }))
                  .sort((a, b) => (b.l.height || 0) - (a.l.height || 0))
                  .map(({ l, i }) => (
                    <button
                      key={`${l.height}-${l.bitrate}`}
                      style={S.menuItem(selectedLevel === i)}
                      onClick={() => handleSelectLevel(i)}
                    >
                      {getLevelLabel(l, qualityLevels)}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* PiP toggle (when the browser supports it). Shortcut: 'p'. */}
        {pipSupported && (
          <button
            style={pipActive ? { ...S.btn, color: colors.accent2 } : S.btn}
            onClick={handleTogglePip}
            title="Picture-in-Picture (p)"
          >
            {pipActive ? "PiP On" : "PiP"}
          </button>
        )}

        {/* Cast / Remote Playback (when available). */}
        {castSupported && (
          <button style={S.btn} onClick={handleCast} title="Cast / AirPlay">
            Cast
          </button>
        )}

        {/* Stats overlay toggle. Shortcut: 'i'. */}
        <button
          style={{ ...S.btn, color: showStats ? colors.accent2 : colors.text }}
          onClick={() => setShowStats((v) => !v)}
          title="Stats for nerds (i)"
        >
          Stats
        </button>

        {/* More: subtitle/audio tuning + sleep timer. */}
        <div style={S.dropdown} ref={moreRef}>
          <button style={S.btn} onClick={() => setOpenMenu((m) => (m === "more" ? null : "more"))}>
            {sleep.active ? formatRemaining(sleep.secondsLeft) : "More"}
          </button>
          {openMenu === "more" && (
            <div style={{ ...S.menu, minWidth: 300, padding: 0, maxHeight: 520 }}>
              <SubtitleSettings
                style={subtitleStyle}
                subtitleOffsetMs={subtitleOffsetMs}
                audioOffsetMs={audioOffsetMs}
                onChange={handleSubtitleSettingsChange}
              />
              <div style={{ padding: "10px 12px", borderTop: `1px solid ${colors.border}` }}>
                <div style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13, marginBottom: 8 }}>
                  Sleep timer
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {SLEEP_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      style={S.menuItem(false)}
                      onClick={() => {
                        if (p.kind === "end-of-episode") {
                          // No fixed duration: arm a long timer the end-of-media
                          // handler can cancel; simplest is to cancel any timer
                          // and rely on the 'ended' auto-advance/close.
                          sleep.cancel();
                        } else if (p.minutes) {
                          sleep.start(p.minutes);
                        }
                        setOpenMenu(null);
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                  {sleep.active && (
                    <button
                      style={{ ...S.menuItem(false), color: colors.danger }}
                      onClick={() => { sleep.cancel(); setOpenMenu(null); }}
                    >
                      Cancel timer
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {nextEpisode && (
          <button
            style={S.nextBtn}
            onClick={handleNextEpisode}
            title={`Next: S${String(nextEpisode.seasonNum).padStart(2, "0")}E${String(nextEpisode.episode.episode_num).padStart(2, "0")}`}
          >
            Next <Icon name="play" size={13} color={colors.text} />
          </button>
        )}
      </div>

      {/* Live EPG now/next strip. */}
      {isLive && (nowNext.now || nowNext.next) && (
        <div
          style={{
            display: "flex",
            gap: 16,
            padding: "4px 12px 8px",
            backgroundColor: "rgba(0,0,0,0.7)",
            color: colors.text,
            fontFamily: fonts.body,
            fontSize: 12,
            flexShrink: 0,
            alignItems: "center",
          }}
        >
          {nowNext.now && (
            <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
              <strong style={{ color: colors.accent2 }}>NOW</strong>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {nowNext.now.title}
              </span>
              {typeof nowNext.now.progressPct === "number" && (
                <span style={{ color: colors.muted }}>{nowNext.now.progressPct}%</span>
              )}
            </span>
          )}
          {nowNext.next && (
            <span style={{ color: colors.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <strong>NEXT</strong> {nowNext.next.title}
            </span>
          )}
        </div>
      )}

      <div style={S.videoWrapper}>
        <video
          ref={videoRef}
          controls={!isBusy}
          autoPlay
          playsInline
          crossOrigin="anonymous"
          style={getVideoStyle}
        >
          <track kind="captions" />
        </video>
        {frozenFrame}
        {showStats && <StatsOverlay stats={stats} />}
        {/* Resume prompt (VOD, web). Held until the user chooses. */}
        <ResumePrompt
          visible={resumePending && !isLive}
          resumeTime={resume.resumeTime}
          percent={resume.percent}
          onResume={() => resolveResume("resume")}
          onStartOver={() => resolveResume("startOver")}
        />
        {isFatal && (
          <div style={{ ...S.stateOverlay, backgroundColor: "rgba(0,0,0,0.85)", display: "flex", flexDirection: "column" }}>
            <StatePanel
              mode="error"
              title="Failed to load stream"
              message={fatalMessage}
              onRetry={handleRetry}
            />
            <div style={{ display: "flex", justifyContent: "center", paddingBottom: 24 }}>
              <Button variant="secondary" size="md" icon="close" onPress={handleClose}>
                Close
              </Button>
            </div>
          </div>
        )}
        {busyOverlay}
      </div>

      <div style={S.footer}>
        Space/K: Play/Pause · F: Fullscreen · ←→: Seek ·{" "}
        {isLive ? "↑↓: Channel" : "↑↓: Volume"} · [ ]: Speed · P: PiP · I: Stats ·
        Esc: Close
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
