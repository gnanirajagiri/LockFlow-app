import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '../icons';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg';
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Accessible dialog: portal, overlay click + Escape to close, initial focus on
 * the close control, focus return on unmount, background scroll lock.
 * Styling: `.lf-modal__*` in src/styles/components.css.
 */
export function Modal({ open, onClose, title, description, size = 'md', footer, children }: ModalProps) {
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
      className="lf-modal__overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`lf-modal lf-modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lf-modal-title"
        aria-describedby={description ? 'lf-modal-desc' : undefined}
        tabIndex={-1}
      >
        <div className="lf-modal__header">
          <div>
            <h2 className="lf-modal__title" id="lf-modal-title">
              {title}
            </h2>
            {description ? (
              <p className="lf-card__description" id="lf-modal-desc">
                {description}
              </p>
            ) : null}
          </div>
          <button type="button" className="lf-iconbtn" aria-label="Close dialog" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="lf-modal__body">{children}</div>
        {footer ? <div className="lf-modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
