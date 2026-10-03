/** 
 * DefaultRelationshipCard — one inspectable default-relationship row.
 *
 * Renders the derived, auditable state the service produces. The card
 * never infers anything on its own; it only shows:
 *   * the relationship / suggestion id,
 *   * the source entity (model or environment) with its label,
 *   * the relationship type and role/slot,
 *   * priority and the version-safety mode,
 *   * the conditional override state (pending, accepted, rejected,
 *     overridden, applied, inherited),
 *   * which target version(s) the default currently applies to, and
 *   * an accessibility-safe reason/provenance string.
 *
 * The card is pure UI. It does not call any engine method — the host owns
 * the actions and must wire accept/reject/replace/remove through the
 * RelationshipClient so server-side version safety and override semantics
 * are enforced in the service layer.
 */
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

import type { LibraryDefaultRelationshipView } from '../../domain/library';
import type { LibrarySuggestedAssetView } from '../../domain/library';
import type { LibraryAssetRecord } from '../../domain/library';

export type DefaultRelationshipCardData =
  | { kind: 'relationship'; view: LibraryDefaultRelationshipView; targetAsset?: LibraryAssetRecord | null }
  | { kind: 'suggestion'; view: LibrarySuggestedAssetView; sourceAsset?: LibraryAssetRecord | null };

export interface DefaultRelationshipCardProps {
  data: DefaultRelationshipCardData;
  /** Whether the host can accept a suggestion. The UI disables the accept
   *  action when the feature is unavailable rather than disabling silently. */
  canAccept?: boolean;
  /** Whether the host can reject a suggestion. Safe to omit when the row is
   *  not a suggestion; the host can pass false for relationships. */
  canReject?: boolean;
  /** Called by the host when the user accepts a suggestion. */
  onAccept?: () => void;
  /** Called by the host when the user rejects a suggestion. */
  onReject?: () => void;
  /** Called by the host when the user replaces an overridden default. */
  onReplace?: () => void;
  /** Called by the host when the user removes a suggestion. */
  onRemove?: () => void;
  /** Called when the user applies a bundle whose members the card scopes to.
   *  The host decides whether the apply is draft-only and which draft version. */
  onApplyBundle?: () => void;
}

function toneForRelationshipType(type: string): import('../../components/ui/Badge').BadgeTone {
  if (type === 'recommended') return 'info';
  if (type === 'default') return 'primary';
  if (type === 'suggested') return 'success';
  if (type === 'bundle_member') return 'neutral';
  return 'neutral';
}

function variantForRelationshipType(type: string): string {
  if (type === 'recommended') return 'Recommended';
  if (type === 'default') return 'Default';
  if (type === 'suggested') return 'Suggested';
  if (type === 'bundle_member') return 'Bundle member';
  return type;
}

function versionSafetyLabel(mode: string): string {
  if (mode === 'future_drafts_and_new_applications') return 'Future drafts + new applications only';
  if (mode === 'locked_only') return 'Locked only — draft required';
  if (mode === 'both') return 'Default + draft changes';
  return 'No automatic propagation';
}

function statusTone(status: string): import('../../components/ui/Badge').BadgeTone {
  if (status === 'accepted') return 'success';
  if (status === 'rejected') return 'warning';
  if (status === 'overridden') return 'danger';
  if (status === 'applied') return 'info';
  return 'neutral';
}

/** Describes the UI-visible provenance of an overridden row without leaking
 *  repository details. The host may override the label if it has more
 *  context (e.g. brand setup vs. default bundle). */
function overrideLabel(status: string): string {
  if (status === 'overridden') return 'Overridden — replaced with a custom asset';
  if (status === 'accepted') return 'Accepted — now a real attachment on this target';
  if (status === 'rejected') return 'Rejected — user declined this suggestion';
  if (status === 'pending') return 'Pending — recommended for this target';
  if (status === 'applied') return 'Applied — relationship landed on this target version';
  return 'Inherited recommendation — unchanged default';
}

function isDefaultRelationshipView(rv: LibraryDefaultRelationshipView | LibrarySuggestedAssetView): rv is LibraryDefaultRelationshipView {
  return (rv as LibraryDefaultRelationshipView).context !== undefined;
}

const WEIGHT = 600;
const SMALL = 12;
const BODY = 13;

export function DefaultRelationshipCard({
  data,
  canAccept = false,
  canReject = false,
  onAccept,
  onReject,
  onReplace,
  onRemove,
  onApplyBundle,
}: DefaultRelationshipCardProps) {
  const isSuggestion = data.kind === 'suggestion';
  const rv = data.view;
  const isRel = isDefaultRelationshipView(rv);

  const title = isRel
    ? (rv.sourceAssetName ?? rv.sourceAssetId ?? 'Unresolved asset')
    : (rv.assetName ?? rv.assetId ?? 'Suggested asset');

  const contextLabel = `${rv.targetEntityType} “${rv.targetEntityId}”`;

  return (
    <Card style={{ padding: 'var(--lf-space-2) var(--lf-space-3)' }}>
      <CardBody>
        <div style={{ display: 'grid', gap: 'var(--lf-space-2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-2)' }}>
              <span style={{ fontSize: SMALL, fontWeight: WEIGHT }}>
                {variantForRelationshipType(rv.relationshipType)}
              </span>
              <Badge tone={toneForRelationshipType(rv.relationshipType)}>
                {rv.relationshipType}
              </Badge>
            </div>

            <div style={{ textAlign: 'right', fontSize: SMALL, color: '#64748b', fontWeight: WEIGHT }}>
              {contextLabel}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: WEIGHT, fontSize: BODY }}>{title}</div>
              {isRel ? (
                <>
                  {rv.versionSafety ? (
                    <div style={{ fontSize: SMALL, color: '#64748b' }}>
                      {rv.versionSafety.replace(/_/g, ' ')}
                    </div>
                  ) : null}
                  {rv.priority !== null ? (
                    <div style={{ fontSize: SMALL, color: '#64748b' }}>Priority · {rv.priority}</div>
                  ) : null}
                  {rv.conditionsJson ? (
                    <div style={{ fontSize: SMALL, color: '#64748b' }}>
                      Conditions · {JSON.stringify(rv.conditionsJson)}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--lf-space-1)' }}>
              <Badge tone="neutral">{versionSafetyLabel(isRel ? rv.versionSafety : 'future_drafts_and_new_applications')}</Badge>
              {isSuggestion ? (
                <Badge tone={statusTone(rv.status)}>{rv.status}</Badge>
              ) : null}
              {isRel ? (
                <Badge tone="info">Affects {rv.appliedOnDraftCount} draft{rv.appliedOnDraftCount === 1 ? '' : 's'}</Badge>
              ) : null}
            </div>
          </div>

          {rv.reason ? (
            <p style={{ margin: 0, fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
              {rv.reason}
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
            {isSuggestion ? (
              <>
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
                <Button size="sm" variant="ghost" onClick={onRemove}>
                  Dismiss
                </Button>
              </>
            ) : (
              <>
                {onReplace ? (
                  <Button size="sm" variant="ghost" onClick={onReplace}>
                    Replace asset
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={onRemove}>
                  Remove
                </Button>
                {onApplyBundle ? (
                  <Button size="sm" variant="primary" onClick={onApplyBundle}>
                    Apply to draft
                  </Button>
                ) : null}
              </>
            )}
          </div>

          {isSuggestion ? (
            <p style={{ margin: 'var(--lf-space-2) 0 0', fontSize: 11, color: '#94a3b8' }}>
              {overrideLabel(rv.status)}
            </p>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}



