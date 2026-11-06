import type { ReactNode } from 'react';

export interface ComposerStatusSlots {
  center?: ReactNode;
  indicator?: ReactNode;
}

export function ComposerStatusRow({ children, actions, center, indicator }: ComposerStatusSlots & { children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="composer-status-shell mb-1.5 select-none">
      <div className={`composer-status-row ${center ? 'has-center' : ''}`} data-has-meta={Boolean(children || actions || indicator) || undefined}>
        <div className="composer-status-left min-w-0">{children}</div>
        {center ? <div className="composer-status-center flex min-w-0 justify-center">{center}</div> : null}
        <div className="composer-status-actions flex min-w-0 items-center justify-end gap-1">{indicator}{actions}</div>
      </div>
    </div>
  );
}
