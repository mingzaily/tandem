import { useLayoutEffect, useState, type RefObject } from 'react';
import { composerMenuPosition } from './composerMenuPosition';

/** Input popovers share viewport positioning, including nested composer scrolling. */
export function useAnchoredPosition(open: boolean, root: RefObject<HTMLElement | null>, width: number, maxHeight: number, align: 'left' | 'right', side: 'above' | 'below', gap = 6, allowFlip = true) {
  const [position, setPosition] = useState<ReturnType<typeof composerMenuPosition>>();
  useLayoutEffect(() => {
    const anchor = root.current;
    if (!open || !anchor) return;
    const update = () => setPosition(composerMenuPosition(anchor.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, width, maxHeight, align, side, gap, allowFlip));
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [open, root, width, maxHeight, align, side, gap, allowFlip]);
  return position;
}
