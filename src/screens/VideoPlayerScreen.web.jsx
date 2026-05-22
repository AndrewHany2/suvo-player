import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { useApp } from '../context/AppContext';
import iptvApi from '../services/iptvApi';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const ASPECT_RATIOS = [
  { value: 'default', label: 'Default' },
  { value: '16:9',    label: '16:9' },
  { value: '4:3',     label: '4:3' },
  { value: 'fill',    label: 'Fill' },
  { value: 'stretch', label: 'Stretch' },
];

const S = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000', zIndex: 9999, display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
    backgroundColor: 'rgba(0,0,0,0.85)', flexShrink: 0, flexWrap: 'wrap',
  },
  title: { flex: 1, color: '#fff', fontSize: 14, fontWeight: 600, minWidth: 60, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
  videoWrapper: { flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  video: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
  btn: {
    backgroundColor: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)',
    color: '#fff', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap',
  },
  closeBtn: {
    backgroundColor: 'rgba(233,69,96,0.9)', border: 'none', color: '#fff',
    borderRadius: '50%', width: 32, height: 32, fontSize: 14, fontWeight: 700,
    cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  nextBtn: {
    backgroundColor: 'rgba(233,69,96,0.9)', border: 'none', color: '#fff',
    borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  dropdown: { position: 'relative' },
  menu: {
    position: 'absolute', top: '110%', right: 0, backgroundColor: '#1a1a2e',
    border: '1px solid #2a2a4e', borderRadius: 8, padding: 4, minWidth: 130,
    zIndex: 100, maxHeight: 220, overflowY: 'auto',
  },
  menuItem: (active) => ({
    padding: '9px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14,
    color: active ? '#e94560' : '#ccc', fontWeight: active ? 700 : 400,
    backgroundColor: active ? 'rgba(233,69,96,0.12)' : 'transparent',
  }),
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', gap: 10,
  },
  errorOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)', color: '#fff', gap: 10,
  },
  footer: { padding: '4px 12px', backgroundColor: 'rgba(0,0,0,0.7)', color: '#666', fontSize: 11, flexShrink: 0 },
};

