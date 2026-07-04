import { useState, useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";
import { useContentService } from "../domain/hooks/useContentService";
import { PagedGridTV } from "../presentation/components/PagedGrid.tv";
import StatePanel from "../ui/StatePanel";
import Icon from "../ui/Icon";
import { colors, iconSizes } from "../ui/tokens";
import { ss } from "../utils/scaleSize";
import { isMacCommand } from "../platform/adapters/input/keys";
import "../styles/tvl.css";
import "../styles/tvResponsiveScaling.css";
import "../styles/tvRemoteFocus.css";
import "./LiveTVScreen.tv.css";

const CAT_COLS = 4;
const CH_COLS = 6;
const CH_PAGE = 40;
// Grid gap (design px @ 1280 viewport): fewer/larger 6-col 16:9 channel tiles
// for 10-foot viewing.
const CH_GAP = 12;

const KEY_LEFT = 37;
const KEY_UP = 38;
const KEY_RIGHT = 39;
const KEY_DOWN = 40;
const KEY_ENTER = 13;
const KEY_BACK = new Set([27, 461, 10009, 8, 91]);

export default function LiveTVScreenTV({ navigation }) {
  const { contentService, activeUser, activeUserId } = useContentService();
  const { playVideo, currentVideo } = useApp();
  const currentVideoRef = useRef(null);
  useEffect(() => { currentVideoRef.current = currentVideo; }, [currentVideo]);

  const [loading, setLoading] = useState(false);
  const [cats, setCats] = useState([]);
  const [catFocus, setCatFocus] = useState(0);
  const [page, setPage] = useState(null);
  const [query, setQuery] = useState("");
  const [catZone, setCatZone] = useState("grid");
  const [gridQuery, setGridQuery] = useState("");
  const [gridZone, setGridZone] = useState("grid");

  const catsRef = useRef([]);
  const catFocusRef = useRef(0);
  const pageRef = useRef(null);
  const allItemsRef = useRef(new Map());
  const catElRef = useRef(null);
  const navActiveRef = useRef(false);
  // State mirror of navActiveRef so search/zone highlights re-render (and clear)
  // the moment the remote hands focus up to the global navbar.
  const [navActive, setNavActive] = useState(false);
  const catZoneRef = useRef("grid");
  const searchInputRef = useRef(null);
  const gridZoneRef = useRef("grid");
  const gridQueryRef = useRef("");
  const gridSearchInputRef = useRef(null);

  const focusNav = () => {
    navActiveRef.current = true;
    setNavActive(true);
    globalThis.dispatchEvent(new CustomEvent("tv-nav-focus"));
  };

  // Category cards filtered by the search query.
  const q = query.trim().toLowerCase();
  const visibleCats = q
    ? cats.filter((c) => c.name?.toLowerCase().includes(q))
    : cats;

  useEffect(() => {
    catsRef.current = visibleCats;
  }, [visibleCats]);
  // Keep category focus in range whenever the filtered list shrinks.
  useEffect(() => {
    if (catFocusRef.current > visibleCats.length - 1) { catFocusRef.current = 0; setCatFocus(0); }
  }, [visibleCats.length]);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  // ── Grid-view text search ─────────────────────────────────────────────────
  const gq = gridQuery.trim().toLowerCase();
  const getFilteredChannels = (items) => {
    const query = gridQueryRef.current;
    if (!items || !query) return items || [];
    return items.filter((c) => c.name?.toLowerCase().includes(query));
  };
  useEffect(() => { gridQueryRef.current = gq; }, [gq]);
  useEffect(() => { gridZoneRef.current = gridZone; }, [gridZone]);
  // Reset grid focus to top whenever the filtered set changes.
  const onGridQueryChange = (val) => {
    setGridQuery(val);
    gridQueryRef.current = val.trim().toLowerCase();
    const pg = pageRef.current;
    if (pg) { const n = { ...pg, focus: 0, display: CH_PAGE }; pageRef.current = n; setPage(n); }
  };

  useEffect(() => {
    if (activeUserId) loadCats();
  }, [activeUserId]);

  const loadCats = async () => {
    if (!activeUser) return;
    setLoading(true);
    allItemsRef.current.clear();
    try {
      const list = await contentService.getLiveCategories();
      if (!list?.length) return;
      setCats(list);
      catsRef.current = list;
    } catch (e) {
      console.error("LiveTVScreenTV:", e);
    } finally {
      setLoading(false);
    }
  };

  const openCat = async (cat) => {
    const next = {
      catId: cat.id,
      name: cat.name,
      items: null,
      display: CH_PAGE,
      focus: 0,
    };
    setPage(next);
    pageRef.current = next;
    try {
      let all = allItemsRef.current.get(cat.id);
      if (!all) {
        all = await contentService.getLiveChannels(cat.id);
        allItemsRef.current.set(cat.id, all);
      }
      const updated = { ...next, items: all };
      setPage(updated);
      pageRef.current = updated;
    } catch {
      const updated = { ...next, items: [] };
      setPage(updated);
      pageRef.current = updated;
    }
  };

  const closePage = () => {
    setPage(null);
    pageRef.current = null;
    setGridZoneBoth("grid");
    setGridQuery("");
    gridQueryRef.current = "";
  };

  const play = (item) => {
    const url = contentService.buildLiveUrl(item.stream_id, item.container_extension || "ts");
    playVideo({
      type: "live",
      streamId: item.stream_id,
      name: item.name,
      url,
      cover: item.stream_icon || null,
      startTime: 0,
    });
    navigation.navigate("VideoPlayer");
  };

  useEffect(() => {
    const onKey = (e) => {
      if (isMacCommand(e)) return; // ⌘ shares keyCode 91 with Back in the sim
      const k = e.keyCode || e.which;
      if (navActiveRef.current) return;
      if (currentVideoRef.current) return;
      if (pageRef.current) handleChKey(k, e);
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
  }, []);

  // ── Category grid keys ────────────────────────────────────────────────────
  const setCatZoneBoth = (z) => { catZoneRef.current = z; setCatZone(z); };
  const movCat = (n) => {
    catFocusRef.current = n;
    setCatFocus(n);
  };
  const onCatLeft = () => {
    const f = catFocusRef.current;
    if (f > 0) movCat(f - 1);
  };
  const onCatRight = () => {
    const f = catFocusRef.current;
    const max = catsRef.current.length - 1;
    if (f < max) movCat(f + 1);
  };
  const onCatUp = () => {
    const f = catFocusRef.current;
    if (f >= CAT_COLS) movCat(f - CAT_COLS);
    else setCatZoneBoth("search");
  };
  const onCatDown = () => {
    const f = catFocusRef.current;
    movCat(Math.min(f + CAT_COLS, catsRef.current.length - 1));
  };
  const onCatEnter = () => {
    const cat = catsRef.current[catFocusRef.current];
    if (cat) openCat(cat);
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
    if (KEY_BACK.has(k)) { navigation.goBack?.(); return; }
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

  // ── Channel grid keys ─────────────────────────────────────────────────────
  // The grid grows on scroll (PagedGridTV), so focus may roam the whole
  // filtered list — bounds use the full length, not a display cap.
  const movCh = (pg, focus) => {
    const n = { ...pg, focus };
    pageRef.current = n;
    setPage(n);
  };
  const growChDisplay = (next) => { const pg = pageRef.current; if (pg) { const n = { ...pg, display: next }; pageRef.current = n; setPage(n); } };

  const onChLeft = (pg) => {
    if (pg.focus > 0) movCh(pg, pg.focus - 1);
  };
  const onChRight = (pg) => {
    const max = getFilteredChannels(pg.items).length - 1;
    if (pg.focus >= max) return;
    movCh(pg, pg.focus + 1);
  };
  const onChUp = (pg) => {
    if (pg.focus >= CH_COLS) movCh(pg, pg.focus - CH_COLS);
    else setGridZoneBoth("search");
  };
  const onChDown = (pg) => {
    const max = getFilteredChannels(pg.items).length - 1;
    const next = Math.min(pg.focus + CH_COLS, max);
    movCh(pg, next);
  };
  const onChEnter = (pg) => {
    const item = getFilteredChannels(pg.items)[pg.focus];
    if (item) play(item);
  };

  // Grid search-bar zone (above the channel grid).
  const setGridZoneBoth = (z) => { gridZoneRef.current = z; setGridZone(z); };
  const gridInputFocused = () => document.activeElement === gridSearchInputRef.current;
  const handleGridSearchKey = (k) => {
    switch (k) {
      case KEY_UP: setGridZoneBoth("back"); break;
      case KEY_DOWN: setGridZoneBoth("grid"); break;
      case KEY_ENTER: gridSearchInputRef.current?.focus(); break;
    }
  };

  // Topbar back-icon zone (above the search bar, below the global navbar).
  const handleGridBackKey = (k) => {
    switch (k) {
      case KEY_UP: focusNav(); break;
      case KEY_DOWN: setGridZoneBoth("search"); break;
      case KEY_ENTER: closePage(); break;
    }
  };

  const handleChKey = (k, e) => {
    const pg = pageRef.current;
    // While the grid search input has focus, let typing/cursor work; only Back acts.
    if (gridInputFocused()) {
      if (KEY_BACK.has(k)) {
        e.preventDefault();
        gridSearchInputRef.current?.blur();
        setGridZoneBoth("search");
      }
      return;
    }
    e.preventDefault();
    if (KEY_BACK.has(k)) {
      if (gridZoneRef.current === "search") { setGridZoneBoth("grid"); return; }
      closePage();
      return;
    }
    if (gridZoneRef.current === "back") { handleGridBackKey(k); return; }
    if (gridZoneRef.current === "search") { handleGridSearchKey(k); return; }
    if (!pg?.items) return;
    switch (k) {
      case KEY_LEFT:
        onChLeft(pg);
        break;
      case KEY_RIGHT:
        onChRight(pg);
        break;
      case KEY_UP:
        onChUp(pg);
        break;
      case KEY_DOWN:
        onChDown(pg);
        break;
      case KEY_ENTER:
        onChEnter(pg);
        break;
    }
  };

  useEffect(() => {
    catElRef.current?.scrollIntoView({ block: "nearest" });
  }, [catFocus]);
  // Channel-grid focus scrolling is handled inside PagedGridTV (focusIndex).

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="tvl-screen">
        <StatePanel mode="loading" title="Loading channels…" />
      </div>
    );
  }
  if (!activeUserId) {
    return (
      <div className="tvl-screen">
        <StatePanel
          mode="empty"
          icon="tv"
          title="No IPTV Account"
          message='Open "Accounts" to add your IPTV service'
          cta={() => navigation.navigate("Accounts")}
          ctaLabel="Add Account"
        />
      </div>
    );
  }

  if (page) {
    const filteredItems = page.items ? getFilteredChannels(page.items) : null;
    return (
      <div className="tvl-screen">
        <div className="tvl-topbar">
          <button className={gridZone === "back" ? "tvl-topbar-back tvl-topbar-back--focused" : "tvl-topbar-back"} onClick={closePage} aria-label="Back">
            <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
              <Icon name="chevron-right" size={ss(iconSizes.md)} color={colors.text} />
            </span>
          </button>
          <button
            className="tvl-topbar-title tvl-topbar-title--back"
            onClick={closePage}
          >
            {page.name}
          </button>
          {filteredItems && (
            <span className="tvl-topbar-count">
              {filteredItems.length.toLocaleString()}
            </span>
          )}
        </div>
        <div className={gridZone === "search" ? "tvl-cat-search tvl-cat-search--on" : "tvl-cat-search"}>
          <span className="tvl-cat-search-icon"><Icon name="search" size={ss(iconSizes.md)} color="currentColor" /></span>
          <input
            ref={gridSearchInputRef}
            className="tvl-cat-search-input"
            type="text"
            dir="auto"
            autoComplete="off"
            placeholder="Search channels…"
            value={gridQuery}
            onChange={(e) => onGridQueryChange(e.target.value)}
          />
        </div>
        {!filteredItems && (
          <div className="tvl-center">
            <div className="tvl-spinner" />
            <p>Loading…</p>
          </div>
        )}
        {filteredItems?.length === 0 && (
          <div className="tvl-center"><p className="tvl-empty-msg">No results</p></div>
        )}
        {filteredItems && filteredItems.length > 0 && (
          <div className="tvl-ch-grid-window">
            <PagedGridTV
              items={filteredItems}
              cols={CH_COLS}
              gap={CH_GAP}
              focusIndex={page.focus}
              pageSize={CH_PAGE}
              display={page.display}
              onGrow={growChDisplay}
              className="tvl-ch-vgrid"
              renderItem={(item, i) => (
                <ChannelCard
                  key={String(item.stream_id)}
                  item={item}
                  isFocused={i === page.focus}
                />
              )}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tvl-screen">
      <div className="tvl-topbar">
        <span className="tvl-topbar-title">Live TV</span>
      </div>
      <div className="tvl-scroll">
        <div className={catZone === "search" && !navActive ? "tvl-cat-search tvl-cat-search--on" : "tvl-cat-search"}>
          <span className="tvl-cat-search-icon"><Icon name="search" size={ss(iconSizes.md)} color="currentColor" /></span>
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
          {visibleCats.map((cat, i) => (
            <div
              key={cat.id}
              ref={i === catFocus ? catElRef : null}
              className={
                catZone === "grid" && i === catFocus
                  ? "tvl-cat-card tvl-cat-card--on"
                  : "tvl-cat-card"
              }
              onClick={() => openCat(cat)}
            >
              {cat.name}
            </div>
          ))}
        </div>
        {q && visibleCats.length === 0 && (
          <div className="tvl-center"><p className="tvl-empty-msg">No categories match</p></div>
        )}
      </div>
    </div>
  );
}

function ChannelCard({ item, isFocused }) {
  const [err, setErr] = useState(false);
  const src = item.stream_icon || null;
  return (
    <div
      className={isFocused ? "tvl-ch-card tvl-ch-card--on" : "tvl-ch-card"}
    >
      <div className="tvl-ch-logo">
        {src && !err ? (
          <img src={src} alt="" onError={() => setErr(true)} loading="lazy" decoding="async" />
        ) : (
          <div className="tvl-ch-ph">
            <Icon name="tv" size={ss(iconSizes.lg)} color={colors.border} />
          </div>
        )}
        <span className="tvl-ch-live">LIVE</span>
      </div>
      <div className="tvl-ch-name">{item.name}</div>
    </div>
  );
}
