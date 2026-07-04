import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { usePlayer, SPEEDS, ASPECT_RATIOS } from "../playback/usePlayer";
import { SLEEP_PRESETS, formatRemaining } from "../playback/useSleepTimer";
import { isMacCommand } from "../platform/adapters/input/keys";
import ResumePrompt from "../playback/components/ResumePrompt";
import SubtitleSettings from "../playback/components/SubtitleSettings";
import StatsOverlay from "../playback/components/StatsOverlay";
import Icon from "../ui/Icon";
import StatePanel from "../ui/StatePanel";
import Button from "../ui/Button";
import { formatDuration as fmtTime } from "../utils/formatDuration";
import {
  colors,
  accentAlpha,
  radii,
  fonts,
  motion,
  easing,
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
    width: 40,
    height: 40,
    flexShrink: 0,
    borderRadius: "50%",
    border: "none",
    backgroundColor: "rgba(255,255,255,0.15)",
    color: colors.text,
    cursor: "pointer",
  },
  seekTrack: {
    position: "relative",
    flex: 1,
    height: 6,
    borderRadius: 3,
    background: "rgba(255,255,255,0.25)",
    cursor: "pointer",
  },
  seekFill: (pct) => ({
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    width: `${pct}%`,
    borderRadius: 3,
    background: colors.accent2,
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
    accentColor: colors.accent2,
    cursor: "pointer",
    flexShrink: 0,
  },
  iconBtn: (active) => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    backgroundColor: active ? accentAlpha(0.2) : "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.2)",
    color: active ? colors.accent2 : colors.text,
    borderRadius: radii.sm,
    minWidth: 40,
    height: 40,
    padding: "0 10px",
    fontSize: 12,
    fontFamily: fonts.body,
    fontWeight: 600,
    cursor: "pointer",
    justifyContent: "center",
    whiteSpace: "nowrap",
    transition: `box-shadow ${motion.base}ms ${easing}, outline-color ${motion.fast}ms ${easing}`,
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

  // Menu refs (outside-click dismissal, web only)
  const qualityRef = useRef(null);
  const speedRef = useRef(null);
  const audioRef = useRef(null);
  const subtitleRef = useRef(null);
  const aspectRef = useRef(null);
  const moreRef = useRef(null);

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
        ![qualityRef, speedRef, audioRef, subtitleRef, aspectRef, moreRef].some((r) =>
          r.current?.contains(e.target),
        )
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
            : video.requestFullscreen();
          break;
        case "Escape":
          handleClose();
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

  const currentQualityLabel =
    selectedLevel === -1
      ? "Auto"
      : getLevelLabel(qualityLevels[selectedLevel], qualityLevels);

  return (
    <div style={S.overlay} ref={rootRef}>
      <div style={S.header}>
        <button style={S.closeBtn} onClick={handleClose} title="Close (Esc)" aria-label="Close">
          <Icon name="close" size={16} color={colors.text} />
        </button>
        <span style={S.title}>{currentVideo.name}</span>

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
          style={{ ...getVideoStyle, cursor: "pointer" }}
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
        <div style={S.bottomBar}>
        <div style={S.dropdown} ref={speedRef}>
          <button style={S.iconBtn(openMenu === "speed")} onClick={() => setOpenMenu((m) => (m === "speed" ? null : "speed"))} title="Playback speed" aria-label="Playback speed">
            <Icon name="speed" size={18} color="currentColor" /> {playbackRate}x
          </button>
          {openMenu === "speed" && (
            <div style={S.menuUp}>
              {SPEEDS.map((r) => (
                <button key={r} style={S.menuItem(playbackRate === r)} onClick={() => { applySpeed(r); setOpenMenu(null); }}>
                  {r}x{r === 1 ? " (Normal)" : ""}
                </button>
              ))}
            </div>
          )}
        </div>

        {audioTracks.length > 1 && (
          <div style={S.dropdown} ref={audioRef}>
            <button style={S.iconBtn(openMenu === "audio")} onClick={() => setOpenMenu((m) => (m === "audio" ? null : "audio"))} title="Audio track" aria-label="Audio track">
              <Icon name="audio" size={18} color="currentColor" />
            </button>
            {openMenu === "audio" && (
              <div style={S.menuUp}>
                {audioTracks.map((t, i) => (
                  <div key={t.id ?? i} style={S.menuItem(selectedAudio === i)} onClick={() => { applyAudio(i); setOpenMenu(null); }}>
                    {t.name || `Track ${i + 1}`}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {subtitleTracks.length > 0 && (
          <div style={S.dropdown} ref={subtitleRef}>
            <button style={S.iconBtn(openMenu === "subtitle")} onClick={() => setOpenMenu((m) => (m === "subtitle" ? null : "subtitle"))} title="Subtitles" aria-label="Subtitles">
              <Icon name="cc" size={18} color="currentColor" />
            </button>
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

        <div style={S.dropdown} ref={aspectRef}>
          <button style={S.iconBtn(openMenu === "aspect")} onClick={() => setOpenMenu((m) => (m === "aspect" ? null : "aspect"))} title="Aspect ratio" aria-label="Aspect ratio">
            <Icon name="aspect" size={18} color="currentColor" />
          </button>
          {openMenu === "aspect" && (
            <div style={S.menuUp}>
              {ASPECT_RATIOS.map(({ value, label }) => (
                <button key={value} style={S.menuItem(aspectRatio === value)} onClick={() => { applyAspect(value); setOpenMenu(null); }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {qualityLevels.length > 1 && (
          <div style={S.dropdown} ref={qualityRef}>
            <button style={S.iconBtn(openMenu === "quality")} onClick={() => setOpenMenu((m) => (m === "quality" ? null : "quality"))} title="Quality" aria-label="Quality">
              <Icon name="settings" size={18} color="currentColor" /> {currentQualityLabel}
            </button>
            {openMenu === "quality" && (
              <div style={S.menuUp}>
                <button style={S.menuItem(selectedLevel === -1)} onClick={() => handleSelectLevel(-1)}>
                  Auto
                </button>
                {[...qualityLevels]
                  .map((l, i) => ({ l, i }))
                  .sort((a, b) => (b.l.height || 0) - (a.l.height || 0))
                  .map(({ l, i }) => (
                    <button key={`${l.height}-${l.bitrate}`} style={S.menuItem(selectedLevel === i)} onClick={() => handleSelectLevel(i)}>
                      {getLevelLabel(l, qualityLevels)}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}

        {pipSupported && (
          <button style={S.iconBtn(pipActive)} onClick={handleTogglePip} title="Picture-in-Picture (p)" aria-label="Picture-in-Picture">
            <Icon name="pip" size={18} color="currentColor" />
          </button>
        )}

        {castSupported && (
          <button style={S.iconBtn(false)} onClick={handleCast} title="Cast / AirPlay" aria-label="Cast">
            <Icon name="cast" size={18} color="currentColor" />
          </button>
        )}

        <button style={S.iconBtn(showStats)} onClick={() => setShowStats((v) => !v)} title="Stats for nerds (i)" aria-label="Stats">
          <Icon name="info" size={18} color="currentColor" />
        </button>

        <div style={S.dropdown} ref={moreRef}>
          <button style={S.iconBtn(openMenu === "more" || sleep.active)} onClick={() => setOpenMenu((m) => (m === "more" ? null : "more"))} title="Subtitle tuning & sleep timer" aria-label="More settings">
            <Icon name="tune" size={18} color="currentColor" />
            {sleep.active ? ` ${formatRemaining(sleep.secondsLeft)}` : ""}
          </button>
          {openMenu === "more" && (
            <div style={{ ...S.menuUp, minWidth: 300, padding: 0, maxHeight: 520 }}>
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
                    <button style={{ ...S.menuItem(false), color: colors.danger }} onClick={() => { sleep.cancel(); setOpenMenu(null); }}>
                      Cancel timer
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <button style={S.iconBtn(isFsWeb)} onClick={toggleFullscreenWeb} title="Fullscreen (f)" aria-label="Fullscreen">
          <Icon name={isFsWeb ? "fullscreen-exit" : "fullscreen"} size={18} color="currentColor" />
        </button>
        </div>

        {tvDuration > 0 && (
          <div style={S.ctrlBar}>
            <button style={S.playBtn} onClick={togglePlayWeb} title="Play / Pause (Space)" aria-label={tvPaused ? "Play" : "Pause"}>
              <Icon name={tvPaused ? "play" : "pause"} size={20} color="currentColor" />
            </button>
            <div style={S.seekTrack} onClick={(e) => seekWebToClientX(e.clientX, e.currentTarget)}>
              <div style={S.seekFill(pct)} />
            </div>
            <span style={S.timeText}>{fmtTime(tvCurrentTime)} / {fmtTime(tvDuration)}</span>
            <button style={S.playBtn} onClick={toggleMuteWeb} title="Mute" aria-label="Mute">
              <Icon name={muted || volume === 0 ? "mute" : "audio"} size={18} color="currentColor" />
            </button>
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

      <div style={S.footer}>
        Space/K: Play/Pause · F: Fullscreen · ←→: Seek ·{" "}
        {isLive ? "↑↓: Channel" : "↑↓: Volume"} · [ ]: Speed · P: PiP · I: Stats ·
        Esc: Close
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
