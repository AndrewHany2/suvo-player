import { useCallback, useRef, useState } from "react";

/**
 * Shared "back to top" visibility logic for the browse lists (Movies / Series /
 * Live / History) on web + native. The scroll containers differ per platform
 * (web ScrollView div, native FlatList / ScrollView), but all emit the same RN
 * scroll event shape — `nativeEvent.contentOffset.y` — so one handler serves
 * every screen.
 *
 * The caller owns the scroll ref and the actual scroll-to-top call (FlatList
 * `scrollToOffset`, ScrollView `scrollTo`); this hook only decides whether the
 * floating button should show. It flips state ONLY when crossing the threshold,
 * so a fast scroll doesn't re-render the screen on every frame — just once when
 * the button appears and once when it disappears.
 *
 * @param {number} [threshold] pixels scrolled before the button appears.
 * @returns {{ showButton: boolean, onScroll: (e: any) => void }}
 */
export function useScrollToTop(threshold = 800) {
  const [showButton, setShowButton] = useState(false);
  const shownRef = useRef(false);

  const onScroll = useCallback(
    (e) => {
      const y = e?.nativeEvent?.contentOffset?.y ?? 0;
      const next = y > threshold;
      if (next !== shownRef.current) {
        shownRef.current = next;
        setShowButton(next);
      }
    },
    [threshold],
  );

  return { showButton, onScroll };
}
