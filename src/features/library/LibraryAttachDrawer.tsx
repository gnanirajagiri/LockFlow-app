/**
 * LibraryAttachDrawer — the ONE reusable "attach from the Library" drawer.
 *
 * Hosts the reusable picker inside the app's Drawer chrome and turns the
 * selection into REAL attachment records via the service (workspace-scoped,
 * target-validated, audited). Attachments reference canonical Library
 * assets — nothing is duplicated into the target domain.
 *
 * Used from Content Studio scenes, and embeddable from Models,
 * Environments, Campaigns and standalone flows.
 */
import { useState } from 'react';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import type {
  LibraryAttachmentRecord,
  LibraryAttachmentTargetType,
  LibraryAssetRecord,
} from '../../domain/library';
import {
  ATTACHMENT_TARGET_LABELS,
  libraryAttachmentWarnings,
  normalizeRoleOrSlot,
} from '../../domain/library';
import type { LibraryOpsService } from '../../services/libraryOpsService';
import { LibraryAssetPicker } from './LibraryAssetPicker';

export interface LibraryAttachDrawerProps {
  open: boolean;
  onClose: () => void;
  service: LibraryOpsService;
  workspaceId: string;
  targetType: LibraryAttachmentTargetType;
  targetId: string;
  targetLabel?: string;
  roleOrSlot?: string;
  multiSelect?: boolean;
  actorId?: string;
  onAttached?: (records: LibraryAttachmentRecord[]) => void;
  /** Host-provided inline Add-Asset entry (audited + navigates). */
  onInlineAdd?: () => void;
}

export function LibraryAttachDrawer(props: LibraryAttachDrawerProps) {
  const {
    open, onClose, service, workspaceId, targetType, targetId, targetLabel,
    roleOrSlot: initialRole = 'reference', multiSelect = true,
    actorId = 'demo-user', onAttached, onInlineAdd,
  } = props;
  const [role, setRole] = useState(initialRole);
  const [selected, setSelected] = useState<LibraryAssetRecord[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attached, setAttached] = useState<LibraryAttachmentRecord[]>([]);

  async function confirmAttach() {
    if (selected.length === 0) return;
    setAttaching(true);
    setError(null);
    try {
      // Archived assets may only be here because the user explicitly opted
      // in — pass allowArchived so the service can attach WITH a warning.
      const anyArchived = selected.some((a) => a.archivedAt !== null || a.status === 'archived');
      const records = await service.attachLibraryAssets(
        workspaceId,
        targetType,
        targetId,
        selected.map((asset) => ({ assetId: asset.id, roleOrSlot: normalizeRoleOrSlot(role) })),
        actorId,
        { allowArchived: anyArchived },
      );
      setAttached((prev) => [...records, ...prev]);
      setSelected([]);
      onAttached?.(records);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach the selected assets.');
    } finally {
      setAttaching(false);
    }
  }

  const warnings = selected.flatMap((asset) => libraryAttachmentWarnings(asset, { archivedSelectedExplicitly: true }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      title="Attach from the Library"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {selected.length} selected · references, never copies
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" disabled={selected.length === 0 || attaching} onClick={() => void confirmAttach()}>
              {attaching ? 'Attaching…' : 'Attach'}
            </Button>
          </div>
        </div>
      }
    >
      <p style={{ margin: '0 0 10px', fontSize: 13, color: '#334155' }}>
        Attach reusable assets to <strong>{targetLabel ?? ATTACHMENT_TARGET_LABELS[targetType]}</strong>.
        Existing attachments stay inspectable if an asset is archived later.
      </p>

      <label style={{ display: 'block', fontSize: 13, marginBottom: 10 }}>
        <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Role / slot</span>
        <input
          className="lf-input"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="e.g. hero, prop, reference"
          aria-label="Role or slot for the attachment"
          style={{ maxWidth: 240 }}
        />
      </label>

      <LibraryAssetPicker
        service={service}
        workspaceId={workspaceId}
        multiSelect={multiSelect}
        confirmLabel="Attach"
        onConfirm={(assets) => setSelected(assets)}
        onInlineAdd={onInlineAdd}
      />

      {warnings.length > 0 && (
        <div style={{ marginTop: 10, padding: 10, background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8 }}>
          {warnings.map((w) => (
            <p key={w} style={{ margin: '2px 0', fontSize: 12, color: '#92400e' }}>⚠ {w}</p>
          ))}
        </div>
      )}

      {error && (
        <p style={{ marginTop: 10, fontSize: 13, color: '#b91c1c' }} role="alert">{error}</p>
      )}

      {attached.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Attached just now</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {attached.map((record) => (
              <Badge key={record.id} tone="success">
                {record.roleOrSlot}{record.isPrimary ? ' · primary' : ''}
              </Badge>
            ))}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b' }}>
            Attachments are audited in the Library trail; the target domain keeps its own wiring.
          </p>
        </div>
      )}
    </Drawer>
  );
}
