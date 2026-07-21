import { useState } from "react";
import Icon from "../../ui/Icon";
import { colors, iconSizes } from "../../ui/tokens";
import { posterUrl } from "../../utils/imagePrefetch";

/**
 * Shared TV poster card for horizontal shelves — History/"Home", Movies, Series.
 *
 * One card serves all three shelves: the rating badge shows only when the item
 * carries a rating (catalog items) and the resume-progress bar only when it
 * carries watch progress (history items). Each hides when its field is absent,
 * so a catalog poster looks like the Movies grid card and a history poster looks
 * like the Home card, from the same component.
 *
 * `elRef` is forwarded to the card root so History's hand-rolled rail can scroll
 * the focused card into view. The Movies/Series shelves render through
 * VirtualShelvesTV, which holds the focus ref on the wrapping cell instead, so
 * they omit `elRef`.
 */
export default function ShelfCard({ item, isFocused, elRef, className = "" }) {
  const [err, setErr] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = posterUrl(item);
  const rating = item.tmdb_rating ?? item.rating;
  const rLabel =
    rating != null && rating !== ""
      ? typeof rating === "number"
        ? Math.round(rating)
        : rating
      : null;
  const duration = item.duration || 0;
  const pct =
    duration > 0 ? Math.min((item.currentTime / duration) * 100, 100) : 0;
  const isSeries =
    item.type === "series" || item.series_id != null || item.seriesId != null;

  return (
    <div
      ref={elRef}
      role="button"
      aria-label={item.name}
      className={["tvl-card", isFocused && "tvl-card--on", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="tvl-card-img">
        {src && !err ? (
          <img
            src={src}
            alt=""
            className={loaded ? "loaded" : undefined}
            onLoad={() => setLoaded(true)}
            onError={() => setErr(true)}
            // Prefetched posters may already be decoded before React binds
            // onLoad — mark them loaded on mount so they don't stay faded out.
            ref={(n) => { if (n?.complete && n.naturalWidth > 0) setLoaded(true); }}
            decoding="async"
          />
        ) : (
          <div className="tvl-card-ph">
            <Icon
              name={isSeries ? "tv" : "film"}
              size={iconSizes.lg}
              color={colors.border}
            />
          </div>
        )}
        {rLabel && <span className="tvl-card-rating">{rLabel}</span>}
        {pct > 0 && pct < 100 && (
          <div className="tvl-hist-bar" style={{ width: `${pct}%` }} />
        )}
      </div>
      <div className="tvl-card-title">{item.name}</div>
    </div>
  );
}
