/** 
 * SuggestedAssetCard — a deterministic, context-aware suggestion presented
 * in a draft/edit workflow.
 *
 * The card renders provenance (where the suggestion came from), the reason,
 * the target context and the current override state. It intentionally
 * exposes accept, reject, replace and dismiss but never mutates them:
 * the host wires those actions to the RelationshipClient.
 *
 * Rule-based only: no opaque AI scoring lives here. Suggestions must be
 * deterministic and auditable, and every proposal carries enough metadata
 * (reason, priority, provenance) for the user to act on it.
 */
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

import type { LibrarySuggestedAssetView } from '../../domain/library';

export interface SuggestedAssetCardProps {
  suggestion: LibrarySuggestedAssetView;
  /** Can the host accept this suggestion? */
  canAccept?: boolean;
  /** Can the host reject this suggestion? */
  canReject?: boolean;
  /** Can the host replace the suggested asset's target asset? */
  canReplace?: boolean;
  /** Can the host dismiss/reject the suggestion? */
  canDismiss?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  onReplace?: () => void;
  onDismiss?: () => void;
}

function statusTone(status: string): import('../../components/ui/Badge').BadgeTone {
  if (status === 'accepted') return 'success';
  if (status === 'rejected') return 'warning';
  if (status === 'overridden') return 'danger';
  return 'neutral';
}

function provenanceLabel(suggestion: LibrarySuggestedAssetView): string {
  if (suggestion.status === 'overridden') return 'Overridden — a manual asset now fills this slot';
  if (suggestion.status === 'accepted') return 'Accepted — now a real attachment on this target';
  if (suggestion.status === 'rejected') return 'Rejected — user declined this suggestion';
  return 'Inherited recommendation — recommended for this target';
}

export function SuggestedAssetCard({
  suggestion,
  canAccept = false,
  canReject = false,
  canReplace = false,
  canDismiss = false,
  onAccept,
  onReject,
  onReplace,
  onDismiss,
}: SuggestedAssetCardProps) {
  return (
    <Card style={{ padding: 'var(--lf-space-3)' }}>
      <CardBody>
        <div style={{ display: 'grid', gap: 'var(--lf-space-2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-2)' }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Recommended for this target</span>
              <Badge tone={statusTone(suggestion.status)}>{suggestion.status}</Badge>
            </div>
            <Badge tone="neutral">Rule-based</Badge>
          </div>

          <div style={{ display: 'grid', gap: 'var(--lf-space-1)' }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{suggestion.assetName ?? suggestion.sourceAssetId ?? 'Asset'}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {suggestion.targetEntityType} “{suggestion.targetEntityId}” · {suggestion.reason}
            </div>
            {suggestion.priority !== null ? (
              <div style={{ fontSize: 12, color: '#64748b' }}>Priority · {suggestion.priority}</div>
            ) : null}
            {suggestion.relationshipId && suggestion.relationshipId !== suggestion.id ? (
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Source relationship · {suggestion.relationshipId}
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
            {canAccept ? (
              <Button size="sm" variant="primary" onClick={onAccept}>
                Accept
              </Button>
            ) : null}
            {canReject ? (
              <Button size="sm" variant="ghost" onClick={onReject}>
                Reject
              </Button>
            ) : null}
            {canReplace ? (
              <Button size="sm" variant="ghost" onClick={onReplace}>
                Replace
              </Button>
            ) : null}
            {canDismiss ? (
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                Dismiss
              </Button>
            ) : null}
          </div>

          <p style={{ margin: 'var(--lf-space-2) 0 0', fontSize: 11, color: '#94a3b8' }}>
            {provenanceLabel(suggestion)}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
