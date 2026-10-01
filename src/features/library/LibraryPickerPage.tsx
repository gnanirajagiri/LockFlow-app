/**
 * Library Picker (/library/picker) — hosts the ONE reusable attach drawer
 * for standalone flows: pass ?targetType=&targetId=&label= to attach to a
 * real target. Other areas embed <LibraryAttachDrawer/> directly.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { GalleryIcon } from '../../components/icons';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import type {
  LibraryAttachmentRecord,
  LibraryAttachmentTargetType,
} from '../../domain/library';
import {
  ATTACHMENT_TARGET_LABELS,
  LIBRARY_ATTACHMENT_TARGET_TYPES,
} from '../../domain/library';
import { useLibraryOpsService } from './useLibraryOpsService';
import { LibraryAttachDrawer } from './LibraryAttachDrawer';

const USER_ID = 'demo-user';
const WS = SEED_LIBRARY_WORKSPACE_ID;

export function LibraryPickerPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ops = useLibraryOpsService();

  const targetType = params.get('targetType') as LibraryAttachmentTargetType | null;
  const targetId = params.get('targetId');
  const label = params.get('label');

  const validTarget = targetType !== null && targetId !== null
    && (LIBRARY_ATTACHMENT_TARGET_TYPES as string[]).includes(targetType)
    && targetId.length > 0;

  const [attachments, setAttachments] = useState<LibraryAttachmentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadAttachments = useCallback(async () => {
    if (!validTarget || !targetType || !targetId) return;
    try {
      setAttachments(await ops.listAttachmentsForTarget(WS, targetType, targetId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load attachments.');
    }
  }, [ops, targetType, targetId, validTarget]);

  useEffect(() => {
    void loadAttachments();
  }, [loadAttachments]);

  const addWithReturn = `/library/add?context=picker&return=${encodeURIComponent(
    `/library/picker?targetType=${targetType ?? ''}&targetId=${targetId ?? ''}&label=${encodeURIComponent(label ?? '')}`,
  )}`;

  return (
    <div>
      <PageHeader
        title="Attach from the Library"
        description="One reusable attach drawer for the whole product — real attachment records, workspace-scoped and audited."
        actions={<Button variant="ghost" onClick={() => navigate('/library/assets')}>Back to assets</Button>}
      />
      <Card>
        <CardBody>
          {!validTarget ? (
            <EmptyState
              icon={<GalleryIcon size={20} />}
              title="Open this picker from a workflow"
              description="Pass a target (e.g. ?targetType=content_scene&targetId=…) or use the attach drawer inside Content Studio. Reusable assets are added through the unified Add flow."
              actions={<Button variant="primary" onClick={() => navigate('/library/add')}>Add a new asset</Button>}
            />
          ) : (
            <>
              <LibraryAttachDrawer
                open
                onClose={() => navigate('/library/assets')}
                service={ops}
                workspaceId={WS}
                targetType={targetType as LibraryAttachmentTargetType}
                targetId={targetId as string}
                targetLabel={label ?? undefined}
                actorId={USER_ID}
                onAttached={() => void loadAttachments()}
                onInlineAdd={() => navigate(addWithReturn)}
              />
              <div style={{ marginTop: 14, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
                <h2 style={{ margin: '0 0 8px', fontSize: 15 }}>
                  Attached to {label ?? ATTACHMENT_TARGET_LABELS[targetType as LibraryAttachmentTargetType]} ({attachments.length})
                </h2>
                {error && <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>}
                {attachments.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Nothing attached yet — select assets in the drawer above.</p>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {attachments.map((record) => (
                      <li key={record.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <Badge tone={record.isPrimary ? 'success' : 'neutral'}>
                          {record.roleOrSlot}{record.isPrimary ? ' · primary' : ''}
                        </Badge>
                        <Button
                          variant="ghost"
                          onClick={async () => {
                            await ops.detachLibraryAsset(WS, record.id, USER_ID);
                            await loadAttachments();
                          }}
                        >
                          Detach
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
