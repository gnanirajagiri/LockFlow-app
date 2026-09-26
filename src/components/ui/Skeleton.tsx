export interface SkeletonProps {
  /** Preset shape: text line, heading, rectangle or circle. */
  variant?: 'text' | 'title' | 'rect' | 'circle';
  width?: string | number;
  height?: string | number;
  /** Compose several text lines at once. */
  lines?: number;
  style?: React.CSSProperties;
}

/**
 * Loading placeholder with shimmer. Respect the reduced-motion token (handled
 * globally in base.css). Styling: `.lf-skeleton` in src/styles/components.css.
 */
export function Skeleton({ variant = 'text', width, height, lines, style }: SkeletonProps) {
  if (variant === 'text' && lines && lines > 1) {
    return (
      <div style={style} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="lf-skeleton lf-skeleton--text" />
        ))}
      </div>
    );
  }

  const variantClass = `lf-skeleton--${variant}`;
  return (
    <div
      className={`lf-skeleton ${variantClass}`}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  );
}
