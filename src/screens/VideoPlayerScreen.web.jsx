import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { usePlayer, SPEEDS, ASPECT_RATIOS } from "../playback/usePlayer";
import { ADJUST_MIN, ADJUST_MAX, ADJUST_STEP } from "../playback/videoAdjust";
import { SLEEP_PRESETS, formatRemaining } from "../playback/useSleepTimer";
import { isMacCommand } from "../platform/adapters/input/keys";
import ResumePrompt from "../playback/components/ResumePrompt";
import SubtitleSettings from "../playback/components/SubtitleSettings";
import StatsOverlay from "../playback/components/StatsOverlay";
import Icon from "../ui/Icon";
import StatePanel from "../ui/StatePanel";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import { formatDuration as fmtTime } from "../utils/formatDuration";
import {
  colors,
  accentAlpha,
  accent2Alpha,
  radii,
  fonts,
} from "../ui/tokens";

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
  // Resting fill stays on the neutral translucent-white wash over the video;
  // IconButton layers the cyan focus/hover glow (Single-Light — no indigo at rest).
  closeBtn: {
    backgroundColor: "rgba(255,255,255,0.12)",
    border: "none",
    color: colors.text,
    borderRadius: "50%",
    width: 44,
    height: 44,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  nextBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: accentAlpha(0.9),
    border: "none",
    color: colors.text,
    borderRadius: radii.sm,
    minHeight: 44,
    padding: "6px 12px",
    fontSize: 12,
    fontFamily: fonts.body,
    fontWeight: 600,
    cursor: "pointer",
  },
  dropdown: { position: "relative" },
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
    color: active ? colors.accentText : colors.muted,
    fontWeight: active ? 700 : 400,
    backgroundColor: active ? accentAlpha(0.12) : "transparent",
  }),
  // Bottom control cluster overlaid on the video (a real-player control bar).
  // Holds the settings icon row on top and our own seek/time bar beneath it.
  controlsOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 16,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "40px 16px 12px",
    background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)",
  },
  // Settings icon row (top of the cluster), right-aligned.
  bottomBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    flexWrap: "wrap",
  },
  // Seek/time row (bottom of the cluster): play, track, times, volume.
  ctrlBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  playBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: "50%",
    border: "none",
    backgroundColor: "rgba(255,255,255,0.15)",
    color: colors.text,
    cursor: "pointer",
  },
  // Hit area: a taller transparent wrapper so the pointer target isn't the 6px
  // visual strip. Centers the slim rail; `touchAction: none` lets a touch drag
  // scrub instead of scrolling the page.
  seekTrack: {
    position: "relative",
    flex: 1,
    height: 20,
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    touchAction: "none",
  },
  // The slim visual track (stays 6px) rendered inside the hit area.
  seekRail: {
    position: "relative",
    width: "100%",
    height: 6,
    borderRadius: 3,
    background: "rgba(255,255,255,0.25)",
  },
  // Buffered-range shading behind the played fill (neutral white wash).
  seekBuffered: (pct) => ({
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    width: `${pct}%`,
    borderRadius: 3,
    background: "rgba(255,255,255,0.35)",
  }),
  seekFill: (pct) => ({
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    width: `${pct}%`,
    borderRadius: 3,
    background: colors.accent,
  }),
  // Visible playhead handle at the fill end. Text/indigo at rest; the cyan
  // focus/hover accent is layered via the `.suvo-seek` CSS rules (Single-Light).
  // No transition on `left`, so there's no animated thumb to suppress under
  // prefers-reduced-motion.
  seekHandle: (pct) => ({
    position: "absolute",
    left: `${pct}%`,
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: 13,
    height: 13,
    borderRadius: "50%",
    background: colors.text,
    border: `2px solid ${colors.accent}`,
    pointerEvents: "none",
  }),
  timeText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  volSlider: {
    width: 84,
    accentColor: colors.accent,
    cursor: "pointer",
    flexShrink: 0,
  },
  // Resting/selected coloring only — IconButton layers the cyan focus ring/glow.
  // Single-Light: an engaged control (menu open / active) takes Aurora Indigo;
  // resting stays on the neutral translucent-white wash over the video.
  iconBtn: (active) => ({
    gap: 6,
    backgroundColor: active ? accentAlpha(0.2) : "rgba(255,255,255,0.12)",
    border: active ? `1px solid ${colors.accent}` : "1px solid rgba(255,255,255,0.2)",
    color: active ? colors.accent : colors.text,
    borderRadius: radii.sm,
    minWidth: 44,
    height: 44,
    padding: "0 10px",
    fontSize: 12,
    fontFamily: fonts.body,
    fontWeight: 600,
    whiteSpace: "nowrap",
  }),
  menuUp: {
    position: "absolute",
    bottom: "115%",
    right: 0,
    backgroundColor: colors.surface2,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    padding: 4,
    minWidth: 130,
    zIndex: 100,
    maxHeight: 320,
    overflowY: "auto",
  },
  // Consolidated settings popover: wider, scrollable, grouped into labelled
  // sections so the secondary controls live behind one affordance.
  settingsMenu: {
    position: "absolute",
    bottom: "115%",
    right: 0,
    backgroundColor: colors.surface2,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    padding: 0,
    minWidth: 300,
    zIndex: 100,
    maxHeight: 520,
    overflowY: "auto",
  },
  // A labelled section inside the settings menu (hairline-separated).
  menuSection: {
    padding: "10px 12px",
    borderTop: `1px solid ${colors.border}`,
  },
  // Eyebrow header for a settings section (display face, per the type ramp).
  sectionLabel: {
    color: colors.muted,
    fontFamily: fonts.display,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  // Wrap of compact option chips (speed / aspect / quality / audio).
  optionRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  optionChip: (active) => ({
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: active ? 700 : 400,
    // Aurora Indigo marks the active path; unselected chips stay on the ladder.
    color: active ? colors.accentText : colors.text,
    backgroundColor: active ? accentAlpha(0.15) : colors.surface,
    border: `1px solid ${active ? colors.accent : colors.border}`,
    borderRadius: radii.sm,
    padding: "6px 12px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  }),
  // Full-width toggle/action row inside the settings menu (stats / PiP / cast).
  toggleRow: (active) => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    textAlign: "left",
    border: "none",
    background: "transparent",
    color: active ? colors.accentText : colors.text,
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: active ? 700 : 400,
    padding: "8px 4px",
    borderRadius: radii.sm,
    cursor: "pointer",
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
    // Steel (muted), not Faint Steel — the shortcut legend is readable copy, and
    // Faint Steel is placeholder/disabled-only per the palette rules.
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: 11,
    flexShrink: 0,
  },
};

// Fatal-error copy. The recovery machine hands us `fatalMessage`, which can be
// terse or lean technical (e.g. "…the server rejected the connection."). The
// overlay never headlines that: the primary line is always this calm,
// benefit-first sentence, and the raw message rides underneath as secondary
// diagnostic detail for anyone who wants it.
const FATAL_HEADLINE =
  "This stream won't play right now — it may be offline, or the connection dropped. Try again, or head back and pick something else.";

export default function VideoPlayerScreen() {
  const player = usePlayer({ isTV: false });
  const {
    currentVideo,
    isLive,
    videoRef,
    frameCanvasRef,
    openMenuRef,
    pausedRef,
    isBusy,
    isRecovering,
    isFatal,
    fatalMessage,
    hasFrozenFrame,
    qualityLevels,
    selectedLevel,
    playbackRate,
    audioTracks,
    selectedAudio,
    subtitleTracks,
    selectedSubtitle,
    aspectRatio,
    videoAdjust,
    videoFilter,
    applyVideoAdjust,
    resetVideoAdjust,
    openMenu,
    setOpenMenu,
    tvCurrentTime,
    tvDuration,
    tvPaused,
    pct,
    volume,
    muted,
    pipSupported,
    castSupported,
    pipActive,
    showStats,
    setShowStats,
    stats,
    resume,
    resumePending,
    resolveResume,
    nowNext,
    subtitleStyle,
    subtitleOffsetMs,
    audioOffsetMs,
    sleep,
    nextEpisode,
    handleNextEpisode,
    handleClose,
    handleRetry,
    handleSelectLevel,
    applySpeed,
    applyAudio,
    applySubtitle,
    applyAspect,
    handleSubtitleSettingsChange,
    handleTogglePip,
    handleCast,
    togglePlayWeb,
    seekWebToClientX,
    applyVolumeWeb,
    toggleMuteWeb,
    handleChannelUp,
    handleChannelDown,
    getLevelLabel,
  } = player;

  // ── Web-only view state ─────────────────────────────────────────────────────
  const rootRef = useRef(null);
  const [isFsWeb, setIsFsWeb] = useState(false);
  // Auto-hiding control cluster (web): visible on activity, fades after idle.
  const [webControlsVisible, setWebControlsVisible] = useState(true);
  const webHideTimerRef = useRef(null);

  // Menu refs (outside-click dismissal, web only). Subtitle keeps a quick-access
  // dropdown in the resting bar; every other secondary control now lives inside
  // the single "more" settings popover.
  const subtitleRef = useRef(null);
  const moreRef = useRef(null);
  // Focusable seek bar (role=slider). The global arrow-key handler defers to the
  // bar's own onKeyDown while it's focused so a keyboard seek fires exactly once.
  const seekBarRef = useRef(null);
  // Pointer drag-to-scrub state. `scrubPct` is non-null only during a drag; it
  // overrides the played fill / handle position / aria-valuenow so the thumb
  // tracks the pointer, and the actual seek is committed on pointerup. Pointer
  // capture keeps move/up events flowing even when the pointer leaves the bar.
  const [scrubPct, setScrubPct] = useState(null);
  const scrubbingRef = useRef(false);
  // Buffered-range width (0-100), shaded behind the fill. Read from the <video>
  // element's own buffered TimeRanges when available; stays 0 otherwise.
  const [bufferedPct, setBufferedPct] = useState(0);

  // Map a pointer clientX to a 0-1 position along the seek bar's own rect (same
  // horizontal extent as the visual rail, so the math matches click-to-jump).
  const ratioFromClientX = useCallback((clientX) => {
    const el = seekBarRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 0)) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handleScrubDown = useCallback((e) => {
    if (e.button != null && e.button !== 0) return; // primary button only
    scrubbingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setScrubPct(ratioFromClientX(e.clientX) * 100);
  }, [ratioFromClientX]);

  const handleScrubMove = useCallback((e) => {
    if (!scrubbingRef.current) return;
    setScrubPct(ratioFromClientX(e.clientX) * 100);
  }, [ratioFromClientX]);

  const handleScrubUp = useCallback((e) => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    seekWebToClientX(e.clientX, seekBarRef.current);
    setScrubPct(null);
  }, [seekWebToClientX]);

  const handleScrubCancel = useCallback(() => {
    scrubbingRef.current = false;
    setScrubPct(null);
  }, []);

  const toggleFullscreenWeb = useCallback(() => {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      rootRef.current?.requestFullscreen?.();
    }
  }, []);

  // Mirror browser fullscreen state (covers Esc / native exit) into the icon.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onFs = () => setIsFsWeb(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Track the buffered range from the element itself (readily available on the
  // media element). Updated on progress/timeupdate; falls back to 0 shading when
  // no buffered TimeRanges exist rather than fabricating a value.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    const update = () => {
      const d = v.duration;
      const b = v.buffered;
      if (!(d > 0) || !b || !b.length) { setBufferedPct(0); return; }
      setBufferedPct(Math.min((b.end(b.length - 1) / d) * 100, 100));
    };
    v.addEventListener("progress", update);
    v.addEventListener("timeupdate", update);
    update();
    return () => {
      v.removeEventListener("progress", update);
      v.removeEventListener("timeupdate", update);
    };
  }, [videoRef, currentVideo?.url]);

  // Reveal the control cluster and (re)start the idle-hide countdown. Stays put
  // while a menu is open or the video is paused (checked via refs so the timer
  // callback sees the latest values without re-creating this callback).
  const showWebControls = useCallback(() => {
    setWebControlsVisible(true);
    clearTimeout(webHideTimerRef.current);
    if (openMenuRef.current || pausedRef.current) return;
    webHideTimerRef.current = setTimeout(() => setWebControlsVisible(false), 3500);
  }, [openMenuRef, pausedRef]);

  // Force controls visible while a menu is open or paused; resume the countdown
  // once both clear. Also clears the timer on unmount.
  useEffect(() => {
    if (openMenu || pausedRef.current) {
      setWebControlsVisible(true);
      clearTimeout(webHideTimerRef.current);
    } else {
      showWebControls();
    }
    return () => clearTimeout(webHideTimerRef.current);
  }, [openMenu, tvPaused, showWebControls, pausedRef]);

  // Close dropdowns on outside click (web only)
  useEffect(() => {
    if (!openMenu) return undefined;
    const onClick = (e) => {
      if (
        ![subtitleRef, moreRef].some((r) => r.current?.contains(e.target))
      ) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [openMenu, setOpenMenu]);

  // Keyboard shortcuts (desktop). ⌘-combos are ignored so page shortcuts still work.
  useEffect(() => {
    const onKey = (e) => {
      if (isMacCommand(e)) return; // ⌘ shares keyCode 91 with Back in the sim
      if (!currentVideo || !videoRef.current) return;
      const video = videoRef.current;

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
            : rootRef.current?.requestFullscreen?.();
          break;
        case "Escape":
          handleClose();
          break;
        case "ArrowLeft":
          // Let the focused seek bar own its own arrow keys (avoids a double seek).
          if (e.target === seekBarRef.current) break;
          e.preventDefault();
          video.currentTime -= 10;
          break;
        case "ArrowRight":
          if (e.target === seekBarRef.current) break;
          e.preventDefault();
          video.currentTime += 10;
          break;
        case "ArrowUp":
          e.preventDefault();
          if (isLive) handleChannelUp();
          else video.volume = Math.min(1, video.volume + 0.1);
          break;
        case "ArrowDown":
          e.preventDefault();
          if (isLive) handleChannelDown();
          else video.volume = Math.max(0, video.volume - 0.1);
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
  }, [currentVideo, videoRef, handleClose, isLive, handleChannelUp, handleChannelDown, applySpeed, handleTogglePip, setShowStats]);

  const getVideoStyle = useMemo(() => {
    // `filter` carries the brightness/contrast picture adjustment; undefined when
    // neutral so we don't force needless compositing. All aspect branches spread
    // `base`, so every path inherits it.
    const base = { ...S.video, filter: videoFilter || undefined };
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
  }, [aspectRatio, videoFilter]);

  if (!currentVideo) return null;

  // Offscreen-but-mounted canvas holding the last decoded frame. Kept mounted so
  // captureFrame() can always draw into it; only painted on top of the (possibly
  // black, post-teardown) <video> while busy and a frame has been captured.
  const frozenFrame = (
    <canvas
      ref={frameCanvasRef}
      aria-hidden
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
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
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
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
          willChange: "transform",
        }}
      />
      <span style={{ color: colors.text, fontFamily: fonts.body, fontSize: 18, fontWeight: 600 }}>
        {isRecovering ? "Reconnecting…" : "Loading…"}
      </span>
    </div>
  );

  // In fullscreen, fade the title bar and footer hints with the rest of the
  // controls so the view is fully immersive once idle; outside fullscreen
  // they stay put as normal window chrome.
  const chromeHidden = isFsWeb && !webControlsVisible;

  return (
    <div style={S.overlay} ref={rootRef}>
      <div
        style={{
          ...S.header,
          opacity: chromeHidden ? 0 : 1,
          pointerEvents: chromeHidden ? "none" : "auto",
          transition: "opacity 250ms ease",
        }}
      >
        <IconButton style={S.closeBtn} onPress={handleClose} title="Close (Esc)" aria-label="Close">
          <Icon name="close" size={16} color={colors.text} />
        </IconButton>
        <span style={S.title}>{currentVideo.name}</span>

        {nextEpisode && (
          <IconButton
            style={S.nextBtn}
            onPress={handleNextEpisode}
            title={`Next: S${String(nextEpisode.seasonNum).padStart(2, "0")}E${String(nextEpisode.episode.episode_num).padStart(2, "0")}`}
          >
            Next <Icon name="play" size={13} color={colors.text} />
          </IconButton>
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

      <div
        style={{ ...S.videoWrapper, cursor: webControlsVisible ? "default" : "none" }}
        onMouseMove={showWebControls}
        onMouseLeave={() => { if (!openMenuRef.current && !pausedRef.current) setWebControlsVisible(false); }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          crossOrigin="anonymous"
          onClick={togglePlayWeb}
          style={{ ...getVideoStyle, cursor: webControlsVisible ? "pointer" : "none" }}
        />
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
              title="Can't play this stream"
              message={FATAL_HEADLINE}
              onRetry={handleRetry}
            />
            {/* Raw engine/provider reason, kept as quiet secondary detail so it
                informs without alarming — steel (muted), not the danger tone. */}
            {fatalMessage ? (
              <div
                style={{
                  textAlign: "center",
                  color: colors.muted,
                  fontFamily: fonts.body,
                  fontSize: 12,
                  padding: "0 24px",
                }}
              >
                {fatalMessage}
              </div>
            ) : null}
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 16, paddingBottom: 24 }}>
              <Button variant="secondary" size="md" icon="close" onPress={handleClose}>
                Close
              </Button>
            </div>
          </div>
        )}
        {busyOverlay}

        {/* Custom control cluster overlaid on the video: settings icon row on
            top of our own seek/time bar (native <video controls> is disabled). */}
        {!isFatal && (
        <div
          style={{
            ...S.controlsOverlay,
            opacity: webControlsVisible ? 1 : 0,
            pointerEvents: webControlsVisible ? "auto" : "none",
            transition: "opacity 250ms ease",
          }}
        >
        {/* Resting bar: only the most-used controls. Play/pause + volume live in
            the seek row below; here we keep quick-access Subtitles, a single
            Settings affordance (everything secondary is grouped behind it), and
            Fullscreen. Every grouped control keeps its keyboard shortcut. */}
        <div style={S.bottomBar}>
        {subtitleTracks.length > 0 && (
          <div style={S.dropdown} ref={subtitleRef}>
            <IconButton style={S.iconBtn(openMenu === "subtitle")} onPress={() => setOpenMenu((m) => (m === "subtitle" ? null : "subtitle"))} title="Subtitles" aria-label="Subtitles">
              <Icon name="cc" size={18} color="currentColor" />
            </IconButton>
            {openMenu === "subtitle" && (
              <div style={S.menuUp}>
                <button style={S.menuItem(selectedSubtitle === -1)} onClick={() => { applySubtitle(-1); setOpenMenu(null); }}>
                  Off
                </button>
                {subtitleTracks.map((t, i) => (
                  <button key={t.id ?? i} style={S.menuItem(selectedSubtitle === i)} onClick={() => { applySubtitle(i); setOpenMenu(null); }}>
                    {t.name || `Track ${i + 1}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Settings: the single grouping affordance for every secondary control
            (speed, audio, quality, aspect, stats, PiP, cast, subtitle tuning,
            picture, sleep). */}
        <div style={S.dropdown} ref={moreRef}>
          <IconButton style={S.iconBtn(openMenu === "more" || sleep.active)} onPress={() => setOpenMenu((m) => (m === "more" ? null : "more"))} title="Settings" aria-label="Settings">
            <Icon name="tune" size={18} color="currentColor" />
            {sleep.active ? ` ${formatRemaining(sleep.secondsLeft)}` : ""}
          </IconButton>
          {openMenu === "more" && (
            <div style={S.settingsMenu}>
              {/* Playback speed */}
              <div style={{ ...S.menuSection, borderTop: "none" }}>
                <div style={S.sectionLabel}>Playback speed</div>
                <div style={S.optionRow}>
                  {SPEEDS.map((r) => (
                    <IconButton key={r} style={S.optionChip(playbackRate === r)} onPress={() => applySpeed(r)}>
                      {r === 1 ? "Normal" : `${r}x`}
                    </IconButton>
                  ))}
                </div>
              </div>

              {/* Audio track */}
              {audioTracks.length > 1 && (
                <div style={S.menuSection}>
                  <div style={S.sectionLabel}>Audio track</div>
                  <div style={S.optionRow}>
                    {audioTracks.map((t, i) => (
                      <IconButton key={t.id ?? i} style={S.optionChip(selectedAudio === i)} onPress={() => applyAudio(i)}>
                        {t.name || `Track ${i + 1}`}
                      </IconButton>
                    ))}
                  </div>
                </div>
              )}

              {/* Quality */}
              {qualityLevels.length > 1 && (
                <div style={S.menuSection}>
                  <div style={S.sectionLabel}>Quality</div>
                  <div style={S.optionRow}>
                    <IconButton style={S.optionChip(selectedLevel === -1)} onPress={() => handleSelectLevel(-1)}>
                      Auto
                    </IconButton>
                    {[...qualityLevels]
                      .map((l, i) => ({ l, i }))
                      .sort((a, b) => (b.l.height || 0) - (a.l.height || 0))
                      .map(({ l, i }) => (
                        <IconButton key={`${l.height}-${l.bitrate}`} style={S.optionChip(selectedLevel === i)} onPress={() => handleSelectLevel(i)}>
                          {getLevelLabel(l, qualityLevels)}
                        </IconButton>
                      ))}
                  </div>
                </div>
              )}

              {/* Aspect ratio */}
              <div style={S.menuSection}>
                <div style={S.sectionLabel}>Aspect ratio</div>
                <div style={S.optionRow}>
                  {ASPECT_RATIOS.map(({ value, label }) => (
                    <IconButton key={value} style={S.optionChip(aspectRatio === value)} onPress={() => applyAspect(value)}>
                      {label}
                    </IconButton>
                  ))}
                </div>
              </div>

              {/* Display toggles / one-off actions */}
              <div style={S.menuSection}>
                <div style={S.sectionLabel}>Display</div>
                <button style={S.toggleRow(showStats)} onClick={() => setShowStats((v) => !v)} aria-pressed={showStats}>
                  <Icon name="info" size={18} color="currentColor" />
                  <span style={{ flex: 1 }}>Stats for nerds</span>
                  <span style={{ fontSize: 12, color: showStats ? colors.accentText : colors.muted }}>{showStats ? "On" : "Off"}</span>
                </button>
                {pipSupported && (
                  <button style={S.toggleRow(pipActive)} onClick={() => { handleTogglePip(); setOpenMenu(null); }} aria-pressed={pipActive}>
                    <Icon name="pip" size={18} color="currentColor" />
                    <span style={{ flex: 1 }}>Picture-in-picture</span>
                    <span style={{ fontSize: 12, color: pipActive ? colors.accentText : colors.muted }}>{pipActive ? "On" : "Off"}</span>
                  </button>
                )}
                {castSupported && (
                  <button style={S.toggleRow(false)} onClick={() => { handleCast(); setOpenMenu(null); }}>
                    <Icon name="cast" size={18} color="currentColor" />
                    <span style={{ flex: 1 }}>Cast / AirPlay</span>
                  </button>
                )}
              </div>

              <SubtitleSettings
                style={subtitleStyle}
                subtitleOffsetMs={subtitleOffsetMs}
                audioOffsetMs={audioOffsetMs}
                onChange={handleSubtitleSettingsChange}
              />
              <div style={S.menuSection}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={S.sectionLabel}>Picture</span>
                  {(videoAdjust.brightness !== 100 || videoAdjust.contrast !== 100) && (
                    <button
                      style={{ ...S.menuItem(false), width: "auto", padding: "2px 8px", fontSize: 12 }}
                      onClick={resetVideoAdjust}
                    >
                      Reset
                    </button>
                  )}
                </div>
                <AdjustRow
                  label="Brightness"
                  value={videoAdjust.brightness}
                  onDec={() => applyVideoAdjust({ brightness: videoAdjust.brightness - ADJUST_STEP })}
                  onInc={() => applyVideoAdjust({ brightness: videoAdjust.brightness + ADJUST_STEP })}
                />
                <AdjustRow
                  label="Contrast"
                  value={videoAdjust.contrast}
                  onDec={() => applyVideoAdjust({ contrast: videoAdjust.contrast - ADJUST_STEP })}
                  onInc={() => applyVideoAdjust({ contrast: videoAdjust.contrast + ADJUST_STEP })}
                />
              </div>
              <div style={S.menuSection}>
                <div style={S.sectionLabel}>Sleep timer</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {SLEEP_PRESETS.map((p) => (
                    <IconButton
                      key={p.label}
                      style={S.optionChip(false)}
                      onPress={() => {
                        if (p.kind === "end-of-episode") {
                          sleep.cancel();
                        } else if (p.minutes) {
                          sleep.start(p.minutes);
                        }
                        setOpenMenu(null);
                      }}
                    >
                      {p.label}
                    </IconButton>
                  ))}
                  {sleep.active && (
                    <IconButton style={{ ...S.optionChip(false), color: colors.danger, borderColor: colors.danger }} onPress={() => { sleep.cancel(); setOpenMenu(null); }}>
                      Cancel timer
                    </IconButton>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <IconButton style={S.iconBtn(isFsWeb)} onPress={toggleFullscreenWeb} title="Fullscreen (f)" aria-label="Fullscreen">
          <Icon name={isFsWeb ? "fullscreen-exit" : "fullscreen"} size={18} color="currentColor" />
        </IconButton>
        </div>

        {tvDuration > 0 && (
          <div style={S.ctrlBar}>
            <IconButton style={S.playBtn} onPress={togglePlayWeb} title="Play / Pause (Space)" aria-label={tvPaused ? "Play" : "Pause"}>
              <Icon name={tvPaused ? "play" : "pause"} size={20} color="currentColor" />
            </IconButton>
            {(() => {
              // During a drag the thumb/fill follow the pointer (scrubPct);
              // otherwise they follow playback (pct).
              const displayPct = scrubPct != null ? scrubPct : pct;
              const nowTime = scrubPct != null ? (scrubPct / 100) * tvDuration : tvCurrentTime;
              return (
                <div
                  ref={seekBarRef}
                  className="suvo-seek"
                  style={S.seekTrack}
                  role="slider"
                  tabIndex={0}
                  aria-label="Seek"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(tvDuration)}
                  aria-valuenow={Math.round(nowTime)}
                  aria-valuetext={`${fmtTime(nowTime)} of ${fmtTime(tvDuration)}`}
                  onClick={(e) => seekWebToClientX(e.clientX, e.currentTarget)}
                  onPointerDown={handleScrubDown}
                  onPointerMove={handleScrubMove}
                  onPointerUp={handleScrubUp}
                  onPointerCancel={handleScrubCancel}
                  onKeyDown={(e) => {
                    const v = videoRef.current;
                    if (!v) return;
                    if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      v.currentTime -= 10;
                    } else if (e.key === "ArrowRight") {
                      e.preventDefault();
                      v.currentTime += 10;
                    }
                  }}
                >
                  <div style={S.seekRail}>
                    {bufferedPct > 0 && <div style={S.seekBuffered(bufferedPct)} />}
                    <div style={S.seekFill(displayPct)} />
                    <div className="suvo-seek-handle" style={S.seekHandle(displayPct)} />
                  </div>
                </div>
              );
            })()}
            <span style={S.timeText}>{fmtTime(tvCurrentTime)} / {fmtTime(tvDuration)}</span>
            <IconButton style={S.playBtn} onPress={toggleMuteWeb} title="Mute" aria-label="Mute">
              <Icon name={muted || volume === 0 ? "mute" : "audio"} size={18} color="currentColor" />
            </IconButton>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => applyVolumeWeb(Number(e.target.value))}
              style={S.volSlider}
              aria-label="Volume"
            />
          </div>
        )}
        </div>
        )}
      </div>

      <div
        style={{
          ...S.footer,
          opacity: chromeHidden ? 0 : 1,
          pointerEvents: chromeHidden ? "none" : "auto",
          transition: "opacity 250ms ease",
        }}
      >
        Space/K: Play/Pause · F: Fullscreen · ←→: Seek ·{" "}
        {isLive ? "↑↓: Channel" : "↑↓: Volume"} · [ ]: Speed · P: PiP · I: Stats ·
        Esc: Close
      </div>
      <style>{`@keyframes spin { from { transform: translateZ(0) rotate(0deg); } to { transform: translateZ(0) rotate(360deg); } }
        .suvo-seek:focus { outline: none; }
        .suvo-seek:hover .suvo-seek-handle,
        .suvo-seek:focus-visible .suvo-seek-handle { background: ${colors.accent2}; border-color: ${colors.accent2}; box-shadow: 0 0 0 4px ${accent2Alpha(0.35)}; }`}</style>
    </div>
  );
}

// A labelled −/＋ stepper row for a picture-adjustment value (brightness/contrast).
function AdjustRow({ label, value, onDec, onInc }) {
  const btn = {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
    lineHeight: 1,
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
      <span style={{ color: colors.text, fontFamily: fonts.body, fontSize: 14 }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button style={btn} onClick={onDec} disabled={value <= ADJUST_MIN} aria-label={`Decrease ${label}`}>−</button>
        <span style={{ color: colors.text, fontFamily: fonts.body, fontSize: 14, minWidth: 44, textAlign: "center" }}>
          {value}%
        </span>
        <button style={btn} onClick={onInc} disabled={value >= ADJUST_MAX} aria-label={`Increase ${label}`}>+</button>
      </span>
    </div>
  );
}
