import type { ReactNode } from 'react';

/** Header tips use the same one-second delay and viewport positioning as every other control. */
export function Tip({ text, children }: { text: string; children: ReactNode }) {
  return <span data-tooltip={text} className="relative inline-flex shrink-0">{children}</span>;
}
