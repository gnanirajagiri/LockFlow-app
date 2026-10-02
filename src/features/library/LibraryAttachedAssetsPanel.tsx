/**
 * LibraryAttachedAssetsPanel (Prompt 23) — the attached-asset summary UI.
 *
 * Shows every Library attachment on a target (scene, campaign item, …) with
 * role chips, status warnings and safe actions:
 *   * Remove — detaches the reference; the Library asset itself is NEVER
 *     deleted (detach is audited and reversible by re-attaching).
 *   * Replace — opens the attach drawer in replace mode: same context-aware
 *     validation, one swap, both sides audited.
 *   * Empty state — hosts pass `onAttach` to expose the "Attach from
 *     Library" CTA right where the panel renders.
 *
 * Archived attachments remain visible with a warning until removed or
 * replaced; nothing here touches Gallery records.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import type {
  LibraryAttachmentRecord,
  LibraryAttachmentRoleName,
  LibraryAttachmentTargetType,
  LibraryAssetRecord,
} from '../../domain/library';
import { USAGE_SCOPE_LABELS } from '../../domain/library';
import type { LibraryOpsService } from '../../services/libraryOpsService';
import { LibraryAttachDrawer } from './LibraryAttachDrawer';

export interface LibraryAttachedAssetsPanelProps {
  service: LibraryOpsService;
  workspaceId: string;
  targetType: LibraryAttachmentTargetType;
  targetId: string;
  targetLabel?: string;
  heading?: string;
  canEdit?: boolean;
  actorId?: string;
  /** Registry roles offered by the replace drawer's role select. */
  roleOptions?: LibraryAttachmentRoleName[];
  /** Called after any change so hosts can refresh counts. */
  onChanged?: () => void;
  /** Present when the host offers the attach CTA (drawer state lives there). */
  onAttach?: () => void;
  /** Start collapsed when there is nothing attached yet. */
  defaultOpen?: boolean;
  /** Bump to force a reload (e.g. after a sibling attach drawer closes). */
  refreshKey?: number;
}

interface AttachmentDetail {
  attachment: LibraryAttachmentRecord;
  asset: LibraryAssetRecord;
}

export function LibraryAttachedAssetsPanel(props: LibraryAttachedAssetsPanelProps) {
  const {
    service, workspaceId, targetType, targetId, targetLabel,
    heading = 'Library assets', canEdit = true, actorId = 'demo-user',
    roleOptions, onChanged, onAttach, defaultOpen, refreshKey = 0,
  } = props;
  const [details, setDetails] = useState<AttachmentDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<LibraryAttachmentRecord | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetails(await service.listTargetAttachmentDetails(workspaceId, targetType, targetId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load attached Library assets.');
      setDetails([]);
    }
  }, [service, workspaceId, targetType, targetId, refreshKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(detail: AttachmentDetail) {
    setBusyId(detail.attachment.id);
    setError(null);
    try {
      await service.detachLibraryAsset(workspaceId, detail.attachment.id, actorId);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the attachment.');
    } finally {
      setBusyId(null);
    }
  }

  const rows = details ?? [];
  const open = defaultOpen ?? rows.length > 0;

  return (
    <details className="lf-library__attachedpanel" open={open} style={{ marginTop: 8 }}>
      <summary style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#334155' }}>
        {heading}{rows.length > 0 ? ` (${rows.length})` : ''}
      </summary>
      <div style={{ padding: '8px 0 2px' }}>
        {error && <p style={{ margin: '0 0 8px', fontSize: 12, color: '#b91c1c' }} role="alert">{error}</p>}

        {rows.length === 0 ? (
          <p style={{ margin: '0 0 8px', fontSize: 12, color: '#64748b' }}>
            No Library assets attached here yet.
            {onAttach && canEdit ? ' Attach reusable references — never copies.' : ''}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {rows.map(({ attachment, asset }) => {
              const archived = asset.archivedAt !== null || asset.status === 'archived';
              return (
                <li
                  key={attachment.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 8px', background: '#fff',
                  }}
                >
                  <Link to={`/library/assets/${asset.id}`} style={{ fontWeight: 600, fontSize: 13 }}>
                    {asset.name}
                  </Link>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{asset.assetType.replaceAll('_', ' ')}</span>
                  <Badge tone="info">{attachment.roleOrSlot}{attachment.isPrimary ? ' · primary' : ''}</Badge>
                  {archived ? (
                    <Badge tone="warning">Archived — attached before archiving; replace or remove</Badge>
                  ) : asset.status === 'draft' ? (
                    <Badge tone="warning">Draft</Badge>
                  ) : (
                    <Badge tone="neutral">{asset.usageScope ? USAGE_SCOPE_LABELS[asset.usageScope] : 'shared'}</Badge>
                  )}
                  {canEdit && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === attachment.id}
                        onClick={() => setReplacing(attachment)}
                      >
                        Replace
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === attachment.id}
                        onClick={() => void remove({ attachment, asset })}
                      >
                        {busyId === attachment.id ? 'Removing…' : 'Remove'}
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {onAttach && canEdit && (
          <Button size="sm" variant="ghost" onClick={onAttach} style={{ marginTop: 6 }}>
            Attach from Library
          </Button>
        )}
      </div>

      {replacing && (
        <LibraryAttachDrawer
          open
          onClose={() => setReplacing(null)}
          service={service}
          workspaceId={workspaceId}
          targetType={targetType}
          targetId={targetId}
          targetLabel={targetLabel}
          replaceAttachment={replacing}
          roleOptions={roleOptions}
          actorId={actorId}
          onReplaced={async () => {
            setReplacing(null);
            await load();
            onChanged?.();
          }}
          onInlineAdd={() => setReplacing(null)}
        />
      )}
    </details>
  );
}
