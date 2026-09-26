import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretches to fill the parent width (useful in forms). */
  block?: boolean;
  /** Leading icon slot. */
  leftIcon?: ReactNode;
}

/**
 * Primary action element. Variants map to `.lf-btn--*` styles in
 * src/styles/components.css, which consume design tokens exclusively.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block = false, leftIcon, className, children, type = 'button', ...rest },
  ref,
) {
  const classes = [
    'lf-btn',
    `lf-btn--${variant}`,
    `lf-btn--${size}`,
    block ? 'lf-btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {leftIcon ? <span className="lf-btn__icon" aria-hidden="true">{leftIcon}</span> : null}
      {children}
    </button>
  );
});
