import type { ReactNode } from 'react';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'locked';

export interface BadgeProps {
  tone?: BadgeTone;
  /** Leading status dot (for lifecycle/status chips). */
  dot?: boolean;
  children: ReactNode;
}

/**
 * Status/label chip. The `locked` tone renders the navy treatment reserved for
 * "locked" entities (models, environments) — a core LockFlow concept.
 * Styling: `.lf-badge` in src/styles/components.css.
 */
export function Badge({ tone = 'neutral', dot = false, children }: BadgeProps) {
  return (
    <span className={`lf-badge lf-badge--${tone}`}>
      {dot ? <span className="lf-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
