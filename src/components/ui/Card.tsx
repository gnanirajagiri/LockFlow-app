import { forwardRef, type HTMLAttributes, type MouseEventHandler, type ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover elevation and keyboard activation semantics. */
  interactive?: boolean;
  onClick?: MouseEventHandler<HTMLDivElement>;
  role?: string;
  tabIndex?: number;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  children: ReactNode;
}

/**
 * White rounded surface — the core container of the design system.
 * Styling: `.lf-card` in src/styles/components.css.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive, onClick, onKeyDown, className, children, ...rest },
  ref,
) {
  const classes = [
    'lf-card',
    interactive ? 'lf-card--interactive' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const a11yProps = interactive
    ? {
        role: (rest.role ?? 'button') as string,
        tabIndex: rest.tabIndex ?? 0,
        onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
          if (!onClick) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            (event.currentTarget as HTMLDivElement).click();
          }
          onKeyDown?.(event);
        },
      }
    : {};

  return (
    <div
      ref={ref}
      className={classes}
      onClick={onClick}
      {...a11yProps}
      {...rest}
    >
      {children}
    </div>
  );
});

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned meta/actions row. */
  actions?: ReactNode;
}

export function CardHeader({ title, description, actions }: CardHeaderProps) {
  return (
    <div className="lf-card__header" style={actions ? { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--lf-space-3)' } : undefined}>
      <div>
        <div className="lf-card__title">{title}</div>
        {description ? <div className="lf-card__description">{description}</div> : null}
      </div>
      {actions}
    </div>
  );
}

export function CardBody({
  flush,
  className,
  children,
}: {
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`lf-card__body${flush ? ' lf-card__body--flush' : ''}${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}

export function CardFooter({ children }: { children: ReactNode }) {
  return <div className="lf-card__footer">{children}</div>;
}
