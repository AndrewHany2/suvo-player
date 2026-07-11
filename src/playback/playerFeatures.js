// @ts-check
/**
 * Non-core player feature hooks split out of usePlayer.js. These cover the
 * PERIPHERAL concerns — picture-in-picture / cast, the web custom-controls
 * mirror, subtitle rendering (::cue styling + delay offset), and the debug stats
 * overlay. None of them touch the load / recovery / resume core (that stays in
 * usePlayer + useResilientPlayback), so the god-hook shrinks without moving the
 * risky playback wiring.
 *
 * Each hook is a verbatim extraction: same state, same effects, same dependency
 * arrays as the original inline code. usePlayer calls them in place, so the
 * overall effect behavior is unchanged.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  isPipSupported,
  enterPip,
  exitPip,
  isPipActive,
  isWebCastAvailable,
  isRemotePlaybackSupported,
  promptRemotePlayback,
} from "./mediaCapabilities";
import { toCssTextTrackStyle } from "./subtitleStyle";

/**
 * Picture-in-picture + cast controls, plus the pipActive mirror kept in sync
 * with the browser (covers native exit from the PiP window's own controls).
 *
 * @param {object} opts
 * @param {{current: HTMLVideoElement|null}} opts.videoRef
 * @param {string|null|undefined} opts.sourceKey  currentVideo?.url — re-binds the pip listeners per source
 */
export function usePictureInPicture({ videoRef, sourceKey }) {
  const [pipActive, setPipActive] = useState(false);
  const pipSupported = isPipSupported(videoRef.current);
  const castSupported = isWebCastAvailable(videoRef.current);

  const handleTogglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPipActive(video)) {
      await exitPip();
    } else {
      await enterPip(video);
    }
    setPipActive(isPipActive(video));
  }, [videoRef]);

  const handleCast = useCallback(async () => {
    const video = videoRef.current;
    if (video && isRemotePlaybackSupported(video)) {
      await promptRemotePlayback(video);
    }
    // If only the Cast SDK is present (no Remote Playback), there's nothing we
    // can prompt without the framework UI; the button still surfaces presence.
  }, [videoRef]);

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
  }, [videoRef, sourceKey]);

  return { pipActive, pipSupported, castSupported, handleTogglePip, handleCast };
}

/**
 * Web custom controls (native `<video controls>` is disabled on web): play/pause
 * toggle, scrub-to-clientX, volume + mute, and the volume/mute mirror kept in
 * sync with the element (covers the keyboard ↑/↓ volume shortcuts, which set
 * video.volume directly).
 *
 * @param {object} opts
 * @param {{current: HTMLVideoElement|null}} opts.videoRef
 * @param {number} opts.duration  current media duration (tvDuration)
 * @param {string|null|undefined} opts.sourceKey  currentVideo?.url
 */
export function useWebVideoControls({ videoRef, duration, sourceKey }) {
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const togglePlayWeb = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  }, [videoRef]);

  const seekWebToClientX = useCallback((clientX, el) => {
    const v = videoRef.current;
    if (!v || !el || !(duration > 0)) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    try { v.currentTime = ratio * duration; } catch { /* not seekable yet */ }
  }, [videoRef, duration]);

  const applyVolumeWeb = useCallback((vol) => {
    const v = videoRef.current;
    const nv = Math.max(0, Math.min(1, vol));
    if (v) { v.volume = nv; v.muted = nv === 0; }
    setVolume(nv);
    setMuted(nv === 0);
  }, [videoRef]);

  const toggleMuteWeb = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, [videoRef]);

  // Keep the volume slider/mute icon in sync with the element (covers the
  // keyboard ↑/↓ volume shortcuts, which set video.volume directly).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    const onVol = () => { setVolume(v.volume); setMuted(v.muted); };
    v.addEventListener("volumechange", onVol);
    return () => v.removeEventListener("volumechange", onVol);
  }, [videoRef, sourceKey]);

  return { volume, muted, togglePlayWeb, seekWebToClientX, applyVolumeWeb, toggleMuteWeb };
}

/**
 * Subtitle rendering: inject a scoped `::cue` rule from the remembered style, and
 * shift active TextTrack cue timings by the subtitle delay offset.
 *
 * DOM ::cue properties aren't settable inline, so we drive them off a one-off
 * <style> element kept in sync with the subtitle-style preference. NOTE:
 * audioOffsetMs is persisted and surfaced in the UI, but neither the HTML
 * <video> element nor hls.js exposes an a/v sync delay we can drive on the web,
 * so audio offset is a no-op here (documented).
 *
 * @param {object} opts
 * @param {{current: HTMLVideoElement|null}} opts.videoRef
 * @param {object} opts.subtitleStyle
 * @param {number} opts.subtitleOffsetMs
 * @param {number} opts.selectedSubtitle
 * @param {any[]}  opts.subtitleTracks
 * @param {string|null|undefined} opts.sourceKey  currentVideo?.url
 */
export function useSubtitleRendering({ videoRef, subtitleStyle, subtitleOffsetMs, selectedSubtitle, subtitleTracks, sourceKey }) {
  const cueStyleElRef = useRef(/** @type {HTMLStyleElement|null} */ (null));
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    let el = cueStyleElRef.current;
    if (!el) {
      el = document.createElement("style");
      el.setAttribute("data-suvo-cue", "1");
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
  }, [videoRef, subtitleOffsetMs, selectedSubtitle, subtitleTracks]);

  // Reset the applied-offset baseline when the source changes.
  useEffect(() => { appliedSubOffsetRef.current = 0; }, [sourceKey]);
}

/**
 * Debug stats overlay: polls the element + hls.js instance once a second WHILE
 * the overlay is shown, into a stats object. Idle (no interval) when hidden.
 *
 * @param {object} opts
 * @param {boolean} opts.showStats
 * @param {{current: HTMLVideoElement|null}} opts.videoRef
 * @param {{current: any}} opts.hlsRef
 * @returns {object} the latest stats snapshot
 */
export function useVideoStats({ showStats, videoRef, hlsRef }) {
  const [stats, setStats] = useState({});
  useEffect(() => {
    // Clear the snapshot when hidden so a reopened overlay never flashes stale
    // numbers from a previous source (the old inline code reset this on every
    // source change).
    if (!showStats) { setStats({}); return undefined; }
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
  }, [showStats, videoRef, hlsRef]);

  return stats;
}
