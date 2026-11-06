import type { Agent } from './lib/types';
import { CLAUDE_CODE_MARK_PATH, CODEX_FLOWER_PATH, CODEX_PROMPT_PATH, PI_MARK_PATHS } from './lib/brandMarks';

interface AgentMarkProps {
  agent?: Agent;
  size?: number;
  className?: string;
}

export function AgentMark({ agent = 'claude', size = 12, className }: AgentMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      {agent === 'pi' ? (
        <g fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          {PI_MARK_PATHS.map((path) => (
            <path key={path} d={path} />
          ))}
        </g>
      ) : agent === 'codex' ? (
        <>
          <path d={CODEX_FLOWER_PATH} fill="none" stroke="currentColor" strokeWidth={1.7} />
          <path d={CODEX_PROMPT_PATH} fill="currentColor" stroke="currentColor" strokeWidth={0.4} />
        </>
      ) : (
        <path d={CLAUDE_CODE_MARK_PATH} fill="currentColor" />
      )}
    </svg>
  );
}
