/**
 * LibraryAttachDrawer — the ONE reusable "attach from the Library" drawer.
 *
 * Hosts the reusable picker inside the app's Drawer chrome and turns the
 * selection into REAL attachment records via the service (workspace-scoped,
 * target-validated, audited). Attachments reference canonical Library
 * assets — nothing is duplicated into the target domain.
 *
 * Prompt 23 additions:
 *   * Role/slot presets — hosts pass `roleOptions` (registry roles with
 *     cardinality + asset-type fit); the drawer adapts the picker (suggested
 *     types first, single-select for single-cardinality roles) and marks
 *     single-slot attachments as primary so the DB index backs the rule.
 *   * Replace mode — pass `replaceAttachment` to swap one attachment safely
 *     (same validation, both sides audited; Library assets untouched).
 *
 * Used from Content Studio scenes, Campaign items, and embeddable from
 * Models, Environments and standalone flows.
 */
import { useState } from 'react';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import type {
  LibraryAttachmentRecord,
  LibraryAttachmentRoleName,
  LibraryAttachmentTargetType,
  LibraryAssetRecord,
  LibraryPickerContext,
} from '../../domain/library';
import {
  ATTACHMENT_TARGET_LABELS,
  libraryAttachmentWarnings,
  libraryRoleDefinition,
  libraryRoleOptions,
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
  /**
   * Prompt 23 — replace mode: when set, the drawer swaps THIS attachment
   * instead of creating new ones (single-select, same validation, audited).
   */
  replaceAttachment?: LibraryAttachmentRecord | null;
  onReplaced?: (record: LibraryAttachmentRecord) => void;
  /** Registry roles offered in the role select (free text stays available). */
  roleOptions?: LibraryAttachmentRoleName[];
  /** Extra picker context (merged with the role preset's type suggestions). */
  context?: LibraryPickerContext;
  /** Host-provided inline Add-Asset entry (audited + navigates). */
  onInlineAdd?: () => void;
}

export function LibraryAttachDrawer(props: LibraryAttachDrawerProps) {
  const {
    open, onClose, service, workspaceId, targetType, targetId, targetLabel,
    roleOrSlot, multiSelect = true, actorId = 'demo-user',
    onAttached, onReplaced, replaceAttachment = null, roleOptions, context: hostContext,
    onInlineAdd,
  } = props;
  const initialRole = replaceAttachment?.roleOrSlot ?? roleOrSlot ?? roleOptions?.[0] ?? 'reference';
  // Free-text roles (e.g. 'wardrobe' from Models) render as an input; only
  // registry roles render as the preset select.
  const [role, setRole] = useState(initialRole);
  const [customRole, setCustomRole] = useState(!libraryRoleDefinition(initialRole));
  const [selected, setSelected] = useState<LibraryAssetRecord[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attached, setAttached] = useState<LibraryAttachmentRecord[]>([]);

  const roleDef = libraryRoleDefinition(role);
  const effectiveMulti = multiSelect && roleDef?.cardinality !== 'single' && !replaceAttachment;

  async function confirmAttach() {
    if (selected.length === 0) return;
    setAttaching(true);
    setError(null);
    try {
      // Archived assets may only be here because the user explicitly opted
      // in — pass allowArchived so the service can attach WITH a warning.
      const anyArchived = selected.some((a) => a.archivedAt !== null || a.status === 'archived');
      if (replaceAttachment) {
        const record = await service.replaceLibraryAttachment(
          workspaceId,
          replaceAttachment.id,
          {
            assetId: selected[0].id,
            roleOrSlot: normalizeRoleOrSlot(role),
            // Single-cardinality roles always carry the primary flag — the
            // DB partial unique index backs the one-per-slot rule.
            ...(roleDef?.cardinality === 'single' ? { isPrimary: true } : {}),
          },
          actorId,
          { allowArchived: anyArchived },
        );
        setAttached([record]);
        setSelected([]);
        onReplaced?.(record);
      } else {
        const records = await service.attachLibraryAssets(
          workspaceId,
          targetType,
          targetId,
          selected.map((asset) => ({
            assetId: asset.id,
            roleOrSlot: normalizeRoleOrSlot(role),
            ...(roleDef?.cardinality === 'single' ? { isPrimary: true } : {}),
          })),
          actorId,
          { allowArchived: anyArchived },
        );
        setAttached((prev) => [...records, ...prev]);
        setSelected([]);
        onAttached?.(records);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach the selected assets.');
    } finally {
      setAttaching(false);
    }
  }

  const warnings = selected.flatMap((asset) => libraryAttachmentWarnings(asset, { archivedSelectedExplicitly: true }));
  const pickerContext: LibraryPickerContext = {
    ...hostContext,
    ...(roleDef?.allowedAssetTypes && !hostContext?.assetTypes
      ? { assetTypes: roleDef.allowedAssetTypes }
      : {}),
  };
  const options = libraryRoleOptions().filter((o) => !roleOptions || roleOptions.includes(o.name));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      title={replaceAttachment ? 'Replace Library attachment' : 'Attach from the Library'}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {replaceAttachment
              ? `Replacing “${replaceAttachment.roleOrSlot}” · references, never copies`
              : `${selected.length} selected · references, never copies`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" disabled={selected.length === 0 || attaching} onClick={() => void confirmAttach()}>
              {attaching ? 'Saving…' : replaceAttachment ? 'Replace' : 'Attach'}
            </Button>
          </div>
        </div>
      }
    >
      <p style={{ margin: '0 0 10px', fontSize: 13, color: '#334155' }}>
        {replaceAttachment ? (
          <>Choose the Library asset that should replace <strong>{replaceAttachment.roleOrSlot}</strong> on{' '}
            <strong>{targetLabel ?? ATTACHMENT_TARGET_LABELS[targetType]}</strong>. The old reference is detached;
            both sides are audited.</>
        ) : (
          <>Attach reusable assets to <strong>{targetLabel ?? ATTACHMENT_TARGET_LABELS[targetType]}</strong>.
            Existing attachments stay inspectable if an asset is archived later.</>
        )}
      </p>

      {options.length > 0 && !customRole ? (
        <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
          <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Role / slot</span>
          <select
            className="lf-input"
            value={role}
            onChange={(e) => {
              if (e.target.value === '__custom') {
                setCustomRole(true);
                setRole('');
              } else {
                setRole(e.target.value);
              }
            }}
            aria-label="Role or slot for the attachment"
            style={{ maxWidth: 240 }}
          >
            {options.map((o) => (
              <option key={o.name} value={o.name}>{o.label}</option>
            ))}
            <option value="__custom">Custom role…</option>
          </select>
        </label>
      ) : (
        <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
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
      )}
      {roleDef && (
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#64748b' }}>
          {roleDef.description}
          {roleDef.cardinality === 'single' ? ' Only one per target.' : ''}
        </p>
      )}

      <LibraryAssetPicker
        service={service}
        workspaceId={workspaceId}
        context={pickerContext}
        multiSelect={effectiveMulti}
        confirmLabel={replaceAttachment ? 'Replace' : 'Attach'}
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
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>
            {replaceAttachment ? 'Replaced just now' : 'Attached just now'}
          </h3>
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
