import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '../icons';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Slide direction; the mobile nav uses the default left edge. */
  side?: 'left' | 'right';
  title: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Edge-anchored panel for mobile navigation and secondary flows.
 * Same a11y contract as Modal (portal, Escape, focus restore, scroll lock).
 * Styling: `.lf-drawer__*` in src/styles/components.css.
 */
export function Drawer({ open, onClose, side = 'left', title, footer, children }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="lf-drawer__overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`lf-drawer__panel${side === 'right' ? ' lf-drawer__panel--right' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lf-drawer-title"
        tabIndex={-1}
      >
        <div className="lf-drawer__header">
          <h2 className="lf-drawer__title" id="lf-drawer-title">
            {title}
          </h2>
          <button type="button" className="lf-iconbtn" aria-label="Close panel" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="lf-drawer__body">{children}</div>
        {footer ? <div className="lf-drawer__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
