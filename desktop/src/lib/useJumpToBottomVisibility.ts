import { useCallback, useEffect, useRef, useState } from 'react';

/** Cindy's downward-in-history affordance: idle, upward movement and the tail all dismiss it. */
export function useJumpToBottomVisibility() {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setVisible(false);
  }, []);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const onScroll = useCallback((delta: number, nearBottom: boolean) => {
    if (nearBottom || delta < -1) clear();
    else if (delta > 1) {
      setVisible(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(clear, 2000);
    }
  }, [clear]);
  return { visible, clear, onScroll };
}
