import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Removes the dashed card outline (for use inside cards). */
  borderless?: boolean;
}

/**
 * Standard "nothing here yet" treatment for empty routes and lists.
 * Styling: `.lf-emptystate` in src/styles/components.css.
 */
export function EmptyState({ icon, title, description, actions, borderless }: EmptyStateProps) {
  return (
    <section
      className={`lf-emptystate${borderless ? ' lf-emptystate--borderless' : ''}`}
      aria-label={title}
    >
      {icon ? <div className="lf-emptystate__icon">{icon}</div> : null}
      <h2 className="lf-emptystate__title">{title}</h2>
      {description ? <p className="lf-emptystate__description">{description}</p> : null}
      {actions ? <div className="lf-emptystate__actions">{actions}</div> : null}
    </section>
  );
}
