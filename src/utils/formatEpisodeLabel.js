/** Compact episode label like `S2 · E05` — season unpadded, episode 2-digit.
 * Shared by the Continue Watching / History cards so the three variants can't
 * drift. Padding matches the long-standing card format. */
export function formatEpisodeLabel(seasonNum, episodeNum) {
  return `S${seasonNum} · E${String(episodeNum).padStart(2, "0")}`;
}
