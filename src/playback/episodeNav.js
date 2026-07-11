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

/**
 * Build the playVideo() payload for advancing to `next` (a findNextEpisode
 * result), shared by the web and native players so the next-episode video object
 * — its id/name/season formatting — can't drift between them.
 *
 * `buildUrl` is injected — `(episodeId, containerExtension) => string`, e.g.
 * `(id, ext) => contentService.buildEpisodeUrl(id, ext)` — so this module stays
 * pure (no ContentService import) and unit-testable.
 *
 * @param {{ episode: {id:any, episode_num:any, container_extension?:string}, seasonNum: string }|null} next
 * @param {{ seriesId?:any, seriesName?:string, seriesSeasons?:object }|null} currentVideo
 * @param {(episodeId:any, containerExtension:string) => string} buildUrl
 * @returns {object|null} the playVideo payload, or null when there's nothing to advance to
 */
export function buildNextEpisodeVideo(next, currentVideo, buildUrl) {
  if (!next || !currentVideo) return null;
  const { episode, seasonNum } = next;
  const url = buildUrl(episode.id, episode.container_extension || "mp4");
  const ep = String(episode.episode_num).padStart(2, "0");
  const sn = String(seasonNum).padStart(2, "0");
  return {
    type: "series",
    streamId: String(episode.id),
    seriesId: currentVideo.seriesId,
    seriesName: currentVideo.seriesName,
    name: `${currentVideo.seriesName} - S${sn}E${ep}`,
    url,
    seasonNum,
    episodeNum: episode.episode_num,
    seriesSeasons: currentVideo.seriesSeasons,
  };
}
