import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ModelOption } from '../lib/api';
import { t } from '../lib/i18n';
import { effectiveEffort } from '../lib/modelEffort';
import { modelFlyoutPosition } from '../lib/modelFlyoutPosition';
import type { ComposerMenuOwner } from './ComposerMenu';
import { EffortSlider } from './EffortSlider';

interface Props {
  model: ModelOption;
  name: string;
  source: string;
  effort: string | null;
  anchor: HTMLElement;
  returnFocus?: HTMLElement;
  owner: ComposerMenuOwner;
  focusOnOpen: boolean;
  onChange: (effort: string | null) => void;
  onClose: () => void;
}

/** The configuration is a branch of the model menu, so its portal shares dismissal ownership. */
export function ModelConfigFlyout({ model, name, source, effort, anchor, returnFocus = anchor, owner, focusOnOpen, onChange, onClose }: Props) {
  const flyout = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ReturnType<typeof modelFlyoutPosition>>();

  useLayoutEffect(() => {
    const element = flyout.current!;
    const update = () => setPosition(modelFlyoutPosition(anchor.getBoundingClientRect(), owner.panel.current!.getBoundingClientRect(), element.offsetHeight, { width: window.innerWidth, height: window.innerHeight }));
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [anchor, owner.panel, focusOnOpen]);

  const positioned = position !== undefined;
  useLayoutEffect(() => {
    if (positioned && focusOnOpen) flyout.current!.querySelector<HTMLElement>('[role="slider"], button')?.focus({ preventScroll: true });
  }, [positioned, focusOnOpen]);

  useLayoutEffect(() => {
    const outside = (event: MouseEvent) => {
      const target = event.target as Element;
      // The row's click owns toggling and switching the open configuration.
      if (!flyout.current!.contains(target) && !(target.closest('[data-row-customize]') && owner.panel.current!.contains(target))) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      returnFocus.focus({ preventScroll: true });
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [anchor, returnFocus, owner.panel, onClose]);

  return createPortal(
    <div ref={flyout} role="dialog" aria-label={t('modelConfigFor', { model: name })} data-composer-menu-owner={owner.id}
      className="fixed z-[60] overflow-y-auto rounded-xl border border-[var(--cmd-palette-border)] bg-[var(--cmd-palette-bg)] p-3.5 pb-3 shadow-[shadow:var(--shadow-menu)]"
      style={{ left: position?.left, top: position?.top, width: position?.width ?? 264, maxHeight: position?.maxHeight, visibility: position ? 'visible' : 'hidden' }}>
      <div title={name} className="line-clamp-2 text-14 font-semibold leading-[1.35] text-[var(--model-item-text)]">{name}</div>
      <div title={[source, model.description].filter(Boolean).join(' · ')} className="truncate border-b border-[var(--model-dropdown-border)] pb-2.5 pt-[3px] text-12 text-[var(--text-tertiary)]">
        {source}{model.description ? ` · ${model.description}` : ''}
      </div>
      <EffortSlider levels={model.supportedEffortLevels} value={effort} defaultLevel={effectiveEffort(model, null)} onChange={onChange} className="pt-3.5" />
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[var(--model-dropdown-border)] pt-2.5">
        <button type="button" disabled={effort === null} onClick={() => onChange(null)} aria-label={t('effortReset')}
          className="h-7 rounded-full px-1 text-12 text-[var(--text-secondary)] enabled:hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-40">
          {t('modelConfigReset')}
        </button>
      </div>
    </div>, document.body,
  );
}
