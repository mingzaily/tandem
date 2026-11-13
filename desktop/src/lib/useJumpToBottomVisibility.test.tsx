// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useJumpToBottomVisibility } from './useJumpToBottomVisibility';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => vi.useRealTimers());

describe('Cindy jump-to-bottom visibility', () => {
  it('appears only while moving down in history, dismisses after two seconds and cleans up', async () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const root = createRoot(host);
    let jump!: ReturnType<typeof useJumpToBottomVisibility>;
    function Component() { jump = useJumpToBottomVisibility(); return <span>{String(jump.visible)}</span>; }
    await act(async () => root.render(<Component />));
    expect(jump.visible).toBe(false);
    await act(async () => jump.onScroll(-10, false)); expect(jump.visible).toBe(false);
    await act(async () => jump.onScroll(20, false)); expect(jump.visible).toBe(true);
    await act(async () => vi.advanceTimersByTime(1999)); expect(jump.visible).toBe(true);
    await act(async () => vi.advanceTimersByTime(1)); expect(jump.visible).toBe(false);
    await act(async () => jump.onScroll(20, false));
    await act(async () => jump.onScroll(-2, false)); expect(jump.visible).toBe(false);
    await act(async () => jump.onScroll(20, false));
    await act(async () => jump.onScroll(5, true)); expect(jump.visible).toBe(false);
    await act(async () => jump.onScroll(20, false));
    await act(async () => root.unmount()); expect(vi.getTimerCount()).toBe(0);
  });
});
