/**
 * Library Picker (/library/picker) — hosts the ONE reusable picker
 * component. Other areas embed <LibraryAssetPicker/> directly; this route
 * exists for standalone attach flows and demos the confirm contract.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import type { LibraryAssetRecord } from '../../domain/library';
import { USAGE_SCOPE_LABELS } from '../../domain/library';
import { useLibraryOpsService } from './useLibraryOpsService';
import { LibraryAssetPicker } from './LibraryAssetPicker';

const USER_ID = 'demo-user';

export function LibraryPickerPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ops = useLibraryOpsService();
  const [attached, setAttached] = useState<LibraryAssetRecord[]>([]);

  return (
    <div>
      <PageHeader
        title="Attach from the Library"
        description="One reusable picker for the whole product — active, approved assets by default; drafts on request; archived never."
        actions={<Button variant="ghost" onClick={() => navigate('/library/assets')}>Back to assets</Button>}
      />
      <Card>
        <CardBody>
          <LibraryAssetPicker
            service={ops}
            workspaceId={SEED_LIBRARY_WORKSPACE_ID}
            multiSelect
            confirmLabel="Attach selected"
            onConfirm={async (selected) => {
              for (const asset of selected) {
                await ops.recordLibraryAttach(
                  SEED_LIBRARY_WORKSPACE_ID,
                  asset.id,
                  { kind: 'item', id: params.get('asset') ?? asset.id },
                  USER_ID,
                );
              }
              setAttached(selected);
            }}
          />
          {attached.length > 0 && (
            <div style={{ marginTop: 14, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Attached</h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {attached.map((a) => (
                  <Badge key={a.id} tone="success">{a.name}{a.usageScope ? ` · ${USAGE_SCOPE_LABELS[a.usageScope]}` : ''}</Badge>
                ))}
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b' }}>
                The attach event is recorded in the Library audit trail; wiring into the target domain is the consumer's step.
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
