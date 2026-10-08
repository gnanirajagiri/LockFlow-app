import type { ReactNode } from 'react';export interface PageHeaderProps {
  /** Small uppercase label above the title (e.g. "Builder"). */
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Renders the title in the Fraunces display style (hero moments — Home). */
  display?: boolean;
}

/** Standard page header used by every route page. */
export function PageHeader({ eyebrow, title, description, actions, display }: PageHeaderProps) {
  return (
    <header className="lf-pageheader">
      <div>
        {eyebrow ? <div className="lf-pageheader__eyebrow">{eyebrow}</div> : null}
        <h1
          className={`lf-pageheader__title${display ? ' lf-pageheader__title--display' : ''}`}
        >
          {title}
        </h1>
        {description ? <p className="lf-pageheader__description">{description}</p> : null}
      </div>
      {actions ? <div className="lf-pageheader__actions">{actions}</div> : null}
    </header>
  );
}
