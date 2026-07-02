/**
 * Hero — cinematic featured banner, web/desktop AND webOS TV (raw DOM).
 *
 * Full-bleed backdrop art under a left→transparent gradient scrim so the title
 * stays legible, with a bottom-left content block (eyebrow / title / meta /
 * actions). Same prop API as Hero.native.
 *
 * webOS TV (globalThis.__TV__ === true): NO animation, NO box-shadow, NO var().
 * We gate the image fade-in (the only transition here) on !isTV(); everything
 * else is static literal styling so old webOS Chromium has nothing it can't do.
 * Button owns its own focus ring/glow (and is already TV-aware), so the `focused`
 * prop just drives the primary Button's isFocused.
 *
 * Sizing flows through ss() so the hero scales on TV/web.
 */
import { memo, useState } from "react";
import {
  colors, scrim, radii, fonts, fontWeights, heroHeights, iconSizes,
} from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";
import Icon from "../../ui/Icon";
import Button from "../../ui/Button";

import { isTV } from "../../utils/isTV";

function resolveBackdrop(item) {
  if (!item) return null;
  const src = item.backdrop_path || item.cover || item.movie_image || item.stream_icon;
  return typeof src === "string" && src.trim() !== "" ? src : null;
}

function metaParts(item) {
  if (!item) return [];
  const parts = [];
  const year = item.year || item.releaseDate || item.release_date;
  if (year) parts.push(String(year).slice(0, 4));
  const genre = item.genre || item.category_name;
  if (genre) parts.push(String(genre));
  return parts;
}

function HeroWeb({ item, onPlay, onDetails, focused = false }) {
  const tv = isTV();
  const [loaded, setLoaded] = useState(false);

  const backdrop = resolveBackdrop(item);
  const title = item?.name || item?.title || "";
  const parts = metaParts(item);
  const ratingValue = item?.tmdb_rating ?? item?.rating;
  const ratingLabel =
    ratingValue != null && ratingValue !== ""
      ? typeof ratingValue === "number"
        ? ratingValue.toFixed(1)
        : ratingValue
      : null;

  const height = ss(tv ? heroHeights.tv : heroHeights.web);
  const pad = ss(40);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        overflow: "hidden",
        borderRadius: tv ? 0 : radii.lg,
        // Tokenized gradient placeholder when there's no art to show.
        backgroundColor: colors.surface,
        backgroundImage: backdrop ? undefined : scrim.css,
      }}
    >
      {backdrop ? (
        <img
          src={backdrop}
          alt={title}
          draggable={false}
          onLoad={() => setLoaded(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
            // Fade in on load — web only; TV shows it instantly (no transition).
            opacity: tv || loaded ? 1 : 0,
            transition: tv ? undefined : "opacity 0.4s ease",
            WebkitUserDrag: "none",
            userSelect: "none",
          }}
        />
      ) : null}

      {/* Left→transparent scrim so the content stays legible over art. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: scrim.css,
        }}
      />

      {/* Bottom-left content block. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: pad,
          display: "flex",
          flexDirection: "column",
          gap: ss(12),
          maxWidth: "60%",
        }}
      >
        <span
          style={{
            fontFamily: fonts.display,
            fontSize: ss(13),
            fontWeight: fontWeights.medium,
            letterSpacing: ss(3),
            textTransform: "uppercase",
            color: colors.muted,
          }}
        >
          Featured
        </span>

        <h2
          style={{
            margin: 0,
            fontFamily: fonts.display,
            fontWeight: fontWeights.bold,
            fontSize: ss(tv ? 52 : 40),
            lineHeight: 1.1,
            color: colors.text,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title}
        </h2>

        {(parts.length > 0 || ratingLabel) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: ss(10),
              color: colors.muted,
              fontFamily: fonts.body,
              fontSize: ss(15),
            }}
          >
            {parts.map((p, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: ss(10) }}>
                {i > 0 ? <span style={{ color: colors.faint }}>·</span> : null}
                <span>{p}</span>
              </span>
            ))}
            {ratingLabel ? (
              <span style={{ display: "flex", alignItems: "center", gap: ss(4) }}>
                {parts.length > 0 ? <span style={{ color: colors.faint }}>·</span> : null}
                <Icon name="star" size={ss(iconSizes.sm)} color={colors.rating} />
                <span style={{ color: colors.text }}>{ratingLabel}</span>
              </span>
            ) : null}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "row", gap: ss(12), marginTop: ss(8) }}>
          <Button variant="primary" size="lg" icon="play" onPress={onPlay} isFocused={focused}>
            Play
          </Button>
          <Button variant="secondary" size="lg" icon="plus" onPress={onDetails}>
            Details
          </Button>
        </div>
      </div>
    </div>
  );
}

export default memo(HeroWeb);
