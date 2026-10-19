'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { Icon } from './Icon';

/** A modal panel: a bottom sheet on phones, a centred dialog on wider screens. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className="sheet-body">
          <header className="sheet-head">
            <h2>{title}</h2>
            <button className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="close" />
            </button>
          </header>
          <div className="sheet-content">{children}</div>
          {footer ? <footer className="sheet-foot">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
