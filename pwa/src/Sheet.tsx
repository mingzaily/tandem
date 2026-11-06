import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { t } from './lib/i18n';
export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet-body">
        <div className="sheet-handle" />
        <header className="sheet-header">
          <h2>{title}</h2>
          <button className="icon-button" aria-label={t('close')} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <div className="sheet-content">{children}</div>
      </div>
    </dialog>
  );
}
