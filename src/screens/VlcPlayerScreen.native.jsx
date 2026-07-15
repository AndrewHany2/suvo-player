import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { StatusBar, Platform, TouchableOpacity, AppState, Modal, View } from "react-native";
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
import { createVlcDriver } from "../playback/drivers/vlcDriver";
import { findNextEpisode, buildNextEpisodeVideo } from "../playback/episodeNav";
import { useResilientPlayback } from "../playback/useResilientPlayback";
import { useResumePosition } from "../playback/useResumePosition";
import { usePlayerPreferences } from "../playback/usePlayerPreferences";
import { useDeviceIntegrity } from "../security/useDeviceIntegrity";
import ResumePrompt from "../playback/components/ResumePrompt";
import { formatDuration as formatTime } from "../utils/formatDuration";

const MODAL_ORIENTATIONS = ["portrait", "landscape"];
// VLCPlayer resizeMode values; cycled by the aspect button.
const RESIZE_MODES = ["contain", "cover", "fill"];

export default function VlcPlayerScreen({ navigation }) {
  const { currentVideo, closeVideo, playVideo } = usePlayback();
  const { updateWatchProgress, addToWatchHistory, flushProgress } = useWatchHistory();
  const insets = useSafeAreaInsets();
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
  });

  const isLoading = playback.status === "idle" || playback.status === "loading";
  const isRecovering = playback.isRecovering;
  const isFatal = playback.isFatal;

  // Refs mirroring latest progress for lifecycle writes.
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

  // Keep awake + lock portrait (mirrors the expo screen).
  useEffect(() => {
    activateKeepAwakeAsync().catch(() => {});
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    return () => {
      try {
        deactivateKeepAwake();
      } catch {
        /* noop */
      }
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
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
    setProgress({ position: 0, currentTimeSec: 0, durationSec: 0 });
  }, [currentVideo?.url]);

  // Apply remembered aspect once prefs load.
  useEffect(() => {
    if (!prefsLoaded || prefsAppliedRef.current) return;
    if (prefs.aspectRatio && RESIZE_MODES.includes(prefs.aspectRatio)) setResizeMode(prefs.aspectRatio);
    prefsAppliedRef.current = true;
  }, [prefsLoaded, prefs.aspectRatio]);

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

  const handleAudioChange = (track) => {
    setSelectedAudio(track ? track.id : null);
    setShowAudioMenu(false);
  };
  const handleTextChange = (id) => {
    setSelectedText(id);
    setShowTextMenu(false);
  };

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

  return (
    <YStack flex={1} backgroundColor="#000">
      <StatusBar hidden />

      <View style={{ position: "absolute", top: insets.top, left: 0, right: 0, bottom: insets.bottom }}>
        {vlcSource && (
          <VLCPlayer
            ref={vlcRef}
            style={{ flex: 1 }}
            source={vlcSource}
            paused={paused}
            resizeMode={resizeMode}
            audioTrack={selectedAudio ?? undefined}
            textTrack={selectedText}
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

      {/* Tap surface toggles controls. */}
      <TouchableOpacity
        activeOpacity={1}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        onPress={resetControlsTimer}
      />

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
        <YStack position="absolute" top={0} left={0} right={0} paddingTop={insets.top + topPadding} pointerEvents="box-none">
          <XStack alignItems="center" paddingHorizontal={12} paddingVertical={8} backgroundColor="rgba(0,0,0,0.7)" gap={8} flexWrap="wrap">
            <YStack width={34} height={34} backgroundColor={accentAlpha(0.9)} borderRadius={17} justifyContent="center" alignItems="center" cursor="pointer" onPress={handleClose} pressStyle={{ opacity: 0.8 }}>
              <Icon name="close" size={16} color={colors.text} />
            </YStack>
            <Text color={colors.text} fontFamily={fonts.display} fontSize={14} fontWeight="600" flex={1} minWidth={60} numberOfLines={1}>{currentVideo.name}</Text>
            {nextEpisode && <Button variant="primary" size="sm" icon="play" onPress={handleNextEpisode}>Next</Button>}
          </XStack>
        </YStack>
      )}

      {showControls && (
        <YStack position="absolute" bottom={0} left={0} right={0} paddingBottom={insets.bottom + 12} backgroundColor="rgba(0,0,0,0.7)" zIndex={20}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Button variant="secondary" size="sm" icon={paused ? "play" : "pause"} onPress={() => setPaused((p) => !p)} />
            {audioTracks.length > 1 && (
              <Button variant="secondary" size="sm" icon="audio" onPress={() => { setShowAudioMenu(true); setShowTextMenu(false); }} />
            )}
            {textTracks.length > 0 && (
              <Button variant="secondary" size="sm" icon="cc" onPress={() => { setShowTextMenu(true); setShowAudioMenu(false); }} />
            )}
            <Button variant="secondary" size="sm" icon="aspect" onPress={cycleResizeMode} />
          </ScrollView>

          {progress.durationSec > 0 && (
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

      {/* Audio menu */}
      <Modal visible={showAudioMenu} transparent animationType="fade" supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowAudioMenu(false)}>
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
      <Modal visible={showTextMenu} transparent animationType="fade" supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowTextMenu(false)}>
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
    </YStack>
  );
}
