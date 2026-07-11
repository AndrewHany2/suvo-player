import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useApp, usePlayback, useWatchHistory } from "../context/AppContext";
import iptvApi from "../services/iptvApi";
import { contentService } from "../domain/services/ContentService";
import { createHlsDriver, createHlsInstance } from "./drivers/hlsDriver";
import { useResilientPlayback } from "./useResilientPlayback";
import { usePlayerPreferences } from "./usePlayerPreferences";
import { useResumePosition } from "./useResumePosition";
import { useSleepTimer } from "./useSleepTimer";
import {
  DEFAULT_SUBTITLE_STYLE,
  clampOffset,
} from "./subtitleStyle";
import { nextChannel, prevChannel, fetchNowNext } from "./liveExtras";
import { findNextEpisode, buildNextEpisodeVideo } from "./episodeNav";
import {
  DEFAULT_VIDEO_ADJUST,
  normalizeAdjust,
  buildVideoFilter,
} from "./videoAdjust";
import {
  exitPip,
  isPipActive,
  setMediaSessionMetadata,
  setMediaSessionHandlers,
  setMediaSessionPosition,
} from "./mediaCapabilities";
import {
  usePictureInPicture,
  useWebVideoControls,
  useSubtitleRendering,
  useVideoStats,
} from "./playerFeatures";
import storage from "../utils/storage";

/** Namespaced storage key remembering the last live channel stream_id. */
const LAST_CHANNEL_KEY = "suvo_last_live_channel";

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
export const ASPECT_RATIOS = [
  { value: "default", label: "Default" },
  { value: "16:9", label: "16:9" },
  { value: "4:3", label: "4:3" },
  { value: "fill", label: "Fill" },
  { value: "stretch", label: "Stretch" },
];

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

export function getLevelLabel(level, levels) {
  if (!level.height) return `${Math.round(level.bitrate / 1000)}k`;
  return levels.filter((l) => l.height === level.height).length > 1
    ? `${level.height}p (${Math.round(level.bitrate / 1000)}k)`
    : `${level.height}p`;
}

/**
 * Shared player "brain" for the web (hls.js) VideoPlayerScreen variants. Holds
 * every piece of isTV-agnostic state, the playback-hook composition, the
 * source/resume machinery, remembered-preference application, the media-element
 * event wiring, and the persistence-aware setters. The .web and .tv screens
 * consume this and layer on their own view + input (pointer controls vs D-pad).
 *
 * @param {object} opts
 * @param {boolean} opts.isTV  Selects the TV-tuned hls.js config, TV auto-resume
 *   (vs the web resume prompt), and is forwarded to the driver.
 * @param {(cb: () => void) => void} [opts.onSleepElapsed]  Wrapper letting the
 *   view run view-specific teardown when the sleep timer elapses; called with
 *   the shared close handler. Defaults to just invoking it.
 */
