import { ArrowDown } from 'lucide-react';
import { t } from '../lib/i18n';

export function JumpToBottomChip({ visible, unread, bottomOffset, onClick }: { visible: boolean; unread: number; bottomOffset: number; onClick: () => void }) {
  const label = unread > 0 ? t('newMessages', { count: String(unread) }) : t('jumpToBottom');
  return <div data-jump-to-bottom aria-live="polite" aria-atomic="true" aria-hidden={!visible} style={{ bottom: bottomOffset }}
    className={`absolute left-1/2 z-40 -translate-x-1/2 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${visible ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'}`}>
    <button type="button" tabIndex={visible ? 0 : -1} aria-label={label} onClick={onClick}
      className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--msg-tool-card-border)] bg-[hsl(var(--content-area))] px-3 py-1.5 text-12 font-medium leading-none text-[var(--msg-tool-text)] shadow-[shadow:var(--shadow-menu)] transition-colors hover:[background-image:linear-gradient(var(--cmd-palette-item-hover),var(--cmd-palette-item-hover))] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] motion-reduce:transition-none">
      <ArrowDown size={14} aria-hidden className="shrink-0" /><span>{label}</span>
    </button>
  </div>;
}
