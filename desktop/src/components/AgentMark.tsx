import { CLAUDE_CODE_MARK_PATH } from '../lib/brandMarks';

export function AgentMark({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path d={CLAUDE_CODE_MARK_PATH} fill="currentColor" />
    </svg>
  );
}
