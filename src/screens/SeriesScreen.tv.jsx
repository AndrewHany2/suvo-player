import { useState, useEffect, useRef, useMemo } from "react";
import { VirtualShelvesTV } from "../presentation/components/VirtualShelves.tv";
import { useApp } from "../context/AppContext";
import { useSeries } from "../domain/hooks/useSeries";
import { PagedGridTV } from "../presentation/components/PagedGrid.tv";
import ShelfCard from "../presentation/components/ShelfCard.tv";
import StatePanel from "../ui/StatePanel";
import { emptyContentProps } from "../ui/emptyContentProps";
import Icon from "../ui/Icon";
import { colors, iconSizes } from "../ui/tokens";
import { isMacCommand } from "../platform/adapters/input/keys";
import "../styles/tvl.css";
import "../styles/tvResponsiveScaling.css";
import "../styles/tvRemoteFocus.css";
import "./SeriesScreen.tv.css";

import { getTrailerEmbedUrl as getTrailerUrl } from "../utils/youtubeTrailer";
import PosterCardWeb from "../presentation/components/PosterCard.web";

const CAT_COLS = 4;
const SER_COLS = 5;
const SER_PAGE = 24;
// Grid gap (design px @ 1280 viewport): fewer/larger 5-col posters for
// 10-foot lean-back viewing.
const SER_GAP = 14;
const ALPHA = ["ALL", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

const KEY_LEFT = 37;
const KEY_UP = 38;
const KEY_RIGHT = 39;
const KEY_DOWN = 40;
const KEY_ENTER = 13;
const KEY_BACK = new Set([27, 461, 10009, 8, 91]);

// mode: 'cats' | 'grid' | 'detail'

export default function SeriesScreenTV({ navigation, route }) {
  const {
    loading, loaded, error, reload, activeUserId,
    categories, getCategoryItems, fetchSeriesInfo, buildEpisodeUrl, playEpisodeObject,
    shelves, handleShelfVisible, handleLoadMore,
  } = useSeries({ navigation });
  const {
    watchHistory,
    isInMyList, addToMyList, removeFromMyList,
    currentVideo, tvUseShelves,
  } = useApp();
  const tvUseShelvesRef = useRef(tvUseShelves);
  useEffect(() => { tvUseShelvesRef.current = tvUseShelves; }, [tvUseShelves]);
  // "All Series" pill opens the category-grid landing over the shelves (cheap;
  // reuses loaded categories). Transient — does not touch the persisted toggle.
  const [browseAll, setBrowseAll] = useState(false);
  const browseAllRef = useRef(false);
  useEffect(() => { browseAllRef.current = browseAll; }, [browseAll]);
  const currentVideoRef = useRef(null);
  useEffect(() => { currentVideoRef.current = currentVideo; }, [currentVideo]);

  const [catFocus, setCatFocus] = useState(0);
  const [grid, setGrid] = useState(null);
  const [detail, setDetail] = useState(null);
  const [query, setQuery] = useState("");
  const [catZone, setCatZone] = useState("grid");

  const catsRef = useRef([]);
  const catFocRef = useRef(0);
  const catZoneRef = useRef("grid");
  const searchInputRef = useRef(null);
  const gridRef = useRef(null);
  const detailRef = useRef(null);
  const catElRef = useRef(null);
  const epElRef = useRef(null);
  const snElRef = useRef(null);
  const actionElRef = useRef(null);
  const navActiveRef = useRef(false);
  // Mirror of navActiveRef as state so the grid focus ring re-renders (and
  // clears) the moment the remote hands focus up to the top navbar.
  const [navActive, setNavActive] = useState(false);

  const [filterZone, setFilterZone] = useState("grid");
  const filterZoneRef = useRef("grid");
  const [filterIdx, setFilterIdx] = useState(0);
  const filterIdxRef = useRef(0);
  const [filterLetter, setFilterLetter] = useState("all");
  const filterLetterRef = useRef("all");

  // Grid-view text search (composes with the alpha filter).
  const [gridQuery, setGridQuery] = useState("");
  const gridQueryRef = useRef("");
  const gridSearchInputRef = useRef(null);

  const getFilteredItems = (items) => {
    if (!items) return [];
    const letter = filterLetterRef.current;
    const gridQ = gridQueryRef.current;
    let out = items;
    if (letter !== "all") out = out.filter((s) => s.name?.toLowerCase().startsWith(letter));
    if (gridQ) out = out.filter((s) => s.name?.toLowerCase().includes(gridQ));
    return out;
  };

  const focusNav = () => {
    navActiveRef.current = true;
    setNavActive(true);
    globalThis.dispatchEvent(new CustomEvent("tv-nav-focus"));
  };

  // Category cards: the shared hook's shelves carry the real {id,name}; prepend
  // the synthetic "All Series" landing (its grid fetches the whole catalog).
  const cats = useMemo(
    () => (categories.length ? [{ id: "all", name: "All Series" }, ...categories] : categories),
    [categories],
  );
  // Category cards filtered by the search query — "All Series" stays pinned.
  const q = query.trim().toLowerCase();
  const visibleCats = useMemo(
    () => (q && cats.length
      ? [cats[0], ...cats.slice(1).filter((c) => c.name?.toLowerCase().includes(q))]
      : cats),
    [q, cats],
  );

  useEffect(() => {
    catsRef.current = visibleCats;
  }, [visibleCats]);
  // Keep category focus in range whenever the filtered list shrinks.
  useEffect(() => {
    if (catFocRef.current > visibleCats.length - 1) { catFocRef.current = 0; setCatFocus(0); }
  }, [visibleCats.length]);
  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);
  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  // Handle navigation from history - open detail if params provided
  useEffect(() => {
    if (route?.params?.openDetail && route?.params?.seriesId) {
      const seriesId = route.params.seriesId;
      const hasHistory = route.params.hasHistory || false;
      const episodeId = route.params.episodeId;
      // Create a minimal item object to open detail
      const item = {
        series_id: seriesId,
        id: seriesId,
        seriesId: seriesId,
        name: route.params.name || "Series",
        cover: route.params.cover || null,
        stream_icon: route.params.cover || null,
        container_extension: route.params.containerExtension || "mp4",
      };
      // Small delay to ensure screen is mounted
      setTimeout(() => {
        openDetail(item, hasHistory, episodeId);
        // Clear the params to prevent reopening on re-render
        navigation.setParams({ openDetail: false });
      }, 100);
    }
  // Deep-link handler: fire only when the openDetail flag flips, reading the
  // other route params at that moment; not on every param/navigation change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.openDetail]);

  // ── Open category grid ────────────────────────────────────────────────────
  const openGrid = async (cat) => {
    const next = {
      catId: cat.id,
      name: cat.name,
      items: null,
      display: SER_PAGE,
      focus: 0,
      failed: false,
    };
    setGrid(next);
    gridRef.current = next;
    try {
      // getCategoryItems is cache-warm (shared with shelf drill-in) and handles
      // the synthetic "all" (whole catalog) vs a real category internally.
      const all = await getCategoryItems(cat.id);
      const updated = { ...next, items: all };
      setGrid(updated);
      gridRef.current = updated;
    } catch {
      // Fetch FAILURE (error + retry), distinct from an empty series list.
      const updated = { ...next, items: [], failed: true };
      setGrid(updated);
      gridRef.current = updated;
    }
  };

  const resetFilter = () => {
    filterLetterRef.current = "all";
    setFilterLetter("all");
    filterZoneRef.current = "grid";
    setFilterZone("grid");
    filterIdxRef.current = 0;
    setFilterIdx(0);
    gridQueryRef.current = "";
    setGridQuery("");
  };

  // Reset grid focus + scroll to top whenever the text query changes.
  const onGridQueryChange = (val) => {
    setGridQuery(val);
    gridQueryRef.current = val.trim().toLowerCase();
    const g = gridRef.current;
    if (g) { const n = { ...g, focus: 0, display: SER_PAGE }; gridRef.current = n; setGrid(n); }
  };

  const closeGrid = () => {
    setGrid(null);
    gridRef.current = null;
    resetFilter();
  };

  // ── Open series detail ────────────────────────────────────────────────────
  const openDetail = async (
    item,
    hasHistory = false,
    targetEpisodeId = null,
  ) => {
    const next = {
      item,
      info: null,
      seasons: [],
      seasonIdx: 0,
      epIdx: 0,
      section: "actions",
      actionIdx: 0,
      trailerFocus: false,
      showTrailer: false,
    };
    setDetail(next);
    detailRef.current = next;
    try {
      const info = await fetchSeriesInfo(item.series_id || item.id);
      const rawSeasons = info?.seasons;
      const seasons = Array.isArray(rawSeasons)
        ? rawSeasons
            .map((s) => String(s.season_number || s.id))
            .sort((a, b) => Number(a) - Number(b))
        : Object.keys(rawSeasons || {}).sort((a, b) => Number(a) - Number(b));

      // If we have a target episode from history, find and focus it
      let seasonIdx = 0;
      let epIdx = 0;
      if (targetEpisodeId && info?.episodes) {
        const allEpisodes = Object.values(info.episodes).flat();
        const targetEp = allEpisodes.find(
          (ep) => String(ep.id) === String(targetEpisodeId),
        );
        if (targetEp) {
          const seasonNum = String(
            targetEp.season || targetEp.season_number || 1,
          );
          seasonIdx = seasons.indexOf(seasonNum);
          if (seasonIdx >= 0) {
            const seasonEpisodes = info.episodes[seasonNum] || [];
            epIdx = seasonEpisodes.findIndex(
              (ep) => String(ep.id) === String(targetEpisodeId),
            );
            if (epIdx < 0) epIdx = 0;
          }
        }
      }

      const updated = { ...next, info, seasons, seasonIdx, epIdx };
      setDetail(updated);
      detailRef.current = updated;
    } catch {
      const updated = { ...next, info: {}, seasons: [] };
      setDetail(updated);
      detailRef.current = updated;
    }
  };

  const closeDetail = () => {
    setDetail(null);
    detailRef.current = null;
  };

  // ── Play episode ──────────────────────────────────────────────────────────
  const playEpisode = (series, episode) => {
    const url = buildEpisodeUrl(episode.id, episode.container_extension || "mp4");

    // Check if there's watch history for this episode
    const historyEntry = (watchHistory || []).find(
      (h) => h.type === "series" && String(h.episodeId) === String(episode.id),
    );
    const startTime = historyEntry?.currentTime || 0;

    playEpisodeObject({
      type: "series",
      streamId: String(episode.id),
      seriesId: series.series_id || series.id,
      seriesName: series.name,
      episodeId: episode.id,
      name: `${series.name} — ${episode.title || "E" + episode.episode_num}`,
      url,
      cover: series.cover || series.stream_icon,
      startTime,
    });
  };

  // ── Continue watching a series ────────────────────────────────────────────
  const continueWatching = (d) => {
    const seriesId = d.item.series_id || d.item.id || d.item.seriesId;
    const entry = (watchHistory || []).find(
      (h) => h.type === "series" && String(h.seriesId) === String(seriesId),
    );
    if (!entry) return;
    const url = buildEpisodeUrl(entry.streamId);
    playEpisodeObject({
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

  // ── D-pad handler ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (isMacCommand(e)) return; // ⌘ shares keyCode 91 with Back in the sim
      if (navActiveRef.current) return;
      if (currentVideoRef.current) return;
      const k = e.keyCode || e.which;
      if (detailRef.current) handleDetailKey(k, e);
      else if (gridRef.current) handleGridKey(k, e);
      else handleCatKey(k, e);
    };
    const onNavBlur = () => {
      navActiveRef.current = false;
      setNavActive(false);
    };
    document.addEventListener("keydown", onKey);
    globalThis.addEventListener("tv-nav-blur", onNavBlur);
    return () => {
      document.removeEventListener("keydown", onKey);
      globalThis.removeEventListener("tv-nav-blur", onNavBlur);
    };
  // Single key router bound once; handleCatKey/handleGridKey/handleDetailKey
  // read live state via refs, so the deps stay empty by design.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Category grid ─────────────────────────────────────────────────────────
  const setCatZoneBoth = (z) => { catZoneRef.current = z; setCatZone(z); };
  const movCat = (n) => {
    catFocRef.current = n;
    setCatFocus(n);
  };
  const onCatLeft = () => {
    const f = catFocRef.current;
    if (f > 0) movCat(f - 1);
  };
  const onCatRight = () => {
    const f = catFocRef.current;
    const max = catsRef.current.length - 1;
    if (f < max) movCat(f + 1);
  };
  const onCatUp = () => {
    const f = catFocRef.current;
    if (f >= CAT_COLS) movCat(f - CAT_COLS);
    else setCatZoneBoth("search");
  };
  const onCatDown = () => {
    const f = catFocRef.current;
    movCat(Math.min(f + CAT_COLS, catsRef.current.length - 1));
  };
  const onCatEnter = () => {
    const cat = catsRef.current[catFocRef.current];
    if (cat) openGrid(cat);
  };

  // Search-bar zone (above the category grid).
  const inputFocused = () => document.activeElement === searchInputRef.current;
  const handleSearchKey = (k) => {
    switch (k) {
      case KEY_UP: focusNav(); break;
      case KEY_DOWN: setCatZoneBoth("grid"); break;
      case KEY_ENTER: searchInputRef.current?.focus(); break;
    }
  };

  const handleCatKey = (k, e) => {
    // While the input has focus, let typing/cursor work; only Back/Escape acts.
    if (inputFocused()) {
      if (KEY_BACK.has(k)) {
        e.preventDefault();
        searchInputRef.current?.blur();
        setCatZoneBoth("search");
      }
      return;
    }
    e.preventDefault();
    if (KEY_BACK.has(k)) {
      if (browseAllRef.current) { setBrowseAll(false); }
      else { navigation.goBack?.(); }
      return;
    }
    // Shelves own the browse view — VirtualShelves.tv handles its own D-pad.
    if (tvUseShelvesRef.current && !browseAllRef.current) return;
    if (catZoneRef.current === "search") { handleSearchKey(k); return; }
    switch (k) {
      case KEY_LEFT:
        onCatLeft();
        break;
      case KEY_RIGHT:
        onCatRight();
        break;
      case KEY_UP:
        onCatUp();
        break;
      case KEY_DOWN:
        onCatDown();
        break;
      case KEY_ENTER:
        onCatEnter();
        break;
    }
  };

  // ── Series grid ───────────────────────────────────────────────────────────
  // The grid grows on scroll (PagedGridTV), so focus may roam the whole
  // filtered list — bounds use the full length, not a display cap.
  const movGrid = (g, focus) => {
    const n = { ...g, focus };
    gridRef.current = n;
    setGrid(n);
  };

  const growGridDisplay = (next) => { const g = gridRef.current; if (g) { const n = { ...g, display: next }; gridRef.current = n; setGrid(n); } };

  const onGridLeft = (g) => {
    if (g.focus > 0) movGrid(g, g.focus - 1);
  };
  const onGridRight = (g) => {
    const filtered = getFilteredItems(g.items);
    const max = filtered.length - 1;
    if (g.focus >= max) return;
    movGrid(g, g.focus + 1);
  };
  const onGridUp = (g) => {
    if (g.focus >= SER_COLS) movGrid(g, g.focus - SER_COLS);
    else {
      filterZoneRef.current = "filter";
      setFilterZone("filter");
    }
  };
  const onGridDown = (g) => {
    const filtered = getFilteredItems(g.items);
    const max = filtered.length - 1;
    const next = Math.min(g.focus + SER_COLS, max);
    movGrid(g, next);
  };
  const onGridEnter = (g) => {
    const filtered = getFilteredItems(g.items);
    const item = filtered[g.focus];
    if (item) openDetail(item);
  };

  const onFilterLeft = () => {
    if (filterIdxRef.current > 0) {
      filterIdxRef.current -= 1;
      setFilterIdx(filterIdxRef.current);
    }
  };
  const onFilterRight = () => {
    if (filterIdxRef.current < ALPHA.length - 1) {
      filterIdxRef.current += 1;
      setFilterIdx(filterIdxRef.current);
    }
  };
  const onFilterUp = () => {
    filterZoneRef.current = "search";
    setFilterZone("search");
  };
  const onFilterDown = () => {
    filterZoneRef.current = "grid";
    setFilterZone("grid");
  };

  // Grid search-bar zone (above the alpha-filter letter bar).
  const gridInputFocused = () => document.activeElement === gridSearchInputRef.current;
  const handleGridSearchKey = (k) => {
    switch (k) {
      case KEY_UP:
        filterZoneRef.current = "back"; setFilterZone("back");
        break;
      case KEY_DOWN:
        filterZoneRef.current = "filter"; setFilterZone("filter");
        break;
      case KEY_ENTER:
        gridSearchInputRef.current?.focus();
        break;
    }
  };
  // Topbar back-icon zone (above the search bar, below the global navbar).
  const handleGridBackKey = (k) => {
    switch (k) {
      case KEY_UP:
        filterZoneRef.current = "grid"; setFilterZone("grid"); focusNav();
        break;
      case KEY_DOWN:
        filterZoneRef.current = "search"; setFilterZone("search");
        break;
      case KEY_ENTER:
        closeGrid();
        break;
    }
  };
  const onFilterEnter = () => {
    const letter = ALPHA[filterIdxRef.current] === "ALL" ? "all" : ALPHA[filterIdxRef.current].toLowerCase();
    filterLetterRef.current = letter;
    setFilterLetter(letter);
    const g = gridRef.current;
    if (g?.items) {
      const filtered = getFilteredItems(g.items);
      const updated = { ...g, focus: 0, display: Math.min(SER_PAGE, filtered.length) };
      gridRef.current = updated;
      setGrid(updated);
    }
    filterZoneRef.current = "grid";
    setFilterZone("grid");
  };

  const handleGridKey = (k, e) => {
    // While the grid search input has focus, let typing/cursor work; only Back acts.
    if (gridInputFocused()) {
      if (KEY_BACK.has(k)) {
        e.preventDefault();
        gridSearchInputRef.current?.blur();
        filterZoneRef.current = "search";
        setFilterZone("search");
      }
      return;
    }
    e.preventDefault();
    if (KEY_BACK.has(k)) {
      if (filterZoneRef.current === "filter" || filterZoneRef.current === "search") {
        filterZoneRef.current = "grid";
        setFilterZone("grid");
      } else {
        closeGrid();
      }
      return;
    }
    if (filterZoneRef.current === "back") { handleGridBackKey(k); return; }
    if (filterZoneRef.current === "search") { handleGridSearchKey(k); return; }
    if (filterZoneRef.current === "filter") {
      switch (k) {
        case KEY_LEFT: onFilterLeft(); break;
        case KEY_RIGHT: onFilterRight(); break;
        case KEY_UP: onFilterUp(); break;
        case KEY_DOWN: onFilterDown(); break;
        case KEY_ENTER: onFilterEnter(); break;
      }
      return;
    }
    const g = gridRef.current;
    if (!g?.items) return;
    switch (k) {
      case KEY_LEFT: onGridLeft(g); break;
      case KEY_RIGHT: onGridRight(g); break;
      case KEY_UP: onGridUp(g); break;
      case KEY_DOWN: onGridDown(g); break;
      case KEY_ENTER: onGridEnter(g); break;
    }
  };

  // ── Series detail ─────────────────────────────────────────────────────────
  const updDetail = (d) => {
    detailRef.current = d;
    setDetail(d);
  };

  const onDetailLeft = (d) => {
    if (d.trailerFocus) {
      updDetail({ ...d, trailerFocus: false, seasonIdx: d.seasons.length - 1 });
    } else if (d.section === "actions" && d.actionIdx > 0) {
      updDetail({ ...d, actionIdx: d.actionIdx - 1 });
    } else if (d.section === "seasons" && d.seasonIdx > 0) {
      updDetail({ ...d, seasonIdx: d.seasonIdx - 1, epIdx: 0 });
    }
    // Left on the first action button is a no-op — only Back closes the detail
    // (matches MoviesScreen). Previously this called closeDetail(), so a single
    // Left press on "Continue" felt like an unwanted history-back in Series only.
  };
  const onDetailRight = (d) => {
    const trailer = getTrailerUrl(d.info?.info?.youtube_trailer);
    if (d.section === "actions") {
      const seriesId = d.item.series_id || d.item.id || d.item.seriesId;
      const hasHistory = (watchHistory || []).some(
        (h) => h.type === "series" && String(h.seriesId) === String(seriesId),
      );
      // buttons: [Continue (if history), Favorites] → max index 1 or 0
      if (d.actionIdx < (hasHistory ? 1 : 0))
        updDetail({ ...d, actionIdx: d.actionIdx + 1 });
    } else if (!d.trailerFocus && d.section === "seasons") {
      if (d.seasonIdx < d.seasons.length - 1)
        updDetail({ ...d, seasonIdx: d.seasonIdx + 1, epIdx: 0 });
      else if (trailer) updDetail({ ...d, trailerFocus: true });
    }
  };
  const onDetailUp = (d) => {
    if (d.section === "back") {
      focusNav();
      return;
    }
    if (d.trailerFocus) {
      focusNav();
      return;
    }
    if (d.section === "episodes") {
      if (d.epIdx > 0) updDetail({ ...d, epIdx: d.epIdx - 1 });
      else updDetail({ ...d, section: "seasons" });
    } else if (d.section === "seasons") {
      updDetail({ ...d, section: "actions", actionIdx: 0 });
    } else {
      // section === "actions" → focus the topbar back icon (sits between the
      // action buttons and the global navbar).
      updDetail({ ...d, section: "back" });
    }
  };
  const onDetailDown = (d) => {
    if (d.section === "back") {
      updDetail({ ...d, section: "actions", actionIdx: 0 });
      return;
    }
    if (d.trailerFocus) {
      updDetail({ ...d, trailerFocus: false, section: "episodes", epIdx: 0 });
      return;
    }
    if (d.section === "actions") {
      updDetail({ ...d, section: "seasons" });
    } else if (d.section === "seasons") {
      return;
    } else {
      const eps = d.info?.episodes?.[d.seasons[d.seasonIdx]] || [];
      if (d.epIdx < eps.length - 1) updDetail({ ...d, epIdx: d.epIdx + 1 });
    }
  };
  const onDetailEnter = (d) => {
    if (d.section === "back") {
      closeDetail();
      return;
    }
    if (d.trailerFocus) {
      updDetail({ ...d, showTrailer: !d.showTrailer });
      return;
    }
    if (d.section === "actions") {
      const seriesId = d.item.series_id || d.item.id || d.item.seriesId;
      const historyEntry = (watchHistory || []).find(
        (h) => h.type === "series" && String(h.seriesId) === String(seriesId),
      );
      const inFav = isInMyList("series", seriesId);
      if (historyEntry && d.actionIdx === 0) {
        continueWatching(d);
      } else {
        if (inFav) removeFromMyList(`mylist_series_${seriesId}`);
        else
          addToMyList({
            type: "series",
            streamId: seriesId,
            seriesId,
            name: d.item.name,
            cover: d.info?.info?.cover || d.item.cover || d.item.stream_icon || null,
          });
      }
      return;
    }
    if (d.section === "seasons") {
      updDetail({ ...d, section: "episodes", epIdx: 0 });
    } else {
      const eps = d.info?.episodes?.[d.seasons[d.seasonIdx]] || [];
      const ep = eps[d.epIdx];
      if (ep) playEpisode(d.item, ep);
    }
  };

  const handleDetailKey = (k, e) => {
    const d = detailRef.current;
    if (!d) return;
    e.preventDefault();
    switch (k) {
      case KEY_LEFT:
        onDetailLeft(d);
        break;
      case KEY_RIGHT:
        onDetailRight(d);
        break;
      case KEY_UP:
        onDetailUp(d);
        break;
      case KEY_DOWN:
        onDetailDown(d);
        break;
      case KEY_ENTER:
        onDetailEnter(d);
        break;
      default:
        // Back in the detail view only closes the detail (one level). It must
        // NOT also call navigation.goBack() — that double-pops (closes the
        // detail AND navigates back a tab) on a single press.
        if (KEY_BACK.has(k)) closeDetail();
    }
  };

  // ── Scroll into view ──────────────────────────────────────────────────────
  useEffect(() => {
    catElRef.current?.scrollIntoView({ block: "nearest" });
  }, [catFocus]);
  // Series-grid focus scrolling is handled inside PagedGridTV (focusIndex).
  useEffect(() => {
    epElRef.current?.scrollIntoView({ block: "nearest" });
  }, [detail?.epIdx]);
  useEffect(() => {
    snElRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [detail?.seasonIdx]);
  useEffect(() => {
    actionElRef.current?.scrollIntoView({ block: "nearest" });
  }, [detail?.actionIdx]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading)
    return (
      <div className="tvl-screen">
        <StatePanel mode="loading" title="Loading series…" />
      </div>
    );

  if (!activeUserId) {
    return (
      <div className="tvl-screen">
        <StatePanel
          mode="empty"
          icon="tv"
          title="No account"
          message="Add your media service from Settings"
          cta={() => navigation.navigate("Accounts")}
          ctaLabel="Add Account"
        />
      </div>
    );
  }

  // ── Detail view ───────────────────────────────────────────────────────────
  if (detail) {
    const {
      item,
      info: rawInfo,
      seasons,
      seasonIdx,
      epIdx,
      section,
      actionIdx,
      trailerFocus,
      showTrailer,
    } = detail;
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
      ...(historyEntry
        ? [{
            type: "continue",
            icon: "play",
            label: "Continue" + (historyEntry.seasonNum
              ? ` S${historyEntry.seasonNum}E${String(historyEntry.episodeNum).padStart(2, "0")}`
              : ""),
          }]
        : []),
      { type: "fav", icon: "star", label: inFav ? "Saved" : "Favorites" },
    ];
    const actBtnClass = (i) =>
      [
        "tvl-det-hero-btn",
        actionBtns[i].type === "continue" ? "tvl-det-hero-btn--play" : "",
        actionBtns[i].type === "fav" && inFav ? "tvl-det-hero-btn--saved" : "",
        section === "actions" && i === actionIdx ? "tvl-det-hero-btn--on" : "",
      ]
        .filter(Boolean)
        .join(" ");

    return (
      <div className="tvl-screen">
        <div className="tvl-topbar">
          <button className={section === "back" ? "tvl-topbar-back tvl-topbar-back--focused" : "tvl-topbar-back"} onClick={closeDetail}><Icon name="back" size={iconSizes.md} color="currentColor" /></button>
          <button className="tvl-topbar-title tvl-topbar-title--back" onClick={closeDetail}>
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
            {poster
              ? <img src={poster} alt="" />
              : <div className="tvl-det-hero-thumb-ph"><Icon name="tv" size={iconSizes.lg} color={colors.border} /></div>}
          </div>
          <div className="tvl-det-hero-info">
            <div className="tvl-det-hero-title">{item.name}</div>
            <div className="tvl-det-hero-meta">
              {si.releaseDate && <span className="tvl-det-tag">{si.releaseDate.slice(0, 4)}</span>}
              {si.genre && <span className="tvl-det-tag">{si.genre.split(",")[0].trim()}</span>}
              {si.rating && <span className="tvl-det-rating" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="star" size={iconSizes.sm} color={colors.rating} /> {Number.parseFloat(si.rating).toFixed(1)}</span>}
            </div>
            {!rawInfo && <div className="tvl-spinner" style={{ alignSelf: "flex-start" }} />}
            {rawInfo && (
              <div className="tvl-det-hero-btns">
                {actionBtns.map((btn, i) => (
                  <button
                    key={btn.type}
                    ref={section === "actions" && i === actionIdx ? actionElRef : null}
                    className={actBtnClass(i)}
                    onClick={() => {
                      if (btn.type === "continue") continueWatching(detail);
                      else if (btn.type === "fav") {
                        if (inFav) removeFromMyList(`mylist_series_${seriesId}`);
                        else addToMyList({ type: "series", streamId: seriesId, seriesId, name: item.name, cover: poster });
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
            {si.plot && <p className="tvl-det-hero-plot">{si.plot}</p>}
          </div>
        </div>

        {/* Seasons + episodes */}
        {rawInfo ? (
          <>
            <div className="tvl-seasons-row">
              {seasons.map((s, i) => (
                <div
                  key={s}
                  ref={section === "seasons" && i === seasonIdx ? snElRef : null}
                  className={section === "seasons" && i === seasonIdx ? "tvl-season-btn tvl-season-btn--on" : "tvl-season-btn"}
                >
                  Season {s}
                </div>
              ))}
              {trailer && (
                <div className={trailerFocus ? "tvl-season-btn tvl-season-btn--on" : "tvl-season-btn"}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Icon name={showTrailer ? "close" : "film"} size={iconSizes.sm} color="currentColor" />
                    Trailer
                  </span>
                </div>
              )}
            </div>
            {showTrailer && trailer && (
              <div className="tvl-ser-trailer">
                <iframe
                  title="trailer"
                  src={`${trailer}?autoplay=1`}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  style={{ width: "100%", height: "100%", border: "none" }}
                />
              </div>
            )}
            <div className="tvl-episodes">
              {episodes.map((ep, i) => {
                const epHistory = (watchHistory || []).find(
                  (h) => h.type === "series" && String(h.episodeId) === String(ep.id),
                );
                const hasProgress = epHistory && epHistory.currentTime > 0;
                const isWatched =
                  hasProgress &&
                  epHistory.duration > 0 &&
                  epHistory.currentTime / epHistory.duration > 0.9;
                return (
                  <div
                    key={ep.id}
                    ref={section === "episodes" && i === epIdx ? epElRef : null}
                    className={section === "episodes" && i === epIdx ? "tvl-episode tvl-episode--on" : "tvl-episode"}
                  >
                    <span className="tvl-ep-badge">E{ep.episode_num}</span>
                    <div className="tvl-ep-body">
                      <div className="tvl-ep-title">
                        {ep.title || `Episode ${ep.episode_num}`}
                        {isWatched && <span style={{ marginLeft: 8, display: "inline-flex", verticalAlign: "middle" }}><Icon name="check" size={iconSizes.sm} color={colors.accent2} /></span>}
                      </div>
                      {ep.info?.plot && <div className="tvl-ep-plot">{ep.info.plot}</div>}
                      {ep.info?.duration && <div className="tvl-ep-dur">{ep.info.duration}</div>}
                      {hasProgress && !isWatched && (
                        <div style={{ fontSize: 11, color: "#6C5CE7", marginTop: 4 }}>
                          Continue from {Math.floor(epHistory.currentTime / 60)}:{String(Math.floor(epHistory.currentTime % 60)).padStart(2, "0")}
                        </div>
                      )}
                    </div>
                    <span className="tvl-ep-play"><Icon name="play" size={iconSizes.md} color="currentColor" /></span>
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

  // ── Grid view ─────────────────────────────────────────────────────────────
  if (grid) {
    const filteredItems = grid.items ? getFilteredItems(grid.items) : null;
    return (
      <div className="tvl-screen">
        <div className="tvl-topbar">
          <button className={filterZone === "back" ? "tvl-topbar-back tvl-topbar-back--focused" : "tvl-topbar-back"} onClick={closeGrid}><Icon name="back" size={iconSizes.md} color="currentColor" /></button>
          <button className="tvl-topbar-title tvl-topbar-title--back" onClick={closeGrid}>
            {grid.name}
          </button>
          {filteredItems && (
            <span className="tvl-topbar-count">
              {filteredItems.length.toLocaleString()}
            </span>
          )}
        </div>
        <div className={filterZone === "search" ? "tvl-cat-search tvl-cat-search--on" : "tvl-cat-search"}>
          <span className="tvl-cat-search-icon"><Icon name="search" size={iconSizes.md} color="currentColor" /></span>
          <input
            ref={gridSearchInputRef}
            className="tvl-cat-search-input"
            type="text"
            dir="auto"
            autoComplete="off"
            placeholder="Search series…"
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
                className={[
                  "tvl-letter-btn",
                  filterZone === "filter" && i === filterIdx ? "tvl-letter-btn--focused" : "",
                  filterLetter === val ? "tvl-letter-btn--active" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => {
                  filterIdxRef.current = i;
                  setFilterIdx(i);
                  onFilterEnter();
                }}
              >
                {letter}
              </button>
            );
          })}
        </div>
        {!filteredItems && !grid.failed && (
          <div className="tvl-center">
            <div className="tvl-spinner" />
          </div>
        )}
        {grid.failed && (
          <StatePanel
            mode="error"
            title="Couldn't load series"
            message="Something went wrong fetching this category."
            onRetry={() => openGrid({ id: grid.catId, name: grid.name })}
          />
        )}
        {!grid.failed && filteredItems?.length === 0 && (
          <div className="tvl-center">
            <p className="tvl-empty-msg">{gridQuery.trim() ? "No results" : `No titles starting with "${filterLetter.toUpperCase()}"`}</p>
          </div>
        )}
        {filteredItems && filteredItems.length > 0 && (
          <div className="tvl-ser-grid-window">
            <PagedGridTV
              items={filteredItems}
              cols={SER_COLS}
              gap={SER_GAP}
              focusIndex={grid.focus}
              pageSize={SER_PAGE}
              display={grid.display}
              onGrow={growGridDisplay}
              className="tvl-ser-vgrid"
              renderItem={(item, i) => (
                <ShelfCard
                  key={String(item.series_id)}
                  item={item}
                  isFocused={filterZone === "grid" && !navActive && i === grid.focus}
                />
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
        <div className="tvl-topbar">
          <span className="tvl-topbar-title">Series</span>
        </div>
        {shelves.length === 0
          ? (loaded
              ? <StatePanel mode="empty" {...emptyContentProps("series")} />
              : <div className="tvl-center"><div className="tvl-spinner" /><p>Loading series…</p></div>)
          : (
            <VirtualShelvesTV
              shelves={shelves}
              onShelfVisible={handleShelfVisible}
              onLoadMore={handleLoadMore}
              onSelect={(item) => openDetail(item)}
              onSeeAll={(id, name) => openGrid({ id, name })}
              renderCard={(item, isFocused, cardW) => (
                <PosterCardWeb item={item} isFocused={isFocused} width={cardW} onPress={openDetail} />
              )}
              showHero={false}
              discoverItems={[{ id: "all_series", label: "All Series" }]}
              onPill={() => openGrid({ id: "all", name: "All Series" })}
              onUpAtTop={focusNav}
            />
          )}
      </div>
    );
  }

  // ── Category grid ─────────────────────────────────────────────────────────
  return (
    <div className="tvl-screen">
      <div className="tvl-topbar">
        <span className="tvl-topbar-title">Series</span>
      </div>
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
        {error ? (
          <StatePanel
            mode="error"
            title="Couldn't load series"
            message="Something went wrong fetching the series categories."
            onRetry={reload}
          />
        ) : (
          <div className="tvl-cat-grid">
            {visibleCats.map((cat, i) => (
              <button
                key={cat.id}
                ref={i === catFocus ? catElRef : null}
                className={
                  catZone === "grid" && i === catFocus
                    ? "tvl-cat-card tvl-cat-card--on"
                    : "tvl-cat-card"
                }
                onClick={() => openGrid(cat)}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}
        {!error && q && visibleCats.length <= 1 && (
          <div className="tvl-center"><p className="tvl-empty-msg">No categories match</p></div>
        )}
      </div>
    </div>
  );
}

