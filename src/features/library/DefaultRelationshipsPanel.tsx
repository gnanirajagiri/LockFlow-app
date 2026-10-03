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
 */
import { Card, CardBody } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

import { DefaultRelationshipController } from './DefaultRelationshipController';

export function DefaultRelationshipsPanel() {
  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
      <Card>
        <CardBody>
          <div className="lf-sheet__section">
            <h3>Default relationships &amp; suggestions</h3>
            <p className="lf-tile__description">
              Recommended defaults, reusable bundles/sets, and contextual suggestions for the
              currently selected Library target. Everything here is explicit, visible and
              reversible. Defaults never mutate locked versions — they only apply to future
              drafts and new applications of that default.
            </p>
            <div style={{ justifyContent: 'flex-start' }}>
              <DefaultRelationshipController />
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
              Locked model/environment versions are never mutated by defaults or bundles.
              Changing a default or applying a bundle always lands on a draft version first;
              the locked row is preserved forever.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
