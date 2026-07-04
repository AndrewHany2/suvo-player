import { memo, useState, useEffect, useRef, useMemo } from "react";
import { useApp } from "../context/AppContext";
import { buildCategoryFilter, filterMovies } from "./moviesFilter.helpers";
import { useMovies } from "../domain/hooks/useMovies";
import { useTVInput } from "../hooks/useTVInput";
import { VirtualShelvesTV } from "../presentation/components/VirtualShelves.tv";
import { yieldFocusToNav } from "../platform/adapters/input/keys";
import { PagedGridTV } from "../presentation/components/PagedGrid.tv";
import PosterCard from "../presentation/components/PosterCard.web";
import StatePanel from "../ui/StatePanel";
import Icon from "../ui/Icon";
import { colors, iconSizes } from "../ui/tokens";
import "../styles/tvl.css";
import "../styles/tvResponsiveScaling.css";
import "../styles/tvRemoteFocus.css";
import "./MoviesScreen.tv.css";

const CAT_COLS = 4;
const MOV_COLS = 5;
const MOV_PAGE = 24;
// Grid gap (design px @ 1280 viewport): fewer/larger posters for 10-foot
// lean-back viewing; row height is intrinsic (poster + 2-line title).
const MOV_GAP = 14;
const ALPHA = ["ALL", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

import { getTrailerEmbedUrl as getTrailerUrl } from "../utils/youtubeTrailer";

export default function MoviesScreenTV({ navigation, route }) {
  const { loading, activeUserId, categories, getCategoryItems, fetchMovieInfo, playMovie, shelves, handleShelfVisible, handleLoadMore } = useMovies({ navigation });
  const { isInMyList, addToMyList, removeFromMyList, watchHistory, currentVideo, tvUseShelves } = useApp();
  const { register } = useTVInput();
  // When shelves own the browse view, VirtualShelves.tv registers its own D-pad
  // handler; this ref lets the screen's category-grid key routing stand down so
  // the two handlers don't both act on one keypress.
  const tvUseShelvesRef = useRef(tvUseShelves);
  useEffect(() => { tvUseShelvesRef.current = tvUseShelves; }, [tvUseShelves]);

  // Discover "All Movies" pill opens the category-grid landing over the shelves
  // (cheap: reuses already-loaded categories, no getAllMovies fetch). Transient —
  // does NOT touch the persisted tvUseShelves toggle.
  const [browseAll, setBrowseAll] = useState(false);
  const browseAllRef = useRef(false);
  useEffect(() => { browseAllRef.current = browseAll; }, [browseAll]);

  const currentVideoRef = useRef(null);
  useEffect(() => { currentVideoRef.current = currentVideo; }, [currentVideo]);

  const [catFocus, setCatFocus] = useState(0);
  const [page, setPage] = useState(null);
  const [detail, setDetail] = useState(null);
  const [query, setQuery] = useState("");
  const [catZone, setCatZone] = useState("grid");

  const catsRef = useRef([]);
  const catFocusRef = useRef(0);
  const pageRef = useRef(null);
  const detailRef = useRef(null);
  const catElRef = useRef(null);
  const btnElRef = useRef(null);
  const catZoneRef = useRef("grid");
  const searchInputRef = useRef(null);

  const [filterZone, setFilterZone] = useState("grid");
  const filterZoneRef = useRef("grid");
  // True while the top navbar holds the remote, so the grid focus ring clears
  // instead of lingering on a card the cursor has left.
  const [navActive, setNavActive] = useState(false);
  const [filterIdx, setFilterIdx] = useState(0);
  const filterIdxRef = useRef(0);
  const [filterLetter, setFilterLetter] = useState("all");
  const filterLetterRef = useRef("all");

  // Grid-view text search (composes with the alpha filter below).
  const [gridQuery, setGridQuery] = useState("");
  const gridQueryRef = useRef("");
  const gridSearchInputRef = useRef(null);

  const cats = useMemo(() => buildCategoryFilter(categories, query), [categories, query]);
  useEffect(() => { catsRef.current = cats; }, [cats]);
  // Keep category focus in range whenever the filtered list shrinks.
  useEffect(() => {
    if (catFocusRef.current > cats.length - 1) { catFocusRef.current = 0; setCatFocus(0); }
  }, [cats.length]);
  useEffect(() => { pageRef.current = page; }, [page]);
  useEffect(() => { detailRef.current = detail; }, [detail]);

  const getFilteredItems = (items) =>
    filterMovies(items, filterLetterRef.current, gridQueryRef.current);

  // Open detail directly when navigated from history.
  useEffect(() => {
    if (route?.params?.openDetail && route?.params?.streamId) {
      const streamId = route.params.streamId;
      const item = {
        stream_id: streamId, streamId,
        name: route.params.name || "Movie",
        stream_icon: route.params.cover || null,
        cover: route.params.cover || null,
        container_extension: route.params.containerExtension || "mp4",
      };
      setTimeout(() => {
        openDetail(item);
        navigation.setParams({ openDetail: false });
      }, 100);
    }
  }, [route?.params?.openDetail]);

  const openCat = async (cat) => {
    const next = { catId: cat.id, name: cat.name, items: null, display: MOV_PAGE, focus: 0, failed: false };
    setPage(next); pageRef.current = next;
    try {
      const all = await getCategoryItems(cat.id);
      const updated = { ...next, items: all };
      setPage(updated); pageRef.current = updated;
    } catch {
      // Distinguish a fetch FAILURE (show error + retry) from a genuinely empty
      // catalog (items: []). Without this flag both rendered identically.
      const updated = { ...next, items: [], failed: true };
      setPage(updated); pageRef.current = updated;
    }
  };

  const resetFilter = () => {
    filterLetterRef.current = "all"; setFilterLetter("all");
    filterZoneRef.current = "grid"; setFilterZone("grid");
    filterIdxRef.current = 0; setFilterIdx(0);
    gridQueryRef.current = ""; setGridQuery("");
  };

  // Reset grid focus + scroll to top whenever the text query changes.
  const onGridQueryChange = (val) => {
    setGridQuery(val);
    gridQueryRef.current = val.trim().toLowerCase();
    const pg = pageRef.current;
    if (pg) { const n = { ...pg, focus: 0, display: MOV_PAGE }; pageRef.current = n; setPage(n); }
  };
  const closePage = () => { setPage(null); pageRef.current = null; resetFilter(); };

  // ── Detail ────────────────────────────────────────────────────────────────
  const openDetail = async (item) => {
    const next = { item, info: null, btnIdx: 0, showTrailer: false };
    setDetail(next); detailRef.current = next;
    try {
      const streamId = item.stream_id ?? item.streamId;
      const info = await fetchMovieInfo(streamId);
      const updated = { ...next, info };
      setDetail(updated); detailRef.current = updated;
    } catch {
      const updated = { ...next, info: {} };
      setDetail(updated); detailRef.current = updated;
    }
  };
  const closeDetail = () => { setDetail(null); detailRef.current = null; };
  const updDetail = (d) => { detailRef.current = d; setDetail(d); };

  const play = (d, startTime = 0) => {
    const item = d.item;
    playMovie({
      streamId: item.stream_id ?? item.streamId,
      name: item.name,
      cover: item.stream_icon || item.cover || null,
      containerExtension: item.container_extension || "mp4",
      startTime,
    });
  };

  // ── Category keys ─────────────────────────────────────────────────────────
  const setCatZoneBoth = (z) => { catZoneRef.current = z; setCatZone(z); };
  const movCatFocus = (n) => { catFocusRef.current = n; setCatFocus(n); };
  const onCatLeft = () => { const f = catFocusRef.current; if (f > 0) movCatFocus(f - 1); };
  const onCatRight = () => { const f = catFocusRef.current; if (f < catsRef.current.length - 1) movCatFocus(f + 1); };
  const onCatUp = () => { const f = catFocusRef.current; if (f >= CAT_COLS) movCatFocus(f - CAT_COLS); else setCatZoneBoth("search"); };
  const onCatDown = () => { const f = catFocusRef.current; movCatFocus(Math.min(f + CAT_COLS, catsRef.current.length - 1)); };
  const onCatEnter = () => { const cat = catsRef.current[catFocusRef.current]; if (cat) openCat(cat); };

  // ── Search-bar zone (above category grid) ─────────────────────────────────
  const onSearchUp = () => yieldFocusToNav();
  const onSearchDown = () => setCatZoneBoth("grid");
  const onSearchEnter = () => searchInputRef.current?.focus();

  // ── Movie grid keys ───────────────────────────────────────────────────────
  // The grid grows on scroll (PagedGridTV), so focus may roam the whole
  // filtered list — bounds use the full length, not a display cap.
  const movMovFocus = (pg, focus) => { const n = { ...pg, focus }; pageRef.current = n; setPage(n); };
  const growMovDisplay = (next) => { const pg = pageRef.current; if (pg) { const n = { ...pg, display: next }; pageRef.current = n; setPage(n); } };
  const onMovLeft = (pg) => { if (pg.focus > 0) movMovFocus(pg, pg.focus - 1); };
  const onMovRight = (pg) => {
    const filtered = getFilteredItems(pg.items);
    const max = filtered.length - 1;
    if (pg.focus >= max) return;
    movMovFocus(pg, pg.focus + 1);
  };
  const onMovUp = (pg) => {
    if (pg.focus >= MOV_COLS) movMovFocus(pg, pg.focus - MOV_COLS);
    else { filterZoneRef.current = "filter"; setFilterZone("filter"); }
  };
  const onMovDown = (pg) => {
    const filtered = getFilteredItems(pg.items);
    const max = filtered.length - 1;
    const next = Math.min(pg.focus + MOV_COLS, max);
    movMovFocus(pg, next);
  };
  const onMovEnter = (pg) => { const item = getFilteredItems(pg.items)[pg.focus]; if (item) openDetail(item); };

  const onFilterLeft = () => { if (filterIdxRef.current > 0) { filterIdxRef.current -= 1; setFilterIdx(filterIdxRef.current); } };
  const onFilterRight = () => { if (filterIdxRef.current < ALPHA.length - 1) { filterIdxRef.current += 1; setFilterIdx(filterIdxRef.current); } };
  const onFilterUp = () => { filterZoneRef.current = "search"; setFilterZone("search"); };
  const onFilterDown = () => { filterZoneRef.current = "grid"; setFilterZone("grid"); };

  // Grid search-bar zone (above the alpha-filter letter bar).
  const gridInputFocused = () => document.activeElement === gridSearchInputRef.current;
  // Up from the search bar lands on the header Back arrow (its visual position,
  // at the very top) rather than jumping straight to the global nav.
  const onGridSearchUp = () => { filterZoneRef.current = "back"; setFilterZone("back"); };
  const onGridSearchDown = () => { filterZoneRef.current = "filter"; setFilterZone("filter"); };
  const onGridSearchEnter = () => gridSearchInputRef.current?.focus();

  // Header Back-arrow zone (topmost). Up yields to the global nav; Down returns to
  // the search bar; Enter closes the page (same as clicking the arrow / Back key).
  const onBackZoneUp = () => { filterZoneRef.current = "grid"; setFilterZone("grid"); yieldFocusToNav(); };
  const onBackZoneDown = () => { filterZoneRef.current = "search"; setFilterZone("search"); };
  const onBackZoneEnter = () => closePage();
  const onFilterEnter = () => {
    const letter = ALPHA[filterIdxRef.current] === "ALL" ? "all" : ALPHA[filterIdxRef.current].toLowerCase();
    filterLetterRef.current = letter; setFilterLetter(letter);
    const pg = pageRef.current;
    if (pg?.items) {
      const filtered = getFilteredItems(pg.items);
      const updated = { ...pg, focus: 0, display: Math.min(MOV_PAGE, filtered.length) };
      pageRef.current = updated; setPage(updated);
    }
    filterZoneRef.current = "grid"; setFilterZone("grid");
  };

  // While a search input has focus, let typing/cursor keys work normally —
  // the key handler yields (except Back/Escape, handled below).
  const inputFocused = () =>
    document.activeElement === searchInputRef.current ||
    document.activeElement === gridSearchInputRef.current;

  // ── D-pad wiring (replaces inline keyCodes + keydown listener) ──────────────
  useEffect(() => {
    return register(
      {
        left: () => {
          if (currentVideoRef.current || inputFocused()) return;
          // In the detail view the action buttons are vertical (up/down), so
          // Left is a no-op — only Back closes the detail. Route it like the
          // other directions instead of closing.
          if (detailRef.current) handleDetailDir("left");
          else if (pageRef.current) onMovOrFilter("left");
          else if (!tvUseShelvesRef.current || browseAllRef.current) onCatLeft();
        },
        right: () => { if (!currentVideoRef.current && !inputFocused()) routeDir("right"); },
        up: () => { if (!currentVideoRef.current && !inputFocused()) routeDir("up"); },
        down: () => { if (!currentVideoRef.current && !inputFocused()) routeDir("down"); },
        enter: () => { if (!currentVideoRef.current && !inputFocused()) routeDir("enter"); },
        back: () => {
          if (currentVideoRef.current) return;
          if (gridInputFocused()) { gridSearchInputRef.current?.blur(); filterZoneRef.current = "search"; setFilterZone("search"); return; }
          if (inputFocused()) { searchInputRef.current?.blur(); setCatZoneBoth("search"); return; }
          if (detailRef.current) closeDetail();
          else if (pageRef.current) {
            if (filterZoneRef.current === "filter" || filterZoneRef.current === "search") { filterZoneRef.current = "grid"; setFilterZone("grid"); }
            else closePage();
          } else if (browseAllRef.current) setBrowseAll(false);
          else navigation.goBack?.();
        },
      },
      { yieldToNav: true },
    );
    // routeDir/onMov* close over stable refs; register reads handlers fresh per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register]);

  // Track navbar focus so the grid ring clears while the top nav has the remote.
  useEffect(() => {
    const onNavFocus = () => setNavActive(true);
    const onNavBlur = () => setNavActive(false);
    globalThis.addEventListener("tv-nav-focus", onNavFocus);
    globalThis.addEventListener("tv-nav-blur", onNavBlur);
    return () => {
      globalThis.removeEventListener("tv-nav-focus", onNavFocus);
      globalThis.removeEventListener("tv-nav-blur", onNavBlur);
    };
  }, []);

  // Direction dispatch across the three zones.
  const routeDir = (dir) => {
    if (detailRef.current) return handleDetailDir(dir);
    if (pageRef.current) return onMovOrFilter(dir);
    // Shelves own the browse view — VirtualShelves.tv handles its own D-pad.
    if (tvUseShelvesRef.current && !browseAllRef.current) return;
    // category grid — search zone above the grid
    if (catZoneRef.current === "search") {
      if (dir === "up") return onSearchUp();
      if (dir === "down") return onSearchDown();
      if (dir === "enter") return onSearchEnter();
      return;
    }
    if (dir === "right") return onCatRight();
    if (dir === "up") return onCatUp();
    if (dir === "down") return onCatDown();
    if (dir === "enter") return onCatEnter();
  };

  const onMovOrFilter = (dir) => {
    if (filterZoneRef.current === "back") {
      if (dir === "up") return onBackZoneUp();
      if (dir === "down") return onBackZoneDown();
      if (dir === "enter") return onBackZoneEnter();
      return;
    }
    if (filterZoneRef.current === "search") {
      if (dir === "up") return onGridSearchUp();
      if (dir === "down") return onGridSearchDown();
      if (dir === "enter") return onGridSearchEnter();
      return;
    }
    if (filterZoneRef.current === "filter") {
      if (dir === "left") return onFilterLeft();
      if (dir === "right") return onFilterRight();
      if (dir === "up") return onFilterUp();
      if (dir === "down") return onFilterDown();
      if (dir === "enter") return onFilterEnter();
      return;
    }
    const pg = pageRef.current;
    if (!pg?.items) return;
    if (dir === "left") return onMovLeft(pg);
    if (dir === "right") return onMovRight(pg);
    if (dir === "up") return onMovUp(pg);
    if (dir === "down") return onMovDown(pg);
    if (dir === "enter") return onMovEnter(pg);
  };

  const handleDetailDir = (dir) => {
    const d = detailRef.current;
    if (!d || !d.info) return;
    const streamId = d.item.stream_id ?? d.item.streamId;
    const resume = (watchHistory || []).find((h) => (h.type === "movies" || h.type === "movie") && String(h.streamId) === String(streamId));
    const trailer = getTrailerUrl(d.info?.info?.youtube_trailer);
    const buttons = [
      { type: "play" },
      ...(resume?.currentTime > 0 ? [{ type: "restart" }] : []),
      ...(trailer ? [{ type: "trailer" }] : []),
      { type: "fav" },
    ];
    const maxBtn = buttons.length - 1;
    // btnIdx === -1 represents the topbar back icon, focused between the first
    // action button and the global navbar.
    if (dir === "up") {
      if (d.btnIdx > 0) updDetail({ ...d, btnIdx: d.btnIdx - 1 });
      else if (d.btnIdx === 0) updDetail({ ...d, btnIdx: -1 });
      else yieldFocusToNav();
    }
    else if (dir === "down") { if (d.btnIdx < maxBtn) updDetail({ ...d, btnIdx: d.btnIdx + 1 }); }
    else if (dir === "enter") {
      if (d.btnIdx === -1) { closeDetail(); return; }
      const btn = buttons[d.btnIdx];
      if (btn?.type === "play") play(d, resume?.currentTime || 0);
      else if (btn?.type === "restart") play(d, 0);
      else if (btn?.type === "trailer") updDetail({ ...d, showTrailer: !d.showTrailer });
      else if (btn?.type === "fav") {
        if (isInMyList("movies", streamId)) removeFromMyList(`mylist_movies_${streamId}`);
        else addToMyList({ type: "movies", streamId, name: d.item.name, cover: d.item.stream_icon || d.item.cover || null });
      }
    }
  };

  useEffect(() => { catElRef.current?.scrollIntoView({ block: "nearest" }); }, [catFocus]);
  // Movie-grid focus scrolling is handled inside PagedGridTV (focusIndex).
  useEffect(() => { btnElRef.current?.scrollIntoView({ block: "nearest" }); }, [detail?.btnIdx]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="tvl-screen"><StatePanel mode="loading" title="Loading…" /></div>;
  }

  if (!activeUserId) {
    return (
      <div className="tvl-screen">
        <StatePanel
          mode="empty"
          icon="film"
          title="No IPTV Account"
          message="Add your IPTV service from Settings"
          cta={() => navigation.navigate("Accounts")}
          ctaLabel="Add Account"
        />
      </div>
    );
  }

  // ── Movie detail ──────────────────────────────────────────────────────────
  if (detail) {
    const { item, info, btnIdx, showTrailer } = detail;
    const data = info?.info || {};
    const streamId = item.stream_id ?? item.streamId;
    const poster = item.stream_icon || item.cover || data.movie_image || null;
    const year = (data.releasedate || data.release_date || "").slice(0, 4);
    const trailer = getTrailerUrl(data.youtube_trailer);
    const resume = (watchHistory || []).find((h) => (h.type === "movies" || h.type === "movie") && String(h.streamId) === String(streamId));
    const inFav = isInMyList("movies", streamId);
    const buttons = [
      { label: resume?.currentTime > 0 ? "Continue" : "Play", icon: "play", type: "play" },
      ...(resume?.currentTime > 0 ? [{ label: "From Start", icon: "back", type: "restart" }] : []),
      ...(trailer ? [{ label: showTrailer ? "Close Trailer" : "Trailer", icon: showTrailer ? "close" : "film", type: "trailer" }] : []),
      { label: inFav ? "Saved" : "Add to Favorites", icon: "star", type: "fav" },
    ];
    const btnClass = (i, type) => [
      "tvl-det-hero-btn",
      type === "play" ? "tvl-det-hero-btn--play" : "",
      type === "fav" && inFav ? "tvl-det-hero-btn--saved" : "",
      i === btnIdx ? "tvl-det-hero-btn--on" : "",
    ].filter(Boolean).join(" ");

    return (
      <div className="tvl-screen">
        <div className="tvl-topbar">
          <button className={btnIdx === -1 ? "tvl-topbar-back tvl-topbar-back--focused" : "tvl-topbar-back"} onClick={closeDetail}><Icon name="back" size={iconSizes.md} color="currentColor" /></button>
          <button className="tvl-topbar-title tvl-topbar-title--back" onClick={closeDetail}>{item.name}</button>
        </div>
        <div className="tvl-det-hero">
          {poster && <img className="tvl-det-hero-bg" src={poster} alt="" />}
          <div className="tvl-det-hero-grad" />
        </div>
        <div className="tvl-det-content">
          <div className="tvl-det-hero-thumb">
            {poster ? <img src={poster} alt="" /> : <div className="tvl-det-hero-thumb-ph"><Icon name="film" size={iconSizes.lg} color={colors.border} /></div>}
          </div>
          <div className="tvl-det-hero-info">
            <div className="tvl-det-hero-title">{item.name}</div>
            <div className="tvl-det-hero-meta">
              {year && <span className="tvl-det-tag">{year}</span>}
              {data.genre && <span className="tvl-det-tag">{data.genre.split(",")[0].trim()}</span>}
              {data.rating && <span className="tvl-det-rating" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="star" size={iconSizes.sm} color={colors.rating} /> {Number.parseFloat(data.rating).toFixed(1)}</span>}
              {data.age && <span className="tvl-det-tag tvl-det-tag--alert">{data.age}</span>}
              {data.duration && <span className="tvl-det-tag">{data.duration}</span>}
            </div>
            {!info && <div className="tvl-spinner" style={{ alignSelf: "flex-start" }} />}
            {info && (
              <div className="tvl-det-hero-btns">
                {buttons.map((btn, i) => (
                  <button
                    key={btn.type}
                    ref={i === btnIdx ? btnElRef : null}
                    className={btnClass(i, btn.type)}
                    onClick={() => {
                      if (btn.type === "play") play(detail, resume?.currentTime || 0);
                      else if (btn.type === "restart") play(detail, 0);
                      else if (btn.type === "trailer") updDetail({ ...detail, showTrailer: !detail.showTrailer });
                      else if (btn.type === "fav") {
                        if (inFav) removeFromMyList(`mylist_movies_${streamId}`);
                        else addToMyList({ type: "movies", streamId, name: item.name, cover: poster });
                      }
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                      <Icon name={btn.icon} size={iconSizes.md} color="currentColor" />
                      {btn.label}
                    </span>
                  </button>
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
                <iframe title={`${item.name} trailer`} src={`${trailer}?autoplay=1`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen style={{ width: "100%", height: "100%", border: "none" }} />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Movie grid ────────────────────────────────────────────────────────────
  if (page) {
    const filteredItems = page.items ? getFilteredItems(page.items) : null;
    return (
      <div className="tvl-screen">
        <div className="tvl-topbar">
          <button className={filterZone === "back" ? "tvl-topbar-back tvl-topbar-back--focused" : "tvl-topbar-back"} onClick={closePage}><Icon name="back" size={iconSizes.md} color="currentColor" /></button>
          <button className="tvl-topbar-title tvl-topbar-title--back" onClick={closePage}>{page.name}</button>
          {filteredItems && <span className="tvl-topbar-count">{filteredItems.length.toLocaleString()}</span>}
        </div>
        <div className={filterZone === "search" ? "tvl-cat-search tvl-cat-search--on" : "tvl-cat-search"}>
          <span className="tvl-cat-search-icon"><Icon name="search" size={iconSizes.md} color="currentColor" /></span>
          <input
            ref={gridSearchInputRef}
            className="tvl-cat-search-input"
            type="text"
            dir="auto"
            autoComplete="off"
            placeholder="Search movies…"
            value={gridQuery}
            onChange={(e) => onGridQueryChange(e.target.value)}
          />
        </div>
        <div className="tvl-letter-bar">
          {ALPHA.map((letter, i) => {
            const val = letter === "ALL" ? "all" : letter.toLowerCase();
            return (
              <button
                key={letter}
                className={["tvl-letter-btn", filterZone === "filter" && i === filterIdx ? "tvl-letter-btn--focused" : "", filterLetter === val ? "tvl-letter-btn--active" : ""].filter(Boolean).join(" ")}
                onClick={() => { filterIdxRef.current = i; setFilterIdx(i); onFilterEnter(); }}
              >
                {letter}
              </button>
            );
          })}
        </div>
        {!filteredItems && !page.failed && <div className="tvl-center"><div className="tvl-spinner" /><p>Loading movies…</p></div>}
        {page.failed && (
          <StatePanel
            mode="error"
            title="Couldn't load movies"
            message="Something went wrong fetching this category."
            onRetry={() => openCat({ id: page.catId, name: page.name })}
          />
        )}
        {!page.failed && filteredItems?.length === 0 && <div className="tvl-center"><p className="tvl-empty-msg">{gridQuery.trim() ? "No results" : `No titles starting with "${filterLetter.toUpperCase()}"`}</p></div>}
        {filteredItems && filteredItems.length > 0 && (
          <div className="tvl-mov-grid-window">
            <PagedGridTV
              items={filteredItems}
              cols={MOV_COLS}
              gap={MOV_GAP}
              focusIndex={page.focus}
              pageSize={MOV_PAGE}
              display={page.display}
              onGrow={growMovDisplay}
              className="tvl-mov-vgrid"
              renderItem={(item, i) => (
                <MovieCard key={String(item.stream_id)} item={item} isFocused={filterZone === "grid" && !navActive && i === page.focus} />
              )}
            />
          </div>
        )}
      </div>
    );
  }

  // ── Shelf browse view (Electron-parity, flag on) ───────────────────────────
  if (tvUseShelves && !browseAll) {
    return (
      <div className="tvl-screen">
        <div className="tvl-topbar"><span className="tvl-topbar-title">Movies</span></div>
        {shelves.length === 0
          ? <div className="tvl-center"><div className="tvl-spinner" /><p>Loading movies…</p></div>
          : (
            <VirtualShelvesTV
              shelves={shelves}
              onShelfVisible={handleShelfVisible}
              onLoadMore={handleLoadMore}
              onSelect={(item) => openDetail(item)}
              onSeeAll={(id, name) => openCat({ id, name })}
              renderCard={(item, isFocused, cardW) => (
                <PosterCard item={item} isFocused={isFocused} width={cardW} onPress={openDetail} />
              )}
              showHero={false}
              discoverItems={[{ id: "all", label: "All Movies" }]}
              onPill={() => openCat({ id: "all", name: "All Movies" })}
              onUpAtTop={yieldFocusToNav}
            />
          )}
      </div>
    );
  }

  // ── Category grid ─────────────────────────────────────────────────────────
  return (
    <div className="tvl-screen">
      <div className="tvl-topbar"><span className="tvl-topbar-title">Movies</span></div>
      <div className="tvl-scroll">
        <div className={catZone === "search" && !navActive ? "tvl-cat-search tvl-cat-search--on" : "tvl-cat-search"}>
          <span className="tvl-cat-search-icon"><Icon name="search" size={iconSizes.md} color="currentColor" /></span>
          <input
            ref={searchInputRef}
            className="tvl-cat-search-input"
            type="text"
            dir="auto"
            autoComplete="off"
            placeholder="Search categories…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="tvl-cat-grid">
          {cats.map((cat, i) => (
            <button
              key={cat.id}
              ref={i === catFocus ? catElRef : null}
              className={catZone === "grid" && i === catFocus ? "tvl-cat-card tvl-cat-card--on" : "tvl-cat-card"}
              onClick={() => openCat(cat)}
            >
              {cat.name}
            </button>
          ))}
        </div>
        {q && cats.length <= 1 && (
          <div className="tvl-center"><p className="tvl-empty-msg">No categories match</p></div>
        )}
      </div>
    </div>
  );
}

// Memoized: only `item` + `isFocused` matter, so a keypress that moves focus
// re-renders just the two affected cards, not the whole mounted grid. This is
// the immediate per-keypress win for the webOS scroll-freeze profile.
const MovieCard = memo(function MovieCard({ item, isFocused }) {
  const [err, setErr] = useState(false);
  const src = item.stream_icon || item.cover || item.movie_image || null;
  const rating = item.tmdb_rating ?? item.rating;
  const rLabel = rating != null && rating !== "" ? (typeof rating === "number" ? Math.round(rating) : rating) : null;
  return (
    <div className={isFocused ? "tvl-card tvl-card--on" : "tvl-card"}>
      <div className="tvl-card-img">
        {src && !err ? <img src={src} alt="" onError={() => setErr(true)} loading="lazy" decoding="async" /> : <div className="tvl-card-ph"><Icon name="play" size={iconSizes.lg} color={colors.border} /></div>}
        {rLabel && <span className="tvl-card-rating">{rLabel}</span>}
      </div>
      <div className="tvl-card-title">{item.name}</div>
    </div>
  );
});
