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
import { useRef, useState, useCallback } from "react";
import { useWatchHistory } from "../context/AppContext";
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
 * @param {Object|null} currentVideo - The video about to play (usePlayback().currentVideo shape).
 * @returns {import('./resumeDecision.js').ResumeDecision & {
 *   decided: boolean,
 *   choice: ('resume'|'startOver'|null),
 *   decide: (choice: 'resume'|'startOver') => number,
 * }}
 *   `decide(choice)` records the user's choice and returns the start time in
 *   seconds the player should pass as `startTime` to useResilientPlayback.
 */
export function useResumePosition(currentVideo) {
  const { watchHistory } = useWatchHistory();
  const [choice, setChoice] = useState(/** @type {'resume'|'startOver'|null} */ (null));

  const isLive = currentVideo?.type === "live";
  const key = currentVideo?.url ?? null;

  // Freeze the resume decision at the moment the source opens. `watchHistory` is
  // rewritten on every progress tick WHILE THIS VIDEO PLAYS, so recomputing it
  // live would let hasResume flip true from the current session's own writes and
  // re-pop the "Resume?" prompt mid-playback (and, on native, unload the source;
  // on TV, seek backward). Snapshotting per-source keeps the affordance tied to
  // the position that existed BEFORE this session started. Resolves on all
  // platforms since they all consume this hook.
  const snapRef = useRef(
    /** @type {{ key: string|null|undefined, decision: import('./resumeDecision.js').ResumeDecision }} */ ({
      key: undefined,
      decision: { hasResume: false, resumeTime: 0, duration: 0, percent: 0 },
    }),
  );
  // Reset the user's choice when the source changes (adjusting state during
  // render — the supported React pattern via a tracked previous value).
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setChoice(null);
  }
  if (snapRef.current.key !== key) {
    const entry = findHistoryEntry(watchHistory, currentVideo);
    snapRef.current = { key, decision: decideResume(entry, { isLive }) };
  }
  const decision = snapRef.current.decision;

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
