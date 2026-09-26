/**
 * Typed mirror of src/styles/tokens.css.
 *
 * CSS custom properties remain the single styling source of truth; use these
 * constants only where CSS cannot go (canvas measurements, inline styles that
 * must reference a token value).
 */
export const colors = {
  bg: 'var(--lf-color-bg)',
  surface: 'var(--lf-color-surface)',
  surfaceMuted: 'var(--lf-color-surface-muted)',
  navy800: 'var(--lf-color-navy-800)',
  navy700: 'var(--lf-color-navy-700)',
  ink: 'var(--lf-color-ink)',
  inkSecondary: 'var(--lf-color-ink-secondary)',
  inkMuted: 'var(--lf-color-ink-muted)',
  primary500: 'var(--lf-color-primary-500)',
  primary600: 'var(--lf-color-primary-600)',
  primarySoft: 'var(--lf-color-primary-soft)',
  border: 'var(--lf-color-border)',
  borderStrong: 'var(--lf-color-border-strong)',
} as const;

export const spacing = {
  1: 'var(--lf-space-1)',
  2: 'var(--lf-space-2)',
  3: 'var(--lf-space-3)',
  4: 'var(--lf-space-4)',
  5: 'var(--lf-space-5)',
  6: 'var(--lf-space-6)',
  7: 'var(--lf-space-7)',
  8: 'var(--lf-space-8)',
} as const;

export const radii = {
  sm: 'var(--lf-radius-sm)',
  md: 'var(--lf-radius-md)',
  lg: 'var(--lf-radius-lg)',
  xl: 'var(--lf-radius-xl)',
  full: 'var(--lf-radius-full)',
} as const;

export const shadows = {
  xs: 'var(--lf-shadow-xs)',
  sm: 'var(--lf-shadow-sm)',
  md: 'var(--lf-shadow-md)',
  lg: 'var(--lf-shadow-lg)',
} as const;

export const typography = {
  fontSans: 'var(--lf-font-sans)',
  textXs: 'var(--lf-text-xs)',
  textSm: 'var(--lf-text-sm)',
  textBase: 'var(--lf-text-base)',
  textMd: 'var(--lf-text-md)',
  textLg: 'var(--lf-text-lg)',
  textXl: 'var(--lf-text-xl)',
  text2xl: 'var(--lf-text-2xl)',
} as const;
