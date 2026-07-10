import { useState, useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";
import { useHistory } from "../domain/hooks/useHistory";
import Icon from "../ui/Icon";
import PosterCardWeb from "../presentation/components/PosterCard.web";
import ContinueCardTV from "../presentation/components/ContinueCard.tv";
import { VirtualShelvesTV } from "../presentation/components/VirtualShelves.tv";
import StatePanel from "../ui/StatePanel";
import { colors } from "../ui/tokens";
import { isMacCommand } from "../platform/adapters/input/keys";
import "../styles/tvl.css";
import "../styles/tvResponsiveScaling.css";
import "../styles/tvRemoteFocus.css";
import "./HistoryScreen.tv.css";
import "./MoviesScreen.tv.css";
import "./SeriesScreen.tv.css";

const KEY_LEFT = 37;
const KEY_UP = 38;
const KEY_RIGHT = 39;
const KEY_DOWN = 40;
const KEY_ENTER = 13;
const KEY_BACK = new Set([27, 461, 10009, 8, 91]);

// Home renders favorites/history as horizontal poster shelves (Netflix-style),
// reusing the canonical .tvl-card poster card from the Movies/Series grids.

import { getTrailerEmbedUrl as getTrailerUrl } from "../utils/youtubeTrailer";

// Continue-Watching card geometry (design px; VirtualShelvesTV scales via ss()).
// The portrait poster (POSTER_W = 340) is tuned for ~5 cards per rail view; at
// ~5/4× that width the landscape cards show 4-up instead.
// Row height = header + the card's 16:9 thumb + the title/episode/time-left block.
const CW_CARD_W = 425;
const CW_ROW_H = 40 + Math.round((CW_CARD_W * 9) / 16) + 120;

export default function HistoryScreenTV({ navigation }) {
  const {
    activeUserId,
    myList,
    removeFromMyList,
    addToMyList,
    isInMyList,
    currentVideo,
  } = useApp();
  // History list data, playback + url builders / info fetchers (routed through
  // ContentService/iptvApi inside the hook — the screen no longer imports either).
  // useHistory also keeps ContentService credentials in sync via useContentService.
  const {
    watchHistory,
    playLive,
    playVideoObject,
    buildMovieUrl,
    buildEpisodeUrl,
    fetchMovieInfo,
    fetchSeriesInfo,
  } = useHistory({ navigation });
  const currentVideoRef = useRef(null);
  useEffect(() => { currentVideoRef.current = currentVideo; }, [currentVideo]);

  // ── Movie detail state ────────────────────────────────────────────────────
  const [movieDetail, setMovieDetail] = useState(null);
  const movieDetailRef = useRef(null);
  const movieBtnRef = useRef(null);

  // ── Series detail state ───────────────────────────────────────────────────
  const [seriesDetail, setSeriesDetail] = useState(null);
  const seriesDetailRef = useRef(null);
  const seriesEpRef = useRef(null);
  const seriesSnRef = useRef(null);
  const seriesActionRef = useRef(null);

  const navActiveRef = useRef(false);

  const focusNav = () => {
    navActiveRef.current = true;
    globalThis.dispatchEvent(new CustomEvent("tv-nav-focus"));
  };

  // ── Build the list of non-empty shelves ──────────────────────────────────
  const favItems = myList || [];
  const histItems = (watchHistory || []).filter((h) => h.type !== "live");
  // Home reuses the shared virtualized shelf (VirtualShelvesTV) with the hero and
  // see-all disabled; it owns rail rendering, windowing and D-pad within the list.
  const shelves = [
    { id: "favorites", name: "Favorites", items: favItems },
    { id: "history", name: "Continue Watching", items: histItems },
  ].filter((s) => s.items.length > 0);
  // When there are no shelves, VirtualShelvesTV isn't mounted, so the raw key
  // handler still owns up→navbar / Back in the empty state.
  const shelfCountRef = useRef(0);
  useEffect(() => { shelfCountRef.current = shelves.length; });

  useEffect(() => {
    movieBtnRef.current?.scrollIntoView({ block: "nearest" });
  }, [movieDetail?.btnIdx]);

  useEffect(() => {
    seriesEpRef.current?.scrollIntoView({ block: "nearest" });
  }, [seriesDetail?.epIdx]);

  useEffect(() => {
    seriesSnRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [seriesDetail?.seasonIdx]);

  // ── Open movie detail ─────────────────────────────────────────────────────
  const openMovieDetail = async (item) => {
    const streamId = item.stream_id ?? item.streamId ?? item.movieId;
    const normItem = { ...item, stream_id: streamId, streamId };
    const next = { item: normItem, info: null, btnIdx: 0, showTrailer: false };
    setMovieDetail(next);
    movieDetailRef.current = next;
    try {
      const info = await fetchMovieInfo(streamId);
      const updated = { ...next, info };
      setMovieDetail(updated);
      movieDetailRef.current = updated;
    } catch {
      const updated = { ...next, info: {} };
      setMovieDetail(updated);
      movieDetailRef.current = updated;
    }
  };

  const closeMovieDetail = () => {
    setMovieDetail(null);
    movieDetailRef.current = null;
  };

  const updMovieDetail = (d) => {
    movieDetailRef.current = d;
    setMovieDetail(d);
  };

  const playMovie = (d, startTime = 0) => {
    const streamId = d.item.stream_id ?? d.item.streamId;
    const url = buildMovieUrl(streamId, d.item.container_extension || "mp4");
    playVideoObject({
      type: "movies",
      streamId,
      name: d.item.name,
      url,
      cover: d.item.stream_icon || d.item.cover || null,
      startTime,
    });
  };

  // ── Open series detail ────────────────────────────────────────────────────
  const openSeriesDetail = async (item) => {
    const seriesId = item.series_id ?? item.seriesId ?? item.id;
    const normItem = { ...item, series_id: seriesId, id: seriesId, seriesId };
    const next = {
      item: normItem,
      info: null,
      seasons: [],
      seasonIdx: 0,
      epIdx: 0,
      section: "actions",
      actionIdx: 0,
      showTrailer: false,
      trailerFocus: false,
    };
    setSeriesDetail(next);
    seriesDetailRef.current = next;
    try {
      const info = await fetchSeriesInfo(seriesId);
      const rawSeasons = info?.seasons;
      const seasons = Array.isArray(rawSeasons)
        ? rawSeasons
            .map((s) => String(s.season_number || s.id))
            .sort((a, b) => Number(a) - Number(b))
        : Object.keys(rawSeasons || {}).sort((a, b) => Number(a) - Number(b));
      const updated = { ...next, info, seasons };
      setSeriesDetail(updated);
      seriesDetailRef.current = updated;
    } catch {
      const updated = { ...next, info: {}, seasons: [] };
      setSeriesDetail(updated);
      seriesDetailRef.current = updated;
    }
  };

  const closeSeriesDetail = () => {
    setSeriesDetail(null);
    seriesDetailRef.current = null;
  };

  const updSeriesDetail = (d) => {
    seriesDetailRef.current = d;
    setSeriesDetail(d);
  };

  const playEpisode = (series, episode) => {
    const url = buildEpisodeUrl(episode.id, episode.container_extension || "mp4");
    const epHistory = (watchHistory || []).find(
      (h) =>
        h.type === "series" && String(h.episodeId) === String(episode.id),
    );
    playVideoObject({
      type: "series",
      streamId: String(episode.id),
      seriesId: series.series_id || series.id,
      seriesName: series.name,
      episodeId: episode.id,
      name: `${series.name} — ${episode.title || "E" + episode.episode_num}`,
      url,
      cover: series.cover || series.stream_icon,
      startTime: epHistory?.currentTime || 0,
    });
  };

  const continueSeriesWatching = (d) => {
    const seriesId = d.item.series_id || d.item.id || d.item.seriesId;
    const entry = (watchHistory || []).find(
      (h) => h.type === "series" && String(h.seriesId) === String(seriesId),
    );
    if (!entry) return;
    const url = buildEpisodeUrl(entry.streamId);
    playVideoObject({
      type: "series",
      streamId: entry.streamId,
      seriesId: entry.seriesId,
      seriesName: entry.seriesName || d.item.name,
      episodeId: entry.episodeId || entry.streamId,
      name: entry.name || d.item.name,
      url,
      cover: d.item.cover || d.item.stream_icon,
      startTime: entry.currentTime || 0,
    });
  };

  // ── Open item from list ───────────────────────────────────────────────────
  const openItem = (item) => {
    const type = item.type;
    if (type === "live") {
      playLive(item);
      return;
    }
    if (type === "movies" || type === "movie") openMovieDetail(item);
    else if (type === "series") openSeriesDetail(item);
  };

  // ── D-pad key handler ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (isMacCommand(e)) return; // ⌘ shares keyCode 91 with Back in the sim
      if (navActiveRef.current) return;
      if (currentVideoRef.current) return;
      const k = e.keyCode || e.which;
      if (movieDetailRef.current) handleMovieDetailKey(k, e);
      else if (seriesDetailRef.current) handleSeriesDetailKey(k, e);
      else if (shelfCountRef.current === 0) {
        // Empty Home: no shelf component mounted, so handle nav/back here.
        if (k === KEY_UP) { e.preventDefault(); focusNav(); }
        else if (KEY_BACK.has(k)) { e.preventDefault(); navigation.goBack?.(); }
      }
      // Otherwise VirtualShelvesTV owns the list keys (arrows/enter/back).
    };
    const onNavBlur = () => {
      navActiveRef.current = false;
    };
    document.addEventListener("keydown", onKey);
    globalThis.addEventListener("tv-nav-blur", onNavBlur);
    return () => {
      document.removeEventListener("keydown", onKey);
      globalThis.removeEventListener("tv-nav-blur", onNavBlur);
    };
  // Single key router bound once; the detail handlers read live state via refs
  // (navActiveRef etc.), so the deps stay empty by design.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Movie detail navigation ───────────────────────────────────────────────
  const handleMovieDetailKey = (k, e) => {
    const d = movieDetailRef.current;
    if (!d) return;
    e.preventDefault();
    if (KEY_BACK.has(k)) {
      closeMovieDetail();
      return;
    }
    if (!d.info) return;

    const streamId = d.item.stream_id ?? d.item.streamId;
    const resume = (watchHistory || []).find(
      (h) =>
        (h.type === "movies" || h.type === "movie") &&
        String(h.streamId) === String(streamId),
    );
    const trailer = getTrailerUrl(d.info?.info?.youtube_trailer);
    const buttons = [
      { type: "play" },
      ...(resume?.currentTime > 0 ? [{ type: "restart" }] : []),
      ...(trailer ? [{ type: "trailer" }] : []),
      { type: "fav" },
    ];
    const maxBtn = buttons.length - 1;

    switch (k) {
      case KEY_LEFT:
        closeMovieDetail();
        break;
      case KEY_UP:
        // btnIdx === -1 → topbar back icon (between first button and navbar).
        if (d.btnIdx > 0) updMovieDetail({ ...d, btnIdx: d.btnIdx - 1 });
        else if (d.btnIdx === 0) updMovieDetail({ ...d, btnIdx: -1 });
        else focusNav();
        break;
      case KEY_DOWN:
        if (d.btnIdx === -1) updMovieDetail({ ...d, btnIdx: 0 });
        else if (d.btnIdx < maxBtn) updMovieDetail({ ...d, btnIdx: d.btnIdx + 1 });
        break;
      case KEY_ENTER: {
        if (d.btnIdx === -1) { closeMovieDetail(); break; }
        const btn = buttons[d.btnIdx];
        if (btn?.type === "play") playMovie(d, resume?.currentTime || 0);
        else if (btn?.type === "restart") playMovie(d, 0);
        else if (btn?.type === "trailer")
          updMovieDetail({ ...d, showTrailer: !d.showTrailer });
        else if (btn?.type === "fav") {
          if (isInMyList("movies", streamId))
            removeFromMyList(`mylist_movies_${streamId}`);
          else
            addToMyList({
              type: "movies",
              streamId,
              name: d.item.name,
              cover: d.item.stream_icon || d.item.cover || null,
            });
        }
        break;
      }
    }
  };

  // ── Series detail navigation ──────────────────────────────────────────────
  const handleSeriesDetailKey = (k, e) => {
    const d = seriesDetailRef.current;
    if (!d) return;
    e.preventDefault();
    if (KEY_BACK.has(k)) {
      closeSeriesDetail();
      return;
    }
    if (!d.info) return;

    switch (k) {
      case KEY_LEFT:
        seriesOnLeft(d);
        break;
      case KEY_RIGHT:
        seriesOnRight(d);
        break;
      case KEY_UP:
        seriesOnUp(d);
        break;
      case KEY_DOWN:
        seriesOnDown(d);
        break;
      case KEY_ENTER:
        seriesOnEnter(d);
        break;
    }
  };

  const seriesOnLeft = (d) => {
    if (d.trailerFocus) {
      updSeriesDetail({ ...d, trailerFocus: false, seasonIdx: d.seasons.length - 1 });
    } else if (d.section === "actions" && d.actionIdx > 0) {
      updSeriesDetail({ ...d, actionIdx: d.actionIdx - 1 });
    } else if (d.section === "actions" && d.actionIdx === 0) {
      closeSeriesDetail();
    } else if (d.section === "seasons" && d.seasonIdx > 0) {
      updSeriesDetail({ ...d, seasonIdx: d.seasonIdx - 1, epIdx: 0 });
    }
  };

  const seriesOnRight = (d) => {
    const trailer = getTrailerUrl(d.info?.info?.youtube_trailer);
    if (d.section === "actions") {
      const seriesId = d.item.series_id || d.item.id || d.item.seriesId;
      const hasHistory = (watchHistory || []).some(
        (h) =>
          h.type === "series" && String(h.seriesId) === String(seriesId),
      );
      if (d.actionIdx < (hasHistory ? 1 : 0))
        updSeriesDetail({ ...d, actionIdx: d.actionIdx + 1 });
    } else if (!d.trailerFocus && d.section === "seasons") {
      if (d.seasonIdx < d.seasons.length - 1)
        updSeriesDetail({ ...d, seasonIdx: d.seasonIdx + 1, epIdx: 0 });
      else if (trailer) updSeriesDetail({ ...d, trailerFocus: true });
    }
  };

  const seriesOnUp = (d) => {
    if (d.section === "back") {
      focusNav();
      return;
    }
    if (d.trailerFocus) {
      focusNav();
      return;
    }
    if (d.section === "episodes") {
      if (d.epIdx > 0) updSeriesDetail({ ...d, epIdx: d.epIdx - 1 });
      else updSeriesDetail({ ...d, section: "seasons" });
    } else if (d.section === "seasons") {
      updSeriesDetail({ ...d, section: "actions", actionIdx: 0 });
    } else {
      // section === "actions" → topbar back icon.
      updSeriesDetail({ ...d, section: "back" });
    }
  };

  const seriesOnDown = (d) => {
    if (d.section === "back") {
      updSeriesDetail({ ...d, section: "actions", actionIdx: 0 });
      return;
    }
    if (d.trailerFocus) {
      updSeriesDetail({ ...d, trailerFocus: false, section: "episodes", epIdx: 0 });
      return;
    }
    if (d.section === "actions") {
      updSeriesDetail({ ...d, section: "seasons" });
    } else if (d.section === "seasons") {
      return;
    } else {
      const eps = d.info?.episodes?.[d.seasons[d.seasonIdx]] || [];
      if (d.epIdx < eps.length - 1)
        updSeriesDetail({ ...d, epIdx: d.epIdx + 1 });
    }
  };

  const seriesOnEnter = (d) => {
    if (d.section === "back") {
      closeSeriesDetail();
      return;
    }
    if (d.trailerFocus) {
      updSeriesDetail({ ...d, showTrailer: !d.showTrailer });
      return;
    }
    if (d.section === "actions") {
      const seriesId = d.item.series_id || d.item.id || d.item.seriesId;
      const historyEntry = (watchHistory || []).find(
        (h) =>
          h.type === "series" && String(h.seriesId) === String(seriesId),
      );
      const inFav = isInMyList("series", seriesId);
      if (historyEntry && d.actionIdx === 0) {
        continueSeriesWatching(d);
      } else if (inFav) {
        removeFromMyList(`mylist_series_${seriesId}`);
      } else {
        addToMyList({
          type: "series",
          streamId: seriesId,
          seriesId,
          name: d.item.name,
          cover:
            d.info?.info?.cover || d.item.cover || d.item.stream_icon || null,
        });
      }
      return;
    }
    if (d.section === "seasons") {
      updSeriesDetail({ ...d, section: "episodes", epIdx: 0 });
    } else {
      const eps = d.info?.episodes?.[d.seasons[d.seasonIdx]] || [];
      const ep = eps[d.epIdx];
      if (ep) playEpisode(d.item, ep);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────
  const fmtTime = (s) => {
    if (!s) return "0:00";
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = Math.floor(s % 60);
    return hh > 0
      ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
      : `${mm}:${String(ss).padStart(2, "0")}`;
  };

  // ── Render: no account ────────────────────────────────────────────────────
  if (!activeUserId) {
    return (
      <div className="tvl-screen">
        <StatePanel
          mode="empty"
          icon="tv"
          title="No account"
          message="Add an account to start watching"
          cta={() => navigation.navigate("Accounts")}
          ctaLabel="Add Account"
        />
      </div>
    );
  }

  // ── Render: movie detail ──────────────────────────────────────────────────
  if (movieDetail) {
    const { item, info, btnIdx, showTrailer } = movieDetail;
    const data = info?.info || {};
    const streamId = item.stream_id ?? item.streamId;
    const poster = item.stream_icon || item.cover || data.movie_image || null;
    const year = (data.releasedate || data.release_date || "").slice(0, 4);
    const trailer = getTrailerUrl(data.youtube_trailer);
    const resume = (watchHistory || []).find(
      (h) => (h.type === "movies" || h.type === "movie") && String(h.streamId) === String(streamId),
    );
    const inFav = isInMyList("movies", streamId);
    const buttons = [
      { label: resume?.currentTime > 0 ? "▶  Continue" : "▶  Play", type: "play" },
      ...(resume?.currentTime > 0 ? [{ label: "↺  From Start", type: "restart" }] : []),
      ...(trailer ? [{ label: showTrailer ? <><Icon name="close" size={16} color="currentColor" />&nbsp;&nbsp;Close Trailer</> : <><Icon name="film" size={16} color="currentColor" />&nbsp;&nbsp;Trailer</>, type: "trailer" }] : []),
      { label: inFav ? "♥  Saved" : "♡  Add to Favorites", type: "fav" },
    ];
    const btnClass = (i, type) =>
      ["tvl-det-hero-btn",
        type === "play" ? "tvl-det-hero-btn--play" : "",
        type === "fav" && inFav ? "tvl-det-hero-btn--saved" : "",
        i === btnIdx ? "tvl-det-hero-btn--on" : ""]
        .filter(Boolean).join(" ");

    return (
      <div className="tvl-screen">
        <div className="tvl-topbar">
          <button className={btnIdx === -1 ? "tvl-topbar-back tvl-topbar-back--focused" : "tvl-topbar-back"} onClick={closeMovieDetail}><Icon name="back" size={20} color={colors.text} /></button>
          <button className="tvl-topbar-title tvl-topbar-title--back" onClick={closeMovieDetail}>
            {item.name}
          </button>
        </div>
        {/* Banner */}
        <div className="tvl-det-hero">
          {poster && <img className="tvl-det-hero-bg" src={poster} alt="" />}
          <div className="tvl-det-hero-grad" />
        </div>

        {/* Content below banner */}
        <div className="tvl-det-content">
          <div className="tvl-det-hero-thumb">
            {poster ? <img src={poster} alt="" /> : <div className="tvl-det-hero-thumb-ph"><Icon name="film" size={40} color={colors.muted} /></div>}
          </div>
          <div className="tvl-det-hero-info">
            <div className="tvl-det-hero-title">{item.name}</div>
            <div className="tvl-det-hero-meta">
              {year && <span className="tvl-det-tag">{year}</span>}
              {data.genre && <span className="tvl-det-tag">{data.genre.split(",")[0].trim()}</span>}
              {data.rating && <span className="tvl-det-rating"><Icon name="star" size={14} color={colors.rating} /> {Number.parseFloat(data.rating).toFixed(1)}</span>}
              {data.age && <span className="tvl-det-tag tvl-det-tag--alert">{data.age}</span>}
              {data.duration && <span className="tvl-det-tag">{data.duration}</span>}
            </div>
            {!info && <div className="tvl-spinner" style={{ alignSelf: "flex-start" }} />}
            {info && (
              <div className="tvl-det-hero-btns">
                {buttons.map((btn, i) => (
                  <button
                    key={btn.type}
                    ref={i === btnIdx ? movieBtnRef : null}
                    className={btnClass(i, btn.type)}
                    onClick={() => {
                      if (btn.type === "play") playMovie(movieDetail, resume?.currentTime || 0);
                      else if (btn.type === "restart") playMovie(movieDetail, 0);
                      else if (btn.type === "trailer") updMovieDetail({ ...movieDetail, showTrailer: !movieDetail.showTrailer });
                      else if (btn.type === "fav") {
                        if (inFav) removeFromMyList(`mylist_movies_${streamId}`);
                        else addToMyList({ type: "movies", streamId, name: item.name, cover: poster });
                      }
                    }}
                  >{btn.label}</button>
                ))}
              </div>
            )}
            {data.plot && <p className="tvl-det-hero-plot">{data.plot}</p>}
          </div>
        </div>
        {info && (data.plot || data.cast || data.director || (showTrailer && trailer)) && (
          <div className="tvl-det-body">
            {data.plot && <p className="tvl-det-body-plot">{data.plot}</p>}
            {data.cast && <p className="tvl-det-body-crew"><strong>Cast</strong> {data.cast}</p>}
            {data.director && <p className="tvl-det-body-crew"><strong>Director</strong> {data.director}</p>}
            {showTrailer && trailer && (
              <div className="tvl-mov-trailer">
                <iframe title={`${item.name} trailer`} src={`${trailer}?autoplay=1`}
                  allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
                  style={{ width: "100%", height: "100%", border: "none" }} />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Render: series detail ─────────────────────────────────────────────────
  if (seriesDetail) {
    const { item, info: rawInfo, seasons, seasonIdx, epIdx, section, actionIdx, trailerFocus, showTrailer } = seriesDetail;
    const si = rawInfo?.info || {};
    const currentSeason = seasons[seasonIdx];
    const episodes = rawInfo?.episodes?.[currentSeason] || [];
    const trailer = getTrailerUrl(si.youtube_trailer);
    const poster = si.cover || item.cover || item.stream_icon || null;
    const seriesId = item.series_id || item.id || item.seriesId;
    const historyEntry = (watchHistory || []).find(
      (h) => h.type === "series" && String(h.seriesId) === String(seriesId),
    );
    const inFav = isInMyList("series", seriesId);
    const actionBtns = [
      ...(historyEntry ? [{
        type: "continue",
        label: "▶  Continue" + (historyEntry.seasonNum
          ? ` S${historyEntry.seasonNum}E${String(historyEntry.episodeNum).padStart(2, "0")}` : ""),
      }] : []),
      { type: "fav", label: inFav ? "♥  Saved" : "♡  Favorites" },
    ];
    const actBtnClass = (i) =>
      ["tvl-det-hero-btn",
        actionBtns[i].type === "continue" ? "tvl-det-hero-btn--play" : "",
        actionBtns[i].type === "fav" && inFav ? "tvl-det-hero-btn--saved" : "",
        section === "actions" && i === actionIdx ? "tvl-det-hero-btn--on" : ""]
        .filter(Boolean).join(" ");

    return (
      <div className="tvl-screen">
        <div className="tvl-topbar">
          <button className={section === "back" ? "tvl-topbar-back tvl-topbar-back--focused" : "tvl-topbar-back"} onClick={closeSeriesDetail}><Icon name="back" size={20} color={colors.text} /></button>
          <button className="tvl-topbar-title tvl-topbar-title--back" onClick={closeSeriesDetail}>
            {item.name}
          </button>
        </div>
        {/* Banner */}
        <div className="tvl-det-hero tvl-det-hero--series">
          {poster && <img className="tvl-det-hero-bg" src={poster} alt="" />}
          <div className="tvl-det-hero-grad" />
        </div>

        {/* Content below banner */}
        <div className="tvl-det-content">
          <div className="tvl-det-hero-thumb">
            {poster ? <img src={poster} alt="" /> : <div className="tvl-det-hero-thumb-ph"><Icon name="tv" size={40} color={colors.muted} /></div>}
          </div>
          <div className="tvl-det-hero-info">
            <div className="tvl-det-hero-title">{item.name}</div>
            <div className="tvl-det-hero-meta">
              {si.releaseDate && <span className="tvl-det-tag">{si.releaseDate.slice(0, 4)}</span>}
              {si.genre && <span className="tvl-det-tag">{si.genre.split(",")[0].trim()}</span>}
              {si.rating && <span className="tvl-det-rating"><Icon name="star" size={14} color={colors.rating} /> {Number.parseFloat(si.rating).toFixed(1)}</span>}
            </div>
            {!rawInfo && <div className="tvl-spinner" style={{ alignSelf: "flex-start" }} />}
            {rawInfo && (
              <div className="tvl-det-hero-btns">
                {actionBtns.map((btn, i) => (
                  <button
                    key={btn.type}
                    ref={section === "actions" && i === actionIdx ? seriesActionRef : null}
                    className={actBtnClass(i)}
                    onClick={() => {
                      if (btn.type === "continue") continueSeriesWatching(seriesDetail);
                      else if (btn.type === "fav") {
                        if (inFav) removeFromMyList(`mylist_series_${seriesId}`);
                        else addToMyList({ type: "series", streamId: seriesId, seriesId, name: item.name, cover: poster });
                      }
                    }}
                  >{btn.label}</button>
                ))}
              </div>
            )}
            {si.plot && <p className="tvl-det-hero-plot">{si.plot}</p>}
          </div>
        </div>
        {rawInfo ? (
          <>
            <div className="tvl-seasons-row">
              {seasons.map((s, i) => (
                <div key={s} ref={section === "seasons" && i === seasonIdx ? seriesSnRef : null}
                  className={section === "seasons" && i === seasonIdx ? "tvl-season-btn tvl-season-btn--on" : "tvl-season-btn"}>
                  Season {s}
                </div>
              ))}
              {trailer && (
                <div className={trailerFocus ? "tvl-season-btn tvl-season-btn--on" : "tvl-season-btn"}>
                  {showTrailer ? <><Icon name="close" size={16} color={colors.text} /> Trailer</> : <><Icon name="film" size={16} color={colors.text} /> Trailer</>}
                </div>
              )}
            </div>
            {showTrailer && trailer && (
              <div className="tvl-ser-trailer">
                <iframe title="trailer" src={`${trailer}?autoplay=1`}
                  allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
                  style={{ width: "100%", height: "100%", border: "none" }} />
              </div>
            )}
            <div className="tvl-episodes">
              {episodes.map((ep, i) => {
                const epHistory = (watchHistory || []).find(
                  (h) => h.type === "series" && String(h.episodeId) === String(ep.id),
                );
                const hasProgress = epHistory && epHistory.currentTime > 0;
                const isWatched = hasProgress && epHistory.duration > 0 && epHistory.currentTime / epHistory.duration > 0.9;
                return (
                  <div key={ep.id} ref={section === "episodes" && i === epIdx ? seriesEpRef : null}
                    className={section === "episodes" && i === epIdx ? "tvl-episode tvl-episode--on" : "tvl-episode"}>
                    <span className="tvl-ep-badge">E{ep.episode_num}</span>
                    <div className="tvl-ep-body">
                      <div className="tvl-ep-title">
                        {ep.title || `Episode ${ep.episode_num}`}
                        {isWatched && <span style={{ marginLeft: 8, display: "inline-flex", verticalAlign: "middle" }}><Icon name="check" size={14} color={colors.accent2} /></span>}
                      </div>
                      {ep.info?.plot && <div className="tvl-ep-plot">{ep.info.plot}</div>}
                      {ep.info?.duration && <div className="tvl-ep-dur">{ep.info.duration}</div>}
                      {hasProgress && !isWatched && (
                        <div style={{ fontSize: 11, color: colors.accent, marginTop: 4 }}>
                          Continue from {fmtTime(epHistory.currentTime)}
                        </div>
                      )}
                    </div>
                    <span className="tvl-ep-play" style={{ display: "inline-flex", alignItems: "center" }}><Icon name="play" size={18} color={colors.text} /></span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="tvl-center"><div className="tvl-spinner" /></div>
        )}
      </div>
    );
  }

  // ── Render: home (horizontal poster shelves) ──────────────────────────────
  const isEmpty = shelves.length === 0;

  if (isEmpty) {
    return (
      <div className="tvl-screen">
        <div className="tvl-topbar">
          <span className="tvl-topbar-title">My List &amp; History</span>
        </div>
        <StatePanel
          mode="empty"
          icon="film"
          title="Nothing here yet"
          message="Start watching something and it will appear here"
        />
      </div>
    );
  }

  return (
    <div className="tvl-screen">
      <div className="tvl-topbar">
        <span className="tvl-topbar-title">My List &amp; History</span>
      </div>
      <VirtualShelvesTV
        shelves={shelves}
        showHero={false}
        onSelect={openItem}
        onUpAtTop={focusNav}
        onBack={() => navigation.goBack?.()}
        // Continue Watching renders electron-style landscape cards: wider than a
        // portrait poster (matches Electron's ~1.6× backdrop) and a shorter row
        // (design px; VirtualShelvesTV scales both). Row = header + 16:9 thumb +
        // title/episode/time-left.
        cardWidthForShelf={(shelf) => (shelf?.id === "history" ? CW_CARD_W : null)}
        rowHeightForShelf={(shelf) => (shelf?.id === "history" ? CW_ROW_H : null)}
        renderCard={(item, isFocused, cardW, shelf) =>
          shelf?.id === "history" ? (
            <ContinueCardTV item={item} isFocused={isFocused} width={cardW} onPress={openItem} />
          ) : (
            <PosterCardWeb item={item} isFocused={isFocused} width={cardW} onPress={openItem} />
          )
        }
      />
    </div>
  );
}
