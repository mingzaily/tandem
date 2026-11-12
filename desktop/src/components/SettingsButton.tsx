import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'secondary' | 'primary' | 'quiet';

interface SettingsButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  danger?: boolean;
  busy?: boolean;
  iconOnly?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  secondary: 'border-[var(--border-default)] bg-[var(--surface-elevated)] enabled:hover:bg-[var(--button-secondary-hover)] enabled:active:bg-[var(--button-secondary-pressed)]',
  primary: 'border-transparent bg-[var(--surface-chip)] enabled:hover:bg-[var(--button-primary-hover)] enabled:active:bg-[var(--button-primary-pressed)]',
  quiet: 'border-transparent bg-transparent enabled:hover:bg-[var(--button-secondary-hover)] enabled:active:bg-[var(--button-secondary-pressed)]',
};

export function SettingsButton({ variant = 'secondary', danger = false, busy = false, iconOnly = false, disabled, className = '', children, type = 'button', title, ...props }: SettingsButtonProps) {
  const color = danger ? 'text-[var(--text-danger)]' : variant === 'quiet' ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]';
  return (
    <button
      {...props}
      data-tooltip={title}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`relative inline-flex h-8 shrink-0 items-center justify-center rounded-full border text-13 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-default disabled:opacity-60 ${iconOnly ? 'w-8 px-0' : 'px-3'} ${VARIANTS[variant]} ${color} ${className}`}
    >
      <span className={`inline-flex items-center justify-center gap-1.5 ${busy ? 'opacity-0' : ''}`}>{children}</span>
      {busy ? <LoaderCircle size={14} aria-hidden className="pointer-events-none absolute animate-spin" /> : null}
    </button>
  );
}
