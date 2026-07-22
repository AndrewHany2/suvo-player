import { useState, useRef, useCallback, useEffect } from "react";

/**
 * Deferred, undoable removal — shared by the web and native Home screens.
 *
 * A remove doesn't hit the store immediately: with cross-device sync a mis-tap
 * would delete a resume position (or a My-List entry) on every device. Instead
 * the caller optimistically hides the item, shows a "Removed · Undo" affordance,
 * and only commits once the timer elapses (~5s). Undo cancels the pending commit
 * and the item reappears untouched. A second removal while one is pending commits
 * the first immediately; unmount honors an in-flight removal rather than dropping
 * it.
 *
 * Framework-agnostic (no DOM / RN imports) so both platforms share one source of
 * truth for the semantics; each renders its own snackbar UI.
 *
 * @param {(payload:any)=>void} commit - performs the real store removal.
 * @param {number} delay - ms before the pending removal commits (default 5000).
 * @returns {{ pending:any, requestRemove:(payload:any)=>void, undoRemove:()=>void }}
 */
export function useDeferredRemove(commit, delay = 5000) {
  const [pending, setPending] = useState(null);
  const pendingRef = useRef(null);
  const timerRef = useRef(null);

  // Keep the latest commit reachable from the unmount-only effect without making
  // that effect re-run every render.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const doCommit = (p) => {
    if (p) commitRef.current(p);
  };

  const requestRemove = useCallback(
    (payload) => {
      clearTimer();
      // Never lose a still-pending removal if a second one starts — commit it now.
      if (pendingRef.current) doCommit(pendingRef.current);
      pendingRef.current = payload;
      setPending(payload);
      timerRef.current = setTimeout(() => {
        doCommit(pendingRef.current);
        pendingRef.current = null;
        timerRef.current = null;
        setPending(null);
      }, delay);
    },
    [delay],
  );

  const undoRemove = useCallback(() => {
    clearTimer();
    pendingRef.current = null;
    setPending(null);
  }, []);

  // On unmount, honor an in-flight removal (the user did request it).
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      doCommit(pendingRef.current);
      pendingRef.current = null;
    },
    [],
  );

  return { pending, requestRemove, undoRemove };
}

export default useDeferredRemove;
