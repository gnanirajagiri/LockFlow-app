/** 
 * Default Relationships Manager — the Library route-level panel for P25.
 *
 * Composes the three user-facing surfaces of Prompt 25:
 *   1. Default Relationship Manager — a manageable list of recommended
 *      default Library assets, with add/edit/remove, role labels, priority,
 *      relationship type and the "future drafts + new applications only"
 *      version-safety indicator.
 *   2. Bundle / Set Management — reusable sets of assets (brand starter set,
 *      recurring prop set, look-support set) with explicit, inspectable
 *      member rows. Applying a bundle creates real draft attachments, not
 *      hidden magic state.
 *   3. Suggested Assets in Workflow — rule-based, context-aware suggestions
 *      surfaced during creation/editing, with accept, reject, replace and
 *      dismiss. Accepted suggestions become real attachment records.
 *
 * Override indicators are rendered on each card:
 *   * inherited recommendation,
 *   * accepted attachment,
 *   * manual attachment,
 *   * overridden default,
 *   * removed / rejected suggestion.
 *
 * The panel reads workspace + target scope from LibraryDataContext and
 * delegates all enforcement (workspace ownership, entity existence,
 * version safety, override semantics) to the RelationshipEngine layer. It
 * renders only the UI.
 */
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { LibraryIcon } from '../../components/icons';
import { DefaultRelationshipController } from './DefaultRelationshipController';
import { LibraryDataContext } from './useLibraryData';
import { useContext, useMemo } from 'react';

export function DefaultRelationshipsPanel() {
  const { data } = useContext(LibraryDataContext);
  const { toast } = useToast();

  const targetLabel = useMemo(() => {
    if (!data) return 'selected target';
    if (data.targetType === 'model') return `model “${data.targetName ?? 'selected model'}”`;
    if (data.targetType === 'environment') return `environment “${data.targetName ?? 'selected environment'}”`;
    return 'selected target';
  }, [data]);

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
      <Card>
        <CardBody>
          <div className="lf-sheet__section">
            <h3>Default relationships &amp; suggestions</h3>
            <p className="lf-tile__description">
              Recommended defaults, reusable bundles/sets, and contextual suggestions for{' '}
              <strong>{targetLabel}</strong>. Everything here is explicit, visible and reversible.
              Defaults never mutate locked versions — they only apply to future drafts and new
              applications of that default.
            </p>
            <div style={{ justifyContent: 'flex-start' }}>
              <DefaultRelationshipController readOnly={false} />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="lf-sheet__section">
            <h3>How override state is rendered</h3>
            <ul style={{ margin: 0, paddingLeft: 'var(--lf-space-4)' }}>
              <li style={{ marginBottom: 'var(--lf-space-1)' }}>
                <Badge tone="info">Inherited recommendation</Badge> — the default still points at
                the same asset; future drafts inherit it as-is.
              </li>
              <li style={{ marginBottom: 'var(--lf-space-1)' }}>
                <Badge tone="success">Accepted attachment</Badge> — the user accepted a suggestion;
                a real, visible attachment record now exists.
              </li>
              <li style={{ marginBottom: 'var(--lf-space-1)' }}>
                <Badge tone="neutral">Manual attachment</Badge> — the user attached an asset from the
                Library picker.
              </li>
              <li style={{ marginBottom: 'var(--lf-space-1)' }}>
                <Badge tone="danger">Overridden default</Badge> — the user replaced the defaulted
                asset on the draft; the base default is unchanged.
              </li>
              <li style={{ marginBottom: 'var(--lf-space-1)' }}>
                <Badge tone="warning">Rejected suggestion</Badge> — the user declined or dismissed
                the suggestion; the base default is untouched.
              </li>
            </ul>
            <p className="lf-tile__description" style={{ marginTop: 'var(--lf-space-3)', fontSize: 12 }}>
              <LockIcon size={12} style={{ display: 'inline-block', marginRight: 4, verticalAlign: 'middle' }} />
              A locked version can never be mutated. Changing a default or applying a bundle
              always lands on a draft version first; the locked row is preserved forever.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
