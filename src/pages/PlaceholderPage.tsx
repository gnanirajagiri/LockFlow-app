import type { ReactNode } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';

export interface PlaceholderPageProps {
  eyebrow?: string;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: ReactNode;
  emptyIcon?: ReactNode;
  /** Terminology/roadmap chips rendered under the header. */
  badges?: string[];
  /** Optional primary action (e.g. "Create model" button stub). */
  actions?: ReactNode;
}

/**
 * Uniform "route exists, feature pending" page: keeps every nav destination
 * polished and truthful while the underlying features are built.
 */
export function PlaceholderPage({
  eyebrow,
  title,
  description,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  badges,
  actions,
}: PlaceholderPageProps) {
  return (
    <div className="lf-page">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={actions}
      />
      {badges?.length ? (
        <div className="lf-placeholder__intro">
          {badges.map((badge) => (
            <Badge key={badge} tone="neutral">
              {badge}
            </Badge>
          ))}
        </div>
      ) : null}
      <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
    </div>
  );
}