export default function VideoPlayerScreen() {
  const { currentVideo, closeVideo, updateWatchProgress, addToWatchHistory, playVideo } = useApp();

  const videoRef     = useRef(null);
  const hlsRef       = useRef(null);
  const progressRef  = useRef(null);
  const lastUrlRef   = useRef(null);

  const [isLoading,          setIsLoading]          = useState(true);
  const [error,              setError]              = useState(null);
  const [qualityLevels,      setQualityLevels]      = useState([]);
  const [selectedLevel,      setSelectedLevel]      = useState(-1);
  const [showQuality,        setShowQuality]        = useState(false);
  const [playbackRate,       setPlaybackRate]       = useState(1);
  const [showSpeed,          setShowSpeed]          = useState(false);
  const [audioTracks,        setAudioTracks]        = useState([]);
  const [selectedAudio,      setSelectedAudio]      = useState(0);
  const [showAudio,          setShowAudio]          = useState(false);
  const [subtitleTracks,     setSubtitleTracks]     = useState([]);
  const [selectedSubtitle,   setSelectedSubtitle]   = useState(-1);
  const [showSubtitle,       setShowSubtitle]       = useState(false);
  const [aspectRatio,        setAspectRatio]        = useState('default');
  const [showAspect,         setShowAspect]         = useState(false);

  const qualityRef   = useRef(null);
  const speedRef     = useRef(null);
  const audioRef     = useRef(null);
  const subtitleRef  = useRef(null);
  const aspectRef    = useRef(null);

  const stopProgress = useCallback(() => {
    clearInterval(progressRef.current);
    progressRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    const video = videoRef.current;
    if (video && currentVideo) {
      updateWatchProgress(currentVideo.streamId, currentVideo.type, video.currentTime,
        Number.isFinite(video.duration) ? video.duration : 0);
    }
    stopProgress();
    closeVideo();
  }, [currentVideo, updateWatchProgress, stopProgress, closeVideo]);

  // HLS init — only re-runs when URL changes
  useEffect(() => {
    if (!currentVideo || !videoRef.current) return;
    if (lastUrlRef.current === currentVideo.url) return;
    lastUrlRef.current = currentVideo.url;

    const video = videoRef.current;
    const rawUrl = currentVideo.url;
    const url = currentVideo.type === 'live' && rawUrl.endsWith('.ts')
      ? rawUrl.replace(/\.ts$/, '.m3u8') : rawUrl;
    const isHls = url.includes('.m3u8');

    setIsLoading(true);
    setError(null);
    setQualityLevels([]);
    setSelectedLevel(-1);
    setShowQuality(false);
    video.playbackRate = 1;
    setPlaybackRate(1);
    setAudioTracks([]);
    setSelectedAudio(0);
    setSubtitleTracks([]);
    setSelectedSubtitle(-1);

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    const onMeta = () => {
      setIsLoading(false);
      if (currentVideo.startTime > 0) video.currentTime = currentVideo.startTime;
      video.play().catch(() => {});
    };

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 90, maxBufferLength: 30, maxMaxBufferLength: 60 });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        setQualityLevels(hls.levels);
        if (currentVideo.startTime > 0) video.currentTime = currentVideo.startTime;
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => { setAudioTracks([...hls.audioTracks]); setSelectedAudio(Math.max(0, hls.audioTrack)); });
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_e, d) => setSelectedAudio(d.id));
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => setSubtitleTracks([...hls.subtitleTracks]));
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_e, d) => setSelectedSubtitle(d.id));
      hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) { setError(`Stream error: ${d.type}`); setIsLoading(false); } });
    } else {
      video.src = url;
      video.addEventListener('loadedmetadata', onMeta, { once: true });
    }

    if (currentVideo.type !== 'live') {
      addToWatchHistory({ ...currentVideo, currentTime: currentVideo.startTime || 0 });
    }

    return () => {
      stopProgress();
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      video.removeEventListener('loadedmetadata', onMeta);
    };
  }, [currentVideo?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!currentVideo) lastUrlRef.current = null; }, [currentVideo]);

  // Video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentVideo) return;

    const onPlay = () => {
      clearInterval(progressRef.current);
      progressRef.current = setInterval(() => {
        if (video && !video.paused && currentVideo) {
          updateWatchProgress(currentVideo.streamId, currentVideo.type, video.currentTime,
            Number.isFinite(video.duration) ? video.duration : 0);
        }
      }, 10000);
    };
    const onPause  = () => { if (currentVideo) updateWatchProgress(currentVideo.streamId, currentVideo.type, video.currentTime, Number.isFinite(video.duration) ? video.duration : 0); };
    const onError  = () => { if (!hlsRef.current) { setError('Failed to load video'); setIsLoading(false); } };
    const onWait   = () => setIsLoading(true);
    const onCanPlay = () => setIsLoading(false);

    video.addEventListener('play',    onPlay);
    video.addEventListener('pause',   onPause);
    video.addEventListener('error',   onError);
    video.addEventListener('waiting', onWait);
    video.addEventListener('canplay', onCanPlay);
    return () => {
      video.removeEventListener('play',    onPlay);
      video.removeEventListener('pause',   onPause);
      video.removeEventListener('error',   onError);
      video.removeEventListener('waiting', onWait);
      video.removeEventListener('canplay', onCanPlay);
    };
  }, [currentVideo, updateWatchProgress]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (!currentVideo || !videoRef.current) return;
      const video = videoRef.current;
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); e.stopPropagation(); video.paused ? video.play() : video.pause(); break;
        case 'f': e.preventDefault(); document.fullscreenElement ? document.exitFullscreen() : video.requestFullscreen(); break;
        case 'Escape': handleClose(); break;
        case 'ArrowLeft':  e.preventDefault(); video.currentTime -= 10; break;
        case 'ArrowRight': e.preventDefault(); video.currentTime += 10; break;
        case 'ArrowUp':    e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); break;
        case 'ArrowDown':  e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); break;
        case '[': { e.preventDefault(); const i = SPEEDS.indexOf(video.playbackRate); const r = SPEEDS[Math.max(0, (i < 0 ? SPEEDS.indexOf(1) : i) - 1)]; video.playbackRate = r; setPlaybackRate(r); break; }
        case ']': { e.preventDefault(); const i = SPEEDS.indexOf(video.playbackRate); const r = SPEEDS[Math.min(SPEEDS.length - 1, (i < 0 ? SPEEDS.indexOf(1) : i) + 1)]; video.playbackRate = r; setPlaybackRate(r); break; }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [currentVideo, handleClose]);

  // Close all dropdowns on outside click
  useEffect(() => {
    if (!showQuality && !showSpeed && !showAudio && !showSubtitle && !showAspect) return;
    const onClick = (e) => {
      if (![qualityRef, speedRef, audioRef, subtitleRef, aspectRef].some(r => r.current?.contains(e.target))) {
        setShowQuality(false); setShowSpeed(false); setShowAudio(false); setShowSubtitle(false); setShowAspect(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showQuality, showSpeed, showAudio, showSubtitle, showAspect]);

  // Next episode helpers
  const getNextEpisode = useCallback(() => {
    if (!currentVideo || currentVideo.type !== 'series' || !currentVideo.seriesSeasons) return null;
    const all = Object.keys(currentVideo.seriesSeasons).map(Number).sort((a,b)=>a-b)
      .flatMap(s => [...(currentVideo.seriesSeasons[String(s)]||[])].sort((a,b)=>Number(a.episode_num)-Number(b.episode_num)).map(ep=>({...ep,seasonNum:String(s)})));
    const idx = all.findIndex(ep => String(ep.id) === String(currentVideo.streamId));
    if (idx < 0 || idx >= all.length - 1) return null;
    const next = all[idx + 1];
    return { episode: next, seasonNum: next.seasonNum };
  }, [currentVideo]);

  const handleNextEpisode = useCallback(() => {
    const next = getNextEpisode();
    if (!next) return;
    const { episode, seasonNum } = next;
    const url = iptvApi.buildStreamUrl('series', episode.id, episode.container_extension || 'mp4');
    const ep = String(episode.episode_num).padStart(2,'0');
    const sn = String(seasonNum).padStart(2,'0');
    playVideo({ type:'series', streamId:episode.id, seriesId:currentVideo.seriesId, seriesName:currentVideo.seriesName,
      name:`${currentVideo.seriesName} - S${sn}E${ep}`, url, seasonNum, episodeNum:episode.episode_num, seriesSeasons:currentVideo.seriesSeasons });
  }, [getNextEpisode, currentVideo, playVideo]);

  const getLevelLabel = (level, levels) => {
    if (!level.height) return `${Math.round(level.bitrate/1000)}k`;
    return levels.filter(l=>l.height===level.height).length > 1 ? `${level.height}p (${Math.round(level.bitrate/1000)}k)` : `${level.height}p`;
  };

  const getVideoStyle = () => {
    const base = { ...S.video };
    if (aspectRatio === '16:9') return { ...base, width:'auto', height:'100%', maxWidth:'100%', aspectRatio:'16/9', objectFit:'fill' };
    if (aspectRatio === '4:3')  return { ...base, width:'auto', height:'100%', maxWidth:'100%', aspectRatio:'4/3',  objectFit:'fill' };
    if (aspectRatio === 'fill')    return { ...base, objectFit:'cover' };
    if (aspectRatio === 'stretch') return { ...base, objectFit:'fill' };
    return base;
  };

  if (!currentVideo) return null;

  const nextEpisode = getNextEpisode();
  const currentQualityLabel = selectedLevel === -1 ? 'Auto' : getLevelLabel(qualityLevels[selectedLevel], qualityLevels);

  return (
    <div style={S.overlay}>
      {/* Header controls */}
      <div style={S.header}>
        <button style={S.closeBtn} onClick={handleClose} title="Close (Esc)">✕</button>
        <span style={S.title}>{currentVideo.name}</span>

        {/* Speed */}
        <div style={S.dropdown} ref={speedRef}>
          <button style={S.btn} onClick={() => setShowSpeed(p=>!p)}>▶ {playbackRate}x</button>
          {showSpeed && (
            <div style={S.menu}>
              {SPEEDS.map(r => (
                <div key={r} style={S.menuItem(playbackRate===r)} onClick={() => { videoRef.current && (videoRef.current.playbackRate=r); setPlaybackRate(r); setShowSpeed(false); }}>
                  {r}x{r===1?' (Normal)':''}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Audio */}
        {audioTracks.length > 1 && (
          <div style={S.dropdown} ref={audioRef}>
            <button style={S.btn} onClick={() => setShowAudio(p=>!p)}>♪ {audioTracks[selectedAudio]?.name || 'Audio'}</button>
            {showAudio && (
              <div style={S.menu}>
                {audioTracks.map((t, i) => (
                  <div key={i} style={S.menuItem(selectedAudio===i)} onClick={() => { if (hlsRef.current) hlsRef.current.audioTrack=i; setSelectedAudio(i); setShowAudio(false); }}>
                    {t.name || `Track ${i+1}`}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Subtitles */}
        {subtitleTracks.length > 0 && (
          <div style={S.dropdown} ref={subtitleRef}>
            <button style={S.btn} onClick={() => setShowSubtitle(p=>!p)}>
              CC {selectedSubtitle===-1 ? 'Off' : subtitleTracks[selectedSubtitle]?.name || `Track ${selectedSubtitle+1}`}
            </button>
            {showSubtitle && (
              <div style={S.menu}>
                <div style={S.menuItem(selectedSubtitle===-1)} onClick={() => { if (hlsRef.current) hlsRef.current.subtitleTrack=-1; setSelectedSubtitle(-1); setShowSubtitle(false); }}>Off</div>
                {subtitleTracks.map((t, i) => (
                  <div key={i} style={S.menuItem(selectedSubtitle===i)} onClick={() => { if (hlsRef.current) hlsRef.current.subtitleTrack=i; setSelectedSubtitle(i); setShowSubtitle(false); }}>
                    {t.name || `Track ${i+1}`}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Aspect Ratio */}
        <div style={S.dropdown} ref={aspectRef}>
          <button style={S.btn} onClick={() => setShowAspect(p=>!p)}>⊡ {aspectRatio==='default' ? 'Aspect' : aspectRatio}</button>
          {showAspect && (
            <div style={S.menu}>
              {ASPECT_RATIOS.map(({value, label}) => (
                <div key={value} style={S.menuItem(aspectRatio===value)} onClick={() => { setAspectRatio(value); setShowAspect(false); }}>{label}</div>
              ))}
            </div>
          )}
        </div>

        {/* Quality */}
        {qualityLevels.length > 1 && (
          <div style={S.dropdown} ref={qualityRef}>
            <button style={S.btn} onClick={() => setShowQuality(p=>!p)}>⚙ {currentQualityLabel}</button>
            {showQuality && (
              <div style={S.menu}>
                <div style={S.menuItem(selectedLevel===-1)} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel=-1; setSelectedLevel(-1); setShowQuality(false); }}>Auto</div>
                {[...qualityLevels].map((l,i)=>({l,i})).sort((a,b)=>(b.l.height||0)-(a.l.height||0)).map(({l,i}) => (
                  <div key={i} style={S.menuItem(selectedLevel===i)} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel=i; setSelectedLevel(i); setShowQuality(false); }}>
                    {getLevelLabel(l, qualityLevels)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Next episode */}
        {nextEpisode && (
          <button style={S.nextBtn} onClick={handleNextEpisode}
            title={`Next: S${String(nextEpisode.seasonNum).padStart(2,'0')}E${String(nextEpisode.episode.episode_num).padStart(2,'0')}`}>
            Next ▶
          </button>
        )}
      </div>

      {/* Video */}
      <div style={S.videoWrapper}>
        <video ref={videoRef} controls autoPlay playsInline crossOrigin="anonymous" style={getVideoStyle()} />

        {isLoading && (
          <div style={S.loadingOverlay}>
            <div style={{ width:40, height:40, border:'4px solid rgba(255,255,255,0.2)', borderTopColor:'#e94560', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
            <p style={{margin:0}}>Loading stream...</p>
          </div>
        )}
        {error && (
          <div style={S.errorOverlay}>
            <p style={{margin:0,fontSize:16}}>Failed to load stream</p>
            <p style={{margin:0,color:'#888',fontSize:13}}>{error}</p>
            <button style={{...S.btn, marginTop:8}} onClick={handleClose}>Close</button>
          </div>
        )}
      </div>

      {/* Footer hints */}
      <div style={S.footer}>Space/K: Play/Pause · F: Fullscreen · ←→: Seek · ↑↓: Volume · [ ]: Speed · Esc: Close</div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
