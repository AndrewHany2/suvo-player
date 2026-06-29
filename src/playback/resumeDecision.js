// @ts-check
/**
 * PURE resume-decision logic — no React, no AsyncStorage, no engine imports.
 *
 * Split out from useResumePosition.js so it can be unit-tested with bare
 * `node --test` (the hook itself imports React + AppContext, which can't be
 * resolved outside the bundler). The hook re-exports these for convenience.
 */

/** Below this many seconds we treat playback as "barely started" — start over. */
export const RESUME_MIN_SECONDS = 10;
/** At/above this fraction watched we treat the title as "finished" — start over. */
export const RESUME_MAX_PERCENT = 0.95;

/**
 * @typedef {Object} ResumeDecision
 * @property {boolean} hasResume  - Whether a resume prompt should be offered.
 * @property {number}  resumeTime - Saved position in seconds (0 when no resume).
 * @property {number}  duration   - Saved duration in seconds (0 when unknown).
 * @property {number}  percent    - Fraction watched in [0,1] (0 when unknown).
 */

/**
 * PURE: decide whether a saved position warrants offering resume.
 *
 * A resume is offered only for VOD (non-live) entries whose saved `currentTime`
 * is past the `minSeconds` floor and before the `maxPercent` ceiling of a known
 * duration. When duration is unknown (0), the percent ceiling can't be checked,
 * so we still offer resume as long as the floor is cleared.
 *
 * @param {Object|null|undefined} entry - History entry ({ currentTime, duration, type }) or null.
 * @param {Object} [opts]
 * @param {boolean} [opts.isLive=false]   - Live streams never resume.
 * @param {number}  [opts.minSeconds=RESUME_MIN_SECONDS]
 * @param {number}  [opts.maxPercent=RESUME_MAX_PERCENT]
 * @returns {ResumeDecision}
 */
export function decideResume(entry, opts = {}) {
  const {
    isLive = false,
    minSeconds = RESUME_MIN_SECONDS,
    maxPercent = RESUME_MAX_PERCENT,
  } = opts;

  const none = { hasResume: false, resumeTime: 0, duration: 0, percent: 0 };
  if (isLive || !entry) return none;

  const resumeTime = Number(entry.currentTime) || 0;
  const duration = Number(entry.duration) || 0;
  const percent = duration > 0 ? resumeTime / duration : 0;

  if (resumeTime <= minSeconds) return { ...none, resumeTime, duration, percent };
  if (duration > 0 && percent >= maxPercent) return { ...none, resumeTime, duration, percent };

  return { hasResume: true, resumeTime, duration, percent };
}

/**
 * PURE: resolve a 'resume' | 'startOver' choice to a start time in seconds.
 *
 * @param {'resume'|'startOver'} choice
 * @param {number} resumeTime - Saved position to use when resuming.
 * @returns {number} Seconds to seek to before playback.
 */
export function resolveChoice(choice, resumeTime) {
  return choice === "resume" ? (Number(resumeTime) || 0) : 0;
}

/**
 * PURE: find the history entry matching a video.
 *
 * Mirrors AppContext normalization: `type` 'movie' is stored as 'movies', and
 * matching is by (normalized type, streamId).
 *
 * @param {Array<Object>} watchHistory
 * @param {Object|null|undefined} video - { type, streamId } shape.
 * @returns {Object|undefined}
 */
export function findHistoryEntry(watchHistory, video) {
  if (!video || !Array.isArray(watchHistory)) return undefined;
  const type = video.type === "movie" ? "movies" : video.type;
  const streamId = video.streamId ?? video.stream_id ?? video.id;
  if (streamId == null) return undefined;
  return watchHistory.find(
    (h) => h.type === type && (h.streamId === streamId || String(h.streamId) === String(streamId)),
  );
}
