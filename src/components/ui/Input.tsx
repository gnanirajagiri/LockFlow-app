import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible field label (rendered above the input). */
  label: string;
  /** Supporting text shown under the input. */
  hint?: ReactNode;
  /** Validation message; switches the field into its error state. */
  error?: ReactNode;
  /** Marks the label "(optional)" without changing validation. */
  optional?: boolean;
  hideLabel?: boolean;
}

/**
 * Text input with label + description wiring per WAI-ARIA forms guidance.
 * Styling: `.lf-field` / `.lf-input` in src/styles/components.css.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, optional, hideLabel, id: idProp, className, ...rest },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className}>
      <label
        className={hideLabel ? 'lf-visually-hidden' : 'lf-field__label'}
        htmlFor={id}
      >
        {label}
        {optional ? <span className="lf-field__label--optional"> (optional)</span> : null}
      </label>
      <input
        ref={ref}
        id={id}
        className={`lf-input${error ? ' lf-input--invalid' : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...rest}
      />
      {error ? (
        <p className="lf-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="lf-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
});
