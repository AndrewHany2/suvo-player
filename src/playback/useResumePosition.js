// @ts-check
/**
 * Resume-position resolution for VOD playback.
 *
 * Reads the persisted watch history (via useApp) and decides whether the player
 * should offer a "resume from where you left off" prompt for the current video.
 *
 * The decision logic lives in the PURE `./resumeDecision.js` module so it can be
 * unit-tested with `node --test` without React or AsyncStorage. This hook is a
 * thin wrapper that locates the matching history entry and exposes the resume
 * affordance to the player. The pure helpers are re-exported for convenience.
 */
import { useMemo, useState, useCallback } from "react";
import { useApp } from "../context/AppContext";
import { decideResume, resolveChoice, findHistoryEntry } from "./resumeDecision.js";

export {
  decideResume,
  resolveChoice,
  findHistoryEntry,
  RESUME_MIN_SECONDS,
  RESUME_MAX_PERCENT,
} from "./resumeDecision.js";

/**
 * Hook: resolve resume state for the given video against persisted history.
 *
 * @param {Object|null} currentVideo - The video about to play (useApp().currentVideo shape).
 * @returns {import('./resumeDecision.js').ResumeDecision & {
 *   decided: boolean,
 *   choice: ('resume'|'startOver'|null),
 *   decide: (choice: 'resume'|'startOver') => number,
 * }}
 *   `decide(choice)` records the user's choice and returns the start time in
 *   seconds the player should pass as `startTime` to useResilientPlayback.
 */
export function useResumePosition(currentVideo) {
  const { watchHistory } = useApp();
  const [choice, setChoice] = useState(/** @type {'resume'|'startOver'|null} */ (null));

  const isLive = currentVideo?.type === "live";

  const decision = useMemo(() => {
    const entry = findHistoryEntry(watchHistory, currentVideo);
    return decideResume(entry, { isLive });
  }, [watchHistory, currentVideo, isLive]);

  const decide = useCallback(
    (next) => {
      setChoice(next);
      return resolveChoice(next, decision.resumeTime);
    },
    [decision.resumeTime],
  );

  return {
    hasResume: decision.hasResume,
    resumeTime: decision.resumeTime,
    duration: decision.duration,
    percent: decision.percent,
    decided: choice !== null,
    choice,
    decide,
  };
}

export default useResumePosition;
