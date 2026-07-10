import { memo, useState } from "react";
import { colors, focusRing, overlay, radii, fonts, fontWeights } from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";
import { formatEpisodeLabel } from "../../utils/formatEpisodeLabel";
import Icon from "../../ui/Icon";

/**
 * Continue-watching card — TV (raw DOM, no Tamagui). The 10-foot twin of the
 * web/Electron `CWCard` in HistoryScreen.web: a LANDSCAPE backdrop thumbnail
 * (16:9) with a corner-to-corner gradient, season badge, resume progress bar,
 * and a play glyph that appears on focus, with the title / episode / time-left
 * stacked below.
 *
 * Sized to the same cell WIDTH as the portrait poster shelf so the shared
 * VirtualShelvesTV horizontal windowing (fixed CARD_W/STRIDE) needs no changes;
 * only the row HEIGHT differs, which the screen supplies via rowHeightForShelf.
 *
 * Focus, like PosterCard.web, is an INNER cyan border on the thumbnail box (no
 * outer outline that the rail's overflow:hidden would crop, and no box-shadow —
 * old TV Chromium strips it).
 */
const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

const formatTimeLeft = (currentTime, duration) => {
  if (!duration || !currentTime) return null;
  const left = duration - currentTime;
  if (left <= 60) return null;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
};

const getEpLabel = (item) => {
  if (item.type === "series" && item.seasonNum && item.episodeNum)
    return formatEpisodeLabel(item.seasonNum, item.episodeNum);
  return null;
};

function ContinueCardTV({ item, onPress, isFocused, width = 340 }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const imgH = Math.round(width * (9 / 16));
  const bg = item.cover || item.movie_image || item.stream_icon || null;
  const progress =
    item.duration > 0
      ? Math.min((item.currentTime / item.duration) * 100, 100)
      : 0;
  const timeLeft = formatTimeLeft(item.currentTime, item.duration);
  const epLabel = getEpLabel(item);
  const seasonBadge = item.seasonNum ? `S${item.seasonNum}` : null;
  const showTitle = item.seriesName || item.name;
  const epTitle =
    item.seriesName && item.name !== item.seriesName ? item.name : null;

  return (
    <div
      className="suvo-poster-card"
      onClick={() => onPress?.(item)}
      role="button"
      tabIndex={0}
      aria-label={showTitle}
      data-tv-focused={isFocused ? "true" : undefined}
      style={{ width, cursor: "pointer", borderRadius: radii.md }}
    >
      <div
        style={{
          width,
          height: imgH,
          borderRadius: radii.card,
          backgroundColor: colors.surface,
          overflow: "hidden",
          position: "relative",
          boxSizing: "border-box",
          border: `${isFocused ? 3 : 1}px solid ${isFocused ? focusRing.color : colors.border}`,
        }}
      >
        {/* Always-present placeholder so a loading/empty card reads as a card. */}
        <div style={{ ...FILL, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
          <Icon name={item.type === "series" ? "tv" : "film"} color={colors.muted} size={ss(32)} />
        </div>
        {bg && !imageError && (
          <img
            src={bg}
            alt=""
            decoding="async"
            draggable={false}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
            ref={(n) => { if (n?.complete && n.naturalWidth > 0) setImageLoaded(true); }}
            style={{ ...FILL, width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: imageLoaded ? 1 : 0, transition: "opacity 180ms ease" }}
          />
        )}
        {/* Corner-to-corner scrim — matches the web CWCard gradient. */}
        <div
          style={{
            ...FILL,
            background:
              "linear-gradient(to top right, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.1) 60%, rgba(0,0,0,0) 100%)",
          }}
        />
        {seasonBadge && (
          <div style={{ position: "absolute", top: ss(10), left: ss(12), color: colors.text, fontFamily: fonts.display, fontSize: ss(14), fontWeight: fontWeights.bold }}>
            {seasonBadge}
          </div>
        )}
        {/* Play glyph appears on focus (the TV equivalent of the web hover). */}
        {isFocused && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: ss(48),
              height: ss(48),
              borderRadius: "50%",
              backgroundColor: overlay,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="play" size={ss(24)} color={colors.text} />
          </div>
        )}
        {progress > 0 && progress < 100 && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingLeft: ss(12), paddingRight: ss(12), paddingBottom: ss(10) }}>
            <div style={{ height: ss(3), borderRadius: ss(2), backgroundColor: colors.border, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress}%`, backgroundColor: colors.accent }} />
            </div>
          </div>
        )}
      </div>
      <div style={{ width, paddingTop: 10 }}>
        <div style={{ color: colors.text, fontFamily: fonts.body, fontSize: 13, fontWeight: fontWeights.medium, lineHeight: "17px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {showTitle}
        </div>
        {(epLabel || epTitle) && (
          <div style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {[epLabel, epTitle].filter(Boolean).join(" · ")}
          </div>
        )}
        {timeLeft && (
          <div style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, marginTop: 2 }}>
            {timeLeft}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ContinueCardTV);
