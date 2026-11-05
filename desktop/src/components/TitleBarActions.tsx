import { ArrowLeft, ArrowRight, PanelLeft } from 'lucide-react';
import { t } from '../lib/i18n';

const BUTTON =
  'inline-flex h-7 w-7 items-center justify-center rounded-full text-[hsl(var(--titlebar-icon))] transition-colors enabled:hover:bg-[var(--surface-hover)] enabled:hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-40';

interface TitleBarActionsProps {
  canGoBack: boolean;
  canGoForward: boolean;
  onToggleSidebar: () => void;
  onBack: () => void;
  onForward: () => void;
}

/** Sits right of the window controls, and stays there when the sidebar is hidden. */
export function TitleBarActions({ canGoBack, canGoForward, onToggleSidebar, onBack, onForward }: TitleBarActionsProps) {
  const actions = [
    { label: t('toggleSidebar'), icon: PanelLeft, onClick: onToggleSidebar, disabled: false },
    { label: t('historyBack'), icon: ArrowLeft, onClick: onBack, disabled: !canGoBack },
    { label: t('historyForward'), icon: ArrowRight, onClick: onForward, disabled: !canGoForward },
  ];
  return (
    <div className="absolute left-[78px] top-[9px] z-30 flex items-center gap-1">
      {actions.map(({ label, icon: Icon, onClick, disabled }) => (
        <button key={label} type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={BUTTON}>
          <Icon size={15} aria-hidden />
        </button>
      ))}
    </div>
  );
}