export function usePlayer({ isTV, onSleepElapsed } = {}) {
  const { channels } = useApp();
  const { currentVideo, closeVideo, playVideo } = usePlayback();
  const { updateWatchProgress, addToWatchHistory, flushProgress } = useWatchHistory();

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const progressRef = useRef(null);

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
      return JSON.parse(localStorage.getItem("suvo_settings") || "{}").defaultAspect || "default";
    } catch { return "default"; }
  });

  // Picture adjustment (brightness / contrast) — applied as a CSS filter on the
  // <video> by the web/TV screens. Percentages, 100 = neutral. Persisted via prefs.
  const [videoAdjust, setVideoAdjust] = useState(DEFAULT_VIDEO_ADJUST);
  const videoFilter = useMemo(() => buildVideoFilter(videoAdjust), [videoAdjust]);

  const [tvCurrentTime, setTvCurrentTime] = useState(0);
  const [tvDuration, setTvDuration] = useState(0);
  const [tvPaused, setTvPaused] = useState(false);

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

  // Stats overlay toggle (the gathered snapshot lives in useVideoStats).
  const [showStats, setShowStats] = useState(false);

  const openMenuRef = useRef(null);
  const pausedRef = useRef(false);

  // EPG now/next for live.
  const [nowNext, setNowNext] = useState({ now: null, next: null });

  // Sleep timer: pause + close when it elapses.
  const handleCloseRef = useRef(null);
  const handleSleepElapsed = useCallback(() => {
    const video = videoRef.current;
    if (video) video.pause();
    const close = () => handleCloseRef.current?.();
    if (onSleepElapsed) onSleepElapsed(close);
    else close();
  }, [onSleepElapsed]);
  const sleep = useSleepTimer(handleSleepElapsed);
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
      // Construction + listener wiring lives in the driver (createHlsInstance) so
      // hls.js's constructor and Events stay inside the engine boundary; here we
      // just own the instance lifecycle (the ref + destroy-on-reload) and map the
      // engine's track events onto React state.
      const hls = createHlsInstance({
        isTV,
        onManifestParsed: (levels) => setQualityLevels(levels),
        onAudioTracksUpdated: (tracks, activeId) => {
          setAudioTracks(tracks);
          setSelectedAudio(Math.max(0, activeId));
        },
        onAudioTrackSwitched: (id) => setSelectedAudio(id),
        onSubtitleTracksUpdated: (tracks) => setSubtitleTracks(tracks),
        onSubtitleTrackSwitch: (id) => setSelectedSubtitle(id),
      });
      hlsRef.current = hls;
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
    [currentVideo?.url], // eslint-disable-line react-hooks/exhaustive-deps
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
    setNowNext({ now: null, next: null });

    if (currentVideo.type !== "live") {
      addToWatchHistory({
        ...currentVideo,
        currentTime: currentVideo.startTime || 0,
      });
    }

    return () => {
      stopProgress();
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      // Stop the media element itself. hls.destroy() detaches MSE, but on the
      // native-src path (direct VOD / Safari HLS) nothing pauses the element, and
      // a detached <video> isn't paused synchronously — so audio can keep playing
      // in the background. Pause, drop the source, and force a reload to release
      // it. Also exit Picture-in-Picture so a floating window can't outlive close.
      if (isPipActive(video)) exitPip().catch(() => {});
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch { /* element already gone */ }
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

    if (prefs.videoAdjust) setVideoAdjust(normalizeAdjust(prefs.videoAdjust));
  }, [prefsLoaded, currentVideo, prefs.aspectRatio, prefs.playbackSpeed, prefs.qualityCap, prefs.videoAdjust]);

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

  // ── Next-episode auto-advance ───────────────────────────────────────────────
  const getNextEpisode = useCallback(() => findNextEpisode(currentVideo), [currentVideo]);

  const handleNextEpisode = useCallback(() => {
    const video = buildNextEpisodeVideo(
      getNextEpisode(),
      currentVideo,
      (id, ext) => contentService.buildEpisodeUrl(id, ext),
    );
    if (video) playVideo(video);
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

  // Picture adjustment: merge a partial {brightness?, contrast?} into the
  // current value (clamped), apply live via the derived filter, and persist.
  const applyVideoAdjust = useCallback((partial) => {
    setVideoAdjust((prev) => {
      const next = normalizeAdjust({ ...prev, ...partial });
      setPref("videoAdjust", next);
      return next;
    });
  }, [setPref]);

  const resetVideoAdjust = useCallback(() => {
    setVideoAdjust(DEFAULT_VIDEO_ADJUST);
    setPref("videoAdjust", DEFAULT_VIDEO_ADJUST);
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

  // ── PiP / Cast + web custom controls (extracted to playerFeatures) ───────────
  const { pipActive, pipSupported, castSupported, handleTogglePip, handleCast } =
    usePictureInPicture({ videoRef, sourceKey: currentVideo?.url });
  const { volume, muted, togglePlayWeb, seekWebToClientX, applyVolumeWeb, toggleMuteWeb } =
    useWebVideoControls({ videoRef, duration: tvDuration, sourceKey: currentVideo?.url });

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
      const url = ch.url || contentService.buildLiveUrl(sid, ch.stream_type || "ts");
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

  // ── Subtitle rendering: ::cue styling + delay offset (extracted) ─────────────
  useSubtitleRendering({
    videoRef,
    subtitleStyle,
    subtitleOffsetMs,
    selectedSubtitle,
    subtitleTracks,
    sourceKey: currentVideo?.url,
  });

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

  // ── Stats overlay gathering (extracted to useVideoStats) ─────────────────────
  const stats = useVideoStats({ showStats, videoRef, hlsRef });

  // Persist aspect-ratio choice to localStorage (suvo_settings.defaultAspect).
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("suvo_settings") || "{}");
      if (s.defaultAspect !== aspectRatio) {
        localStorage.setItem(
          "suvo_settings",
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

  const fatalMessage =
    fatalReason === "GONE"
      ? "This stream is no longer available."
      : fatalReason === "AUTH_EXPIRED"
        ? "Stream unavailable. The server rejected the connection."
        : "The stream could not be played.";

  const pct =
    tvDuration > 0 ? Math.min((tvCurrentTime / tvDuration) * 100, 100) : 0;

  // Keep the shared menu-open / paused refs current for callers that read them
  // from event handlers registered once (web idle-hide, TV keydown).
  openMenuRef.current = openMenu;
  pausedRef.current = tvPaused;

  return {
    // Context passthrough
    currentVideo,
    isLive,
    // Refs the view attaches to DOM nodes
    videoRef,
    frameCanvasRef,
    openMenuRef,
    pausedRef,
    // Playback status
    isBusy,
    isRecovering,
    isFatal,
    fatalReason,
    fatalMessage,
    hasFrozenFrame,
    // Track / quality / speed / aspect state
    qualityLevels,
    selectedLevel,
    playbackRate,
    audioTracks,
    selectedAudio,
    subtitleTracks,
    selectedSubtitle,
    aspectRatio,
    manualCap,
    // Picture adjustment (brightness / contrast)
    videoAdjust,
    videoFilter,
    // Menu + transport UI state
    openMenu,
    setOpenMenu,
    tvCurrentTime,
    tvDuration,
    tvPaused,
    pct,
    // Web custom-controls mirror
    volume,
    muted,
    // Capability flags
    pipSupported,
    castSupported,
    pipActive,
    // Stats
    showStats,
    setShowStats,
    stats,
    // Resume
    resume,
    startTime,
    resumePending,
    resolveResume,
    handleStartOver,
    // EPG
    nowNext,
    // Preferences / offsets
    subtitleStyle,
    subtitleOffsetMs,
    audioOffsetMs,
    // Sleep timer
    sleep,
    // Next episode
    nextEpisode,
    handleNextEpisode,
    // Handlers
    handleClose,
    handleRetry,
    handleSelectLevel,
    applySpeed,
    applyAudio,
    applySubtitle,
    applyAspect,
    applyVideoAdjust,
    resetVideoAdjust,
    handleSubtitleSettingsChange,
    handleTogglePip,
    handleCast,
    togglePlayWeb,
    seekWebToClientX,
    applyVolumeWeb,
    toggleMuteWeb,
    handleChannelUp,
    handleChannelDown,
    // Helper (label formatting) — re-exported for convenience
    getLevelLabel,
  };
}
