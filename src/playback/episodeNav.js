/**
 * Pure next-episode lookup, shared by the web and native players so the
 * auto-advance / "next episode" logic can't drift between them.
 *
 * Flattens the series' seasons into a single playback order and returns the
 * episode that comes AFTER the currently-playing one:
 *  - seasons are ordered NUMERICALLY (1, 2, 10 — not the string order 1, 10, 2),
 *  - episodes within a season by `episode_num` numerically,
 *  - each returned episode carries a string `seasonNum`.
 *
 * Returns null when there is no series context (no currentVideo, not a series,
 * or no seriesSeasons), when the current episode can't be found in the list, or
 * when the current episode is the last one — i.e. every "nothing to advance to"
 * case collapses to null.
 *
 * @param {{ type?: string, seriesSeasons?: Record<string, Array<{id:any, episode_num:any}>>, streamId?: string|number } | null|undefined} currentVideo
 * @returns {{ episode: object, seasonNum: string } | null}
 */
export function findNextEpisode(currentVideo) {
  if (!currentVideo || currentVideo.type !== "series" || !currentVideo.seriesSeasons) return null;
  const all = Object.keys(currentVideo.seriesSeasons)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap((s) =>
      [...(currentVideo.seriesSeasons[String(s)] || [])]
        .sort((a, b) => Number(a.episode_num) - Number(b.episode_num))
        .map((ep) => ({ ...ep, seasonNum: String(s) })),
    );
  const idx = all.findIndex((ep) => String(ep.id) === String(currentVideo.streamId));
  if (idx < 0 || idx >= all.length - 1) return null;
  const next = all[idx + 1];
  return { episode: next, seasonNum: next.seasonNum };
}
