import { useEffect, useRef, useState, useCallback } from "react";
import { usePlayer, SPEEDS, ASPECT_RATIOS } from "../playback/usePlayer";
import { ADJUST_LEVELS } from "../playback/videoAdjust";
import { INITIAL_TV_NAV, tvNavReduce } from "../playback/tvSettingsNav";
import { SLEEP_PRESETS, formatRemaining } from "../playback/useSleepTimer";
import { FATAL_TITLE, FATAL_HEADLINE } from "../playback/playerCopy";
import { controlIcon, controlLabel } from "../playback/playerControls";
import { isMacCommand } from "../platform/adapters/input/keys";
import StatsOverlay from "../playback/components/StatsOverlay";
import Icon from "../ui/Icon";
import StatePanel from "../ui/StatePanel";
import Button from "../ui/Button";
import { formatDuration as fmtTime } from "../utils/formatDuration";
import { colors, accentAlpha, accent2Alpha, radii, fonts, zIndex, playerScrim, seekTrack } from "../ui/tokens";

// LG webOS remote key codes
const TV_KEYS = {
  PLAY: 415,
  PAUSE: 19,
  STOP: 413,
  FF: 417,
  REW: 412,
  BACK: new Set([27, 461, 10009, 8, 91]),
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
    zIndex: zIndex.playerOverlay,
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
  // White-on-video control alphas (progress track, seek-hint, pills) are an
  // intentional video-overlay convention: they read against arbitrary frame
  // content regardless of palette, so they deliberately bypass surface tokens.
  progressTrack: {
    height: 14,
    background: seekTrack.track,
    borderRadius: 7,
    overflow: "hidden",
    cursor: "pointer",
  },
  progressFill: (pct) => ({
    height: "100%",
    width: `${pct}%`,
    // RESTING progress fill → indigo (matches card resume bars); cyan is
    // focus-only. See Single-Light rule.
    background: colors.accent,
    borderRadius: 7,
  }),
  seekHint: {
    textAlign: "center",
    color: "rgba(255,255,255,0.6)",
    fontSize: 16,
  },
  settingsRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 16,
    rowGap: 12,
    marginBottom: 6,
  },
  settingsIcon: (focused) => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 56,
    minWidth: 56,
    padding: "0 16px",
    borderRadius: radii.sm,
    background: focused ? accent2Alpha(0.25) : "rgba(255,255,255,0.12)",
    border: focused ? `3px solid ${colors.accent2}` : "3px solid transparent",
    color: colors.text,
    fontSize: 20,
    fontWeight: 700,
  }),
  settingsMenu: {
    position: "absolute",
    bottom: "100%",
    left: 0,
    marginBottom: 12,
    minWidth: 260,
    maxHeight: 380,
    overflowY: "auto",
    background: "rgba(20,26,46,0.98)", // surface #141A2E, kept in-palette

    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    padding: 6,
  },
  settingsMenuItem: (highlighted, active) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderRadius: radii.sm,
    fontSize: 20,
    fontWeight: active ? 700 : 500,
    // SELECTED item at rest → indigo text; highlighted (focused) row → cyan fill.
    color: active ? colors.accentText : colors.text,
    background: highlighted ? accent2Alpha(0.3) : "transparent",
  }),
  stateOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
};

