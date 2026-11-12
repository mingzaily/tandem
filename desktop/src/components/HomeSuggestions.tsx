import { BookOpen, FolderGit2, Hammer, Wifi, type LucideIcon } from 'lucide-react';
import { t, type StringKey } from '../lib/i18n';

const SUGGESTIONS: { label: StringKey; prompt: StringKey; icon: LucideIcon }[] = [
  { label: 'suggestNetwork', prompt: 'suggestNetworkPrompt', icon: Wifi },
  { label: 'suggestChanges', prompt: 'suggestChangesPrompt', icon: FolderGit2 },
  { label: 'suggestProject', prompt: 'suggestProjectPrompt', icon: BookOpen },
  { label: 'suggestEnvironment', prompt: 'suggestEnvironmentPrompt', icon: Hammer },
];

/** Choosing one only fills the input box, so the text can still be read and edited. */
export function HomeSuggestions({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <div className="mt-4 flex flex-col items-start gap-px">
      {SUGGESTIONS.map(({ label, prompt, icon: Icon }) => (
        <button
          key={label}
          type="button"
          data-tooltip={t(prompt)}
          onClick={() => onSelect(t(prompt))}
          className="inline-flex h-[38px] max-w-full items-center gap-2.5 rounded-full px-3 text-14 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <Icon size={16} strokeWidth={2} aria-hidden className="shrink-0" />
          <span className="min-w-0 truncate">{t(label)}</span>
        </button>
      ))}
    </div>
  );
}
