import type { ReactNode } from 'react';

/** Lightweight header tips follow the reference's compact bottom placement. */
export function Tip({ text, children }: { text: string; children: ReactNode }) {
  return <span className="group/tip relative inline-flex shrink-0">
    {children}
    <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-50 mt-1 hidden whitespace-nowrap rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 py-1 text-12 font-normal text-[var(--text-primary)] shadow-[shadow:var(--shadow-menu)] group-hover/tip:block group-focus-within/tip:block">{text}</span>
  </span>;
}