export default function VideoPlayerScreen() {
  // The sleep timer must clear the TV hide-timer before closing so a stray
  // timeout can't fire against a torn-down screen; wrap the shared close.
  const controlsTimerRef = useRef(null);
  const onSleepElapsed = useCallback((close) => {
    clearTimeout(controlsTimerRef.current);
    close();
  }, []);

  const player = usePlayer({ isTV: true, onSleepElapsed });
  const {
    currentVideo,
    isLive,
    videoRef,
    isBusy,
    isRecovering,
    isFatal,
    fatalMessage,
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
    tvCurrentTime,
    tvDuration,
    tvPaused,
    pct,
    showStats,
    setShowStats,
    stats,
    resume,
    startTime,
    nowNext,
    nextEpisode,
    sleep,
    handleNextEpisode,
    handleClose,
    handleRetry,
    handleStartOver,
    handleSelectLevel,
    applySpeed,
    applyAudio,
    applySubtitle,
    applyAspect,
    handleChannelUp,
    handleChannelDown,
    getLevelLabel,
  } = player;

  // ── TV-only view state (10-foot controls visibility + D-pad settings nav) ────
  const [tvControlsVisible, setTvControlsVisible] = useState(true);
  // Fatal-error overlay focus: 0 = Retry, 1 = Close (the only two interactive
  // elements in that state). Refs mirror them for the once-bound keydown listener.
  const [fatalFocus, setFatalFocus] = useState(0);
  const isFatalRef = useRef(false);
  isFatalRef.current = isFatal;
  const fatalFocusRef = useRef(0);
  fatalFocusRef.current = fatalFocus;
  // Default focus to Retry each time the fatal overlay appears.
  useEffect(() => { if (isFatal) setFatalFocus(0); }, [isFatal]);
  const [tvNav, setTvNav] = useState(INITIAL_TV_NAV);
  const tvNavRef = useRef(INITIAL_TV_NAV);
  const tvSettingsItemsRef = useRef([]);
  // Keep the D-pad-highlighted settings row scrolled into the (maxHeight-capped,
  // overflow:auto) menu, so items past the fold stay remote-reachable.
  const menuItemElRef = useRef(null);
  useEffect(() => {
    menuItemElRef.current?.scrollIntoView({ block: "nearest" });
  }, [tvNav.menuIndex, tvNav.inMenu, tvNav.focus]);

  // Show TV controls and restart hide timer.
  const showTvControls = useCallback(() => {
    setTvControlsVisible(true);
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(
      () => setTvControlsVisible(false),
      4000,
    );
  }, []);

  // Surface the controls when a new source opens.
  useEffect(() => {
    if (!currentVideo) return;
    setTvNav(INITIAL_TV_NAV);
    showTvControls();
  }, [currentVideo?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard / remote D-pad handling (registered once, capture phase).
  useEffect(() => {
    const onKey = (e) => {
      if (isMacCommand(e)) return; // ⌘ shares keyCode 91 with Back in the sim
      if (!currentVideo || !videoRef.current) return;
      const video = videoRef.current;
      const k = e.keyCode || e.which;

      // Fatal-error overlay owns the remote: Left/Right toggle Retry↔Close, OK
      // fires the focused one, Back closes. All other keys are swallowed —
      // transport is dead in this state. (Runs before showTvControls so the
      // hidden transport controls' hide-timer isn't churned.)
      if (isFatalRef.current) {
        e.preventDefault();
        if (TV_KEYS.BACK.has(k)) { handleClose(); return; }
        if (k === 37) { setFatalFocus(0); return; }
        if (k === 39) { setFatalFocus(1); return; }
        if (k === 13 || e.key === "Enter") {
          fatalFocusRef.current === 0 ? handleRetry() : handleClose();
          return;
        }
        return;
      }

      showTvControls();

      // ── TV settings-row routing ──────────────────────────────────────────
      // While in the settings surface (row focused or a menu open), D-pad keys
      // drive the reducer instead of transport. Entry: Up when controls are
      // visible and not yet in the row.
      const nav = tvNavRef.current;
      const items = tvSettingsItemsRef.current;
      const inSettings = nav.focus >= 0 || nav.inMenu;

      // Normalise this key to a nav verb (null if not a nav key).
      const norm =
        e.key === "ArrowLeft" || k === 37 ? "left"
        : e.key === "ArrowRight" || k === 39 ? "right"
        : e.key === "ArrowUp" || k === 38 ? "up"
        : e.key === "ArrowDown" || k === 40 ? "down"
        : e.key === "Enter" || k === 13 ? "ok"
        : TV_KEYS.BACK.has(k) ? "back"
        : null;

      if (!inSettings && norm === "up" && tvControlsVisible) {
        // Enter the row. (Overrides live channel-up; see plan decisions.)
        e.preventDefault();
        setTvControlsVisible(true);
        clearTimeout(controlsTimerRef.current);
        setTvNav((n) => ({ ...n, focus: 0 }));
        return;
      }

      if (inSettings && norm) {
        e.preventDefault();
        // Keep controls pinned while navigating settings.
        setTvControlsVisible(true);
        clearTimeout(controlsTimerRef.current);

        const focusItem = items[nav.focus];
        // OK on an action icon (no menu) toggles it directly.
        if (norm === "ok" && !nav.inMenu && focusItem && !focusItem.items) {
          focusItem.action?.();
          return;
        }
        const ctx = {
          iconCount: items.length,
          menuLen: focusItem && focusItem.items ? focusItem.items.length : 0,
          initialMenuIndex: focusItem ? focusItem.selected || 0 : 0,
        };
        const { state: ns, effect } = tvNavReduce(nav, norm, ctx);
        setTvNav(ns);
        if (effect && effect.type === "apply" && focusItem && focusItem.items) {
          focusItem.items[effect.index]?.run?.();
        }
        // Leaving the row (focus back to -1): resume the normal hide timer.
        if (ns.focus < 0 && !ns.inMenu) {
          controlsTimerRef.current = setTimeout(() => setTvControlsVisible(false), 4000);
        }
        return;
      }

      // Block D-pad UP/DOWN from moving browser focus to overlay buttons on TV.
      // For LIVE on TV, repurpose Up/Down as channel zap (ch+/ch-).
      if (k === 38 || k === 40) {
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
        case "ArrowLeft":
          e.preventDefault();
          video.currentTime -= 10;
          break;
        case "ArrowRight":
          e.preventDefault();
          video.currentTime += 10;
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
  }, [currentVideo, videoRef, handleClose, handleRetry, showTvControls, isLive, handleChannelUp, handleChannelDown, applySpeed, setShowStats, tvControlsVisible]);

  if (!currentVideo) return null;

  // No frozen-frame canvas on TV: webOS/Tizen decode video onto a hardware
  // overlay plane that canvas.drawImage() can't read (it captures pure black),
  // so a canvas snapshot is useless here. Instead we leave the real <video>
  // uncovered — the hardware plane retains the last decoded frame through
  // ordinary buffering — and float a light scrim + spinner over it, so the last
  // movie image stays visible while loading. (A genuine reconnect tears down
  // MSE and blanks the plane; that case is unavoidably black on TV.)
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
        // Light scrim so the retained last frame shows through behind the
        // spinner. On first load / reconnect there's no frame and the plane is
        // black anyway, so a light scrim reads as black — no downside there.
        backgroundColor: playerScrim.busy,
        pointerEvents: "none",
      }}
      role="status"
      aria-live="polite"
    >
      <div
        className="tv-busy-spinner"
        style={{
          width: 72,
          height: 72,
          border: "6px solid rgba(255,255,255,0.22)",
          borderTopColor: colors.accent2,
          borderRadius: "50%",
          willChange: "transform",
        }}
      />
      <span style={{ color: colors.text, fontFamily: fonts.body, fontSize: 18, fontWeight: 600 }}>
        {isRecovering ? "Reconnecting…" : "Loading…"}
      </span>
    </div>
  );

  // TV settings descriptor: the ordered, currently-available icons and, for
  // menu icons, their items + current selection. Rebuilt each render (cheap).
  // `action` icons (stats) have no items — OK toggles them directly.
  const tvSortedLevels = [...qualityLevels]
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (b.l.height || 0) - (a.l.height || 0));
  const tvSettingsItems = [
    // Start over / Next are focusable action chips (not dead top-bar buttons) so
    // the D-pad can actually reach them — OK on an item with no `items` fires
    // its action directly (see the keydown reducer).
    !isLive && resume.hasResume && startTime > 0 && {
      key: "startover",
      icon: controlIcon.startOver,
      name: controlLabel.startOver,
      action: handleStartOver,
    },
    nextEpisode && {
      key: "next",
      icon: controlIcon.nextEpisode,
      name: `Next S${String(nextEpisode.seasonNum).padStart(2, "0")}E${String(nextEpisode.episode.episode_num).padStart(2, "0")}`,
      action: handleNextEpisode,
    },
    // Everyday controls first (Subtitles → Audio → Speed → Fit), matching the
    // primary-then-More ordering the touch and web players use, so the same
    // functions sit in the same place whichever screen the viewer is on. The
    // rarer picture/quality/stats controls trail behind them.
    subtitleTracks.length > 0 && {
      key: "subtitle",
      icon: controlIcon.subtitles,
      name: controlLabel.subtitles,
      items: [
        { label: "Off", active: selectedSubtitle === -1, run: () => applySubtitle(-1) },
        ...subtitleTracks.map((t, i) => ({ label: t.name || `Track ${i + 1}`, active: selectedSubtitle === i, run: () => applySubtitle(i) })),
      ],
      selected: selectedSubtitle === -1 ? 0 : selectedSubtitle + 1,
    },
    audioTracks.length > 1 && {
      key: "audio",
      icon: controlIcon.audio,
      name: controlLabel.audio,
      items: audioTracks.map((t, i) => ({ label: t.name || `Track ${i + 1}`, active: selectedAudio === i, run: () => applyAudio(i) })),
      selected: Math.max(0, selectedAudio),
    },
    {
      key: "speed",
      icon: controlIcon.speed,
      name: controlLabel.speed,
      label: `${playbackRate}x`,
      items: SPEEDS.map((r) => ({ label: `${r}x${r === 1 ? " (Normal)" : ""}`, active: playbackRate === r, run: () => applySpeed(r) })),
      selected: Math.max(0, SPEEDS.indexOf(playbackRate)),
    },
    {
      key: "aspect",
      icon: controlIcon.fit,
      name: controlLabel.fit,
      items: ASPECT_RATIOS.map(({ value, label }) => ({ label, active: aspectRatio === value, run: () => applyAspect(value) })),
      selected: Math.max(0, ASPECT_RATIOS.findIndex(({ value }) => value === aspectRatio)),
    },
    {
      key: "sleep",
      icon: controlIcon.sleep,
      name: sleep.active ? `${controlLabel.sleep} ${formatRemaining(sleep.secondsLeft)}` : controlLabel.sleep,
      items: [
        ...SLEEP_PRESETS.map((p) => ({
          label: p.label,
          active: false,
          run: () => (p.kind === "end-of-episode" ? sleep.cancel() : sleep.start(p.minutes)),
        })),
        ...(sleep.active ? [{ label: "Cancel timer", active: true, run: () => sleep.cancel() }] : []),
      ],
      selected: 0,
    },
    {
      key: "brightness",
      icon: "brightness",
      name: "Brightness",
      items: ADJUST_LEVELS.map((lvl) => ({
        label: `${lvl}%${lvl === 100 ? " (Normal)" : ""}`,
        active: videoAdjust.brightness === lvl,
        run: () => applyVideoAdjust({ brightness: lvl }),
      })),
      selected: Math.max(0, ADJUST_LEVELS.indexOf(videoAdjust.brightness)),
    },
    {
      key: "contrast",
      icon: "contrast",
      name: "Contrast",
      items: ADJUST_LEVELS.map((lvl) => ({
        label: `${lvl}%${lvl === 100 ? " (Normal)" : ""}`,
        active: videoAdjust.contrast === lvl,
        run: () => applyVideoAdjust({ contrast: lvl }),
      })),
      selected: Math.max(0, ADJUST_LEVELS.indexOf(videoAdjust.contrast)),
    },
    qualityLevels.length > 1 && {
      key: "quality",
      icon: controlIcon.quality,
      name: controlLabel.quality,
      items: [
        { label: "Auto", active: selectedLevel === -1, run: () => handleSelectLevel(-1) },
        ...tvSortedLevels.map(({ l, i }) => ({ label: getLevelLabel(l, qualityLevels), active: selectedLevel === i, run: () => handleSelectLevel(i) })),
      ],
      selected: selectedLevel === -1 ? 0 : (tvSortedLevels.findIndex(({ i }) => i === selectedLevel) + 1),
    },
    {
      key: "stats",
      icon: controlIcon.stats,
      name: controlLabel.stats,
      action: () => setShowStats((v) => !v),
    },
  ].filter(Boolean);

  // Mirror nav state + the descriptor into refs so the global keydown listener
  // (registered once, in capture phase) always reads the latest without needing
  // to re-subscribe each render.
  tvNavRef.current = tvNav;
  tvSettingsItemsRef.current = tvSettingsItems;

  return (
    <div style={TV.overlay}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        crossOrigin="anonymous"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          // Brightness/contrast picture adjustment (undefined when neutral).
          filter: videoFilter || undefined,
        }}
      />

      {/* Controls overlay */}
      <div style={TV.controls(tvControlsVisible)} onClick={showTvControls}>
        {/* Top bar */}
        <div style={TV.topBar}>
          <button style={TV.closeBtn} tabIndex={-1} onClick={handleClose} aria-label="Close player">
            <Icon name="close" size={26} color={colors.text} />
          </button>
          <span style={TV.title}>
            {currentVideo.name}
            {isLive && nowNext.now && (
              <span style={{ display: "block", fontSize: 18, fontWeight: 500, color: colors.accentText }}>
                {`NOW: ${nowNext.now.title}`}
                {nowNext.next ? `  ·  NEXT: ${nowNext.next.title}` : ""}
              </span>
            )}
          </span>
          {/* Start over (auto-resumed VOD) and Next episode are now D-pad-reachable
              chips in the settings row below — see tvSettingsItems — so the remote
              can actually trigger them (the old top-bar buttons responded only to
              onClick, which never fires on a pointerless TV). */}
        </div>

        {/* Center — play/pause icon (spinner is handled by the busy overlay) */}
        <div style={TV.center}>
          {isBusy ? null : (
            <span style={TV.playIcon} role="img" aria-label={tvPaused ? "Paused" : "Playing"}>
              {tvPaused ? (
                <Icon name="play" size={80} color="rgba(255,255,255,0.9)" />
              ) : (
                <Icon name="pause" size={80} color="rgba(255,255,255,0.9)" />
              )}
            </span>
          )}
        </div>

        {/* Bottom bar — progress + time */}
        <div style={TV.bottomBar}>
          {/* Settings icon row + upward menu */}
          <div style={TV.settingsRow}>
            {tvSettingsItems.map((item, idx) => {
              const focused = !tvNav.inMenu && tvNav.focus === idx;
              const menuOpen = tvNav.inMenu && tvNav.focus === idx;
              return (
                <div key={item.key} style={{ position: "relative" }}>
                  <div
                    style={TV.settingsIcon(focused || menuOpen)}
                    role="button"
                    aria-label={`${item.name}${item.label ? `, ${item.label}` : ""}`}
                  >
                    <Icon name={item.icon} size={26} color="currentColor" />
                    {/* Label reveals on focus only. At rest the row is an
                        icon-only rail (11 chips fit one line at 1280 instead of
                        wrapping into a dense band over the video); the focused
                        chip expands to name itself, and aria-label carries the
                        name for screen readers at all times. Standard 10-foot
                        transport-bar pattern — chrome recedes, content stays hero. */}
                    {(focused || menuOpen) && <span>{item.name}</span>}
                  </div>
                  {menuOpen && item.items && (
                    <div style={TV.settingsMenu}>
                      {item.items.map((mi, mIdx) => (
                        <div
                          key={mi.label}
                          ref={tvNav.menuIndex === mIdx ? menuItemElRef : undefined}
                          style={TV.settingsMenuItem(tvNav.menuIndex === mIdx, mi.active)}
                        >
                          <span>{mi.label}</span>
                          {mi.active ? <Icon name="check" size={20} color={colors.accentText} /> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {currentVideo.type !== "live" ? (
            <>
              <div
                style={TV.progressTrack}
                role="slider"
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={Math.round(tvDuration) || 0}
                aria-valuenow={Math.round(tvCurrentTime) || 0}
                aria-valuetext={`${fmtTime(tvCurrentTime)} of ${fmtTime(tvDuration)}`}
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
                  ▲ Settings · ◀◀ -10s · OK: play/pause · +10s ▶▶
                </span>
                <span>{fmtTime(tvDuration)}</span>
              </div>
            </>
          ) : (
            <div style={TV.seekHint}>▲ Settings · ▼ Channel · OK: play/pause</div>
          )}
        </div>
      </div>

      {/* Stats overlay (toggle with 'i' on the remote/keyboard). */}
      {showStats && <StatsOverlay stats={stats} />}

      {/* Error */}
      {isFatal && (
        <div style={{ ...TV.stateOverlay, zIndex: 20, backgroundColor: playerScrim.fatal, display: "flex", flexDirection: "column" }}>
          <StatePanel
            mode="error"
            title={FATAL_TITLE}
            message={FATAL_HEADLINE}
            onRetry={handleRetry}
            retryFocused={fatalFocus === 0}
          />
          {/* Raw engine reason as quiet secondary detail — matches web/native. */}
          {fatalMessage ? (
            <div style={{ textAlign: "center", color: colors.muted, fontFamily: fonts.body, fontSize: 16, padding: "0 48px" }}>
              {fatalMessage}
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 16, paddingBottom: 48 }}>
            <Button variant="secondary" size="lg" icon="close" isFocused={fatalFocus === 1} onPress={handleClose}>
              Close
            </Button>
          </div>
        </div>
      )}

      {busyOverlay}

      <style>{`@keyframes spin { from { transform: translateZ(0) rotate(0deg); } to { transform: translateZ(0) rotate(360deg); } } .tv-busy-spinner { animation: spin 0.8s linear infinite; } @media (prefers-reduced-motion: reduce) { .tv-busy-spinner { animation: none; } }`}</style>
    </div>
  );
}
