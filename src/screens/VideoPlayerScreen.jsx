import { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Platform,
  Modal,
  ScrollView,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useApp } from '../context/AppContext';
import iptvApi from '../services/iptvApi';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export default function VideoPlayerScreen({ navigation }) {
  const { currentVideo, closeVideo, updateWatchProgress, addToWatchHistory, playVideo } = useApp();
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

  const player = useVideoPlayer(
    currentVideo ? { uri: currentVideo.url } : null,
    (p) => {
      if (!currentVideo) return;
      if (currentVideo.startTime && currentVideo.startTime > 0) {
        p.currentTime = currentVideo.startTime;
      }
      p.play();
    }
  );

  // Auto-hide controls after 4 seconds
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 4000);
  }, []);

  useEffect(() => {
    resetControlsTimer();
    return () => clearTimeout(controlsTimerRef.current);
  }, []);

  // Load available audio/subtitle tracks
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener('statusChange', (status) => {
      if (status.status === 'readyToPlay') {
        try {
          if (player.availableAudioTracks?.length > 0) {
            setAudioTracks(player.availableAudioTracks);
            setSelectedAudio(player.audioTrack ?? null);
          }
          if (player.availableSubtitleTracks?.length > 0) {
            setSubtitleTracks(player.availableSubtitleTracks);
          }
        } catch {}
      }
    });
    return () => sub?.remove();
  }, [player]);

  // Add to watch history once per video (VOD only)
  useEffect(() => {
    if (!currentVideo || hasAddedToHistory.current) return;
    if (currentVideo.type !== 'live') {
      hasAddedToHistory.current = true;
      addToWatchHistory({ ...currentVideo, currentTime: currentVideo.startTime || 0 });
    }
  }, [currentVideo?.url]);

  useEffect(() => {
    hasAddedToHistory.current = false;
    setSpeed(1);
    setAudioTracks([]);
    setSubtitleTracks([]);
    setSelectedAudio(null);
    setSelectedSubtitle(null);
  }, [currentVideo?.url]);

  // Progress tracking every 10 seconds
  useEffect(() => {
    if (!player || !currentVideo || currentVideo.type === 'live') return;
    const sub = player.addListener('statusChange', (status) => {
      if (status.status === 'readyToPlay') {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = setInterval(() => {
          if (player && currentVideo) {
            updateWatchProgress(
              currentVideo.streamId,
              currentVideo.type,
              player.currentTime,
              Number.isFinite(player.duration) ? player.duration : 0
            );
          }
        }, 10000);
      }
    });
    return () => {
      sub?.remove();
      clearInterval(progressIntervalRef.current);
    };
  }, [currentVideo?.url, player]);

  // Next episode logic
  const getNextEpisode = useCallback(() => {
    if (!currentVideo || currentVideo.type !== 'series' || !currentVideo.seriesSeasons) return null;
    const allEpisodes = Object.keys(currentVideo.seriesSeasons)
      .map(Number)
      .sort((a, b) => a - b)
      .flatMap((sNum) =>
        [...(currentVideo.seriesSeasons[String(sNum)] || [])]
          .sort((a, b) => Number(a.episode_num) - Number(b.episode_num))
          .map((ep) => ({ ...ep, seasonNum: String(sNum) }))
      );
    const currentIdx = allEpisodes.findIndex(
      (ep) => String(ep.id) === String(currentVideo.streamId)
    );
    if (currentIdx === -1 || currentIdx >= allEpisodes.length - 1) return null;
    const next = allEpisodes[currentIdx + 1];
    return { episode: next, seasonNum: next.seasonNum };
  }, [currentVideo]);

  const handleNextEpisode = useCallback(() => {
    const next = getNextEpisode();
    if (!next) return;
    const { episode, seasonNum } = next;
    const streamUrl = iptvApi.buildStreamUrl('series', episode.id, episode.container_extension || 'mp4');
    const epNum = String(episode.episode_num).padStart(2, '0');
    const sNum = String(seasonNum).padStart(2, '0');
    playVideo({
      type: 'series',
      streamId: episode.id,
      seriesId: currentVideo.seriesId,
      seriesName: currentVideo.seriesName,
      name: `${currentVideo.seriesName} - S${sNum}E${epNum}`,
      url: streamUrl,
      seasonNum,
      episodeNum: episode.episode_num,
      seriesSeasons: currentVideo.seriesSeasons,
    });
  }, [getNextEpisode, currentVideo, playVideo]);

  useEffect(() => {
    if (!player || !currentVideo) return;
    const sub = player.addListener('playToEnd', () => {
      if (currentVideo.type === 'series' && getNextEpisode()) {
        handleNextEpisode();
      }
    });
    return () => sub?.remove();
  }, [player, currentVideo?.url, handleNextEpisode, getNextEpisode]);

  const handleClose = useCallback(() => {
    if (player && currentVideo && currentVideo.type !== 'live') {
      updateWatchProgress(
        currentVideo.streamId,
        currentVideo.type,
        player.currentTime,
        Number.isFinite(player.duration) ? player.duration : 0
      );
    }
    clearInterval(progressIntervalRef.current);
    closeVideo();
    navigation.goBack();
  }, [player, currentVideo, updateWatchProgress, closeVideo, navigation]);

  const handleSpeedChange = (rate) => {
    if (player) {
      player.playbackRate = rate;
      setSpeed(rate);
    }
    setShowSpeedMenu(false);
  };

  const handleAudioChange = (track) => {
    try {
      if (player) player.audioTrack = track;
      setSelectedAudio(track);
    } catch {}
    setShowAudioMenu(false);
  };

  const handleSubtitleChange = (track) => {
    try {
      if (player) player.subtitleTrack = track;
      setSelectedSubtitle(track);
    } catch {}
    setShowSubtitleMenu(false);
  };

  useEffect(() => {
    if (!currentVideo) navigation.goBack();
  }, [currentVideo]);

  if (!currentVideo || !player) return null;

  const nextEpisode = getNextEpisode();

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={resetControlsTimer}
      >
        <VideoView
          player={player}
          style={styles.video}
          nativeControls
          allowsFullscreen
          allowsPictureInPicture
        />
      </TouchableOpacity>

      {/* Top overlay */}
      {showControls && (
        <View style={styles.topOverlay} pointerEvents="box-none">
          <View style={styles.topBar}>
            {/* Close */}
            <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>

            {/* Title */}
            <Text style={styles.title} numberOfLines={1}>{currentVideo.name}</Text>

            {/* Speed */}
            <TouchableOpacity
              style={styles.controlBtn}
              onPress={() => { setShowSpeedMenu(true); setShowAudioMenu(false); setShowSubtitleMenu(false); }}
            >
              <Text style={styles.controlBtnText}>▶ {speed}x</Text>
            </TouchableOpacity>

            {/* Audio */}
            {audioTracks.length > 1 && (
              <TouchableOpacity
                style={styles.controlBtn}
                onPress={() => { setShowAudioMenu(true); setShowSpeedMenu(false); setShowSubtitleMenu(false); }}
              >
                <Text style={styles.controlBtnText}>♪ Audio</Text>
              </TouchableOpacity>
            )}

            {/* Subtitles */}
            {subtitleTracks.length > 0 && (
              <TouchableOpacity
                style={styles.controlBtn}
                onPress={() => { setShowSubtitleMenu(true); setShowSpeedMenu(false); setShowAudioMenu(false); }}
              >
                <Text style={styles.controlBtnText}>CC</Text>
              </TouchableOpacity>
            )}

            {/* Next episode */}
            {nextEpisode && (
              <TouchableOpacity style={styles.nextBtn} onPress={handleNextEpisode}>
                <Text style={styles.nextBtnText}>Next ▶</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Speed Menu Modal */}
      <Modal visible={showSpeedMenu} transparent animationType="fade" onRequestClose={() => setShowSpeedMenu(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowSpeedMenu(false)}>
          <View style={styles.menu}>
            <Text style={styles.menuTitle}>Playback Speed</Text>
            <ScrollView>
              {SPEEDS.map((rate) => (
                <TouchableOpacity
                  key={rate}
                  style={[styles.menuItem, speed === rate && styles.menuItemActive]}
                  onPress={() => handleSpeedChange(rate)}
                >
                  <Text style={[styles.menuItemText, speed === rate && styles.menuItemTextActive]}>
                    {rate}x{rate === 1 ? ' (Normal)' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Audio Menu Modal */}
      <Modal visible={showAudioMenu} transparent animationType="fade" onRequestClose={() => setShowAudioMenu(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowAudioMenu(false)}>
          <View style={styles.menu}>
            <Text style={styles.menuTitle}>Audio Track</Text>
            <ScrollView>
              {audioTracks.map((track, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.menuItem, selectedAudio === track && styles.menuItemActive]}
                  onPress={() => handleAudioChange(track)}
                >
                  <Text style={[styles.menuItemText, selectedAudio === track && styles.menuItemTextActive]}>
                    {track.language || track.label || `Track ${idx + 1}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Subtitle Menu Modal */}
      <Modal visible={showSubtitleMenu} transparent animationType="fade" onRequestClose={() => setShowSubtitleMenu(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowSubtitleMenu(false)}>
          <View style={styles.menu}>
            <Text style={styles.menuTitle}>Subtitles</Text>
            <ScrollView>
              <TouchableOpacity
                style={[styles.menuItem, selectedSubtitle === null && styles.menuItemActive]}
                onPress={() => handleSubtitleChange(null)}
              >
                <Text style={[styles.menuItemText, selectedSubtitle === null && styles.menuItemTextActive]}>
                  Off
                </Text>
              </TouchableOpacity>
              {subtitleTracks.map((track, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.menuItem, selectedSubtitle === track && styles.menuItemActive]}
                  onPress={() => handleSubtitleChange(track)}
                >
                  <Text style={[styles.menuItemText, selectedSubtitle === track && styles.menuItemTextActive]}>
                    {track.language || track.label || `Track ${idx + 1}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  video: { flex: 1 },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Platform.OS === 'ios' ? 12 : 8,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    flexWrap: 'wrap',
    gap: 8,
  },
  closeBtn: {
    width: 34,
    height: 34,
    backgroundColor: 'rgba(233,69,96,0.9)',
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  title: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '600', minWidth: 60 },
  controlBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  controlBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  nextBtn: {
    backgroundColor: 'rgba(233,69,96,0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  nextBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  // Menu Modal
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menu: {
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    padding: 8,
    width: 220,
    maxHeight: 350,
    borderWidth: 1,
    borderColor: '#2a2a4e',
  },
  menuTitle: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4e',
    marginBottom: 4,
  },
  menuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  menuItemActive: { backgroundColor: 'rgba(233,69,96,0.2)' },
  menuItemText: { color: '#ccc', fontSize: 15 },
  menuItemTextActive: { color: '#e94560', fontWeight: '700' },
});
