/**
 * LibraryAssetPicker — the ONE reusable attach/attach-confirm component.
 *
 * Other product areas embed this (Models, Environments, Content, Campaigns)
 * instead of building one-off library browsers. Defaults to active, approved
 * (ready) assets in the relevant usage scope; drafts require an explicit
 * toggle; archived assets appear ONLY with the explicit include-archived
 * toggle and always carry a visible warning. Emits selected asset records —
 * consumers wire their own links; nothing is duplicated into the target.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { GalleryIcon } from '../../components/icons';
import type {
  LibraryAssetRecord,
  LibraryPickerContext,
  LibraryUsageScope,
} from '../../domain/library';
import {
  LIBRARY_ASSET_TYPES,
  TYPE_SCOPE_HINT,
  USAGE_SCOPE_LABELS,
  libraryAttachmentWarnings,
  togglePickerSelection,
} from '../../domain/library';
import { LibraryOpsService } from '../../services/libraryOpsService';

export interface LibraryAssetPickerProps {
  service: LibraryOpsService;
  workspaceId: string;
  context?: LibraryPickerContext;
  multiSelect?: boolean;
  confirmLabel?: string;
  onConfirm: (selected: LibraryAssetRecord[]) => void;
  onCancel?: () => void;
  /** Present when the host can start the inline Add-Asset flow. */
  onInlineAdd?: () => void;
}

export function LibraryAssetPicker(props: LibraryAssetPickerProps) {
  const {
    service, workspaceId, context = {}, multiSelect = false,
    confirmLabel = 'Attach', onConfirm, onCancel, onInlineAdd,
  } = props;
  const [rows, setRows] = useState<LibraryAssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(context.search ?? '');
  const [scope, setScope] = useState<LibraryUsageScope | ''>(context.usageScope ?? '');
  const [assetType, setAssetType] = useState('');
  const [includeDrafts, setIncludeDrafts] = useState(context.includeDrafts ?? false);
  const [includeArchived, setIncludeArchived] = useState(context.includeArchived ?? false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await service.listLibraryPickerAssets(
        workspaceId,
        {
          ...context,
          ...(search ? { search } : {}),
          ...(scope ? { usageScope: scope as LibraryUsageScope } : {}),
          ...(assetType ? { assetTypes: [assetType as LibraryAssetRecord['assetType']] } : {}),
          includeDrafts,
          includeArchived,
        },
        'demo-user',
      );
      setRows(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load library assets.');
    } finally {
      setLoading(false);
    }
  }, [service, workspaceId, context, search, scope, assetType, includeDrafts, includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(() => rows.filter((r) => selectedIds.has(r.id)), [rows, selectedIds]);

  function toggle(id: string) {
    setSelectedIds((prev) => togglePickerSelection(prev, id, multiSelect));
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          className="lf-input"
          type="search"
          placeholder="Search the Library…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search library assets"
          style={{ flex: '1 1 180px' }}
        />
        <select className="lf-input" value={scope} onChange={(e) => setScope(e.target.value as LibraryUsageScope | '')} aria-label="Filter by usage scope" style={{ maxWidth: 190 }}>
          <option value="">All usage scopes</option>
          {(Object.keys(USAGE_SCOPE_LABELS) as LibraryUsageScope[]).map((s) => (
            <option key={s} value={s}>{USAGE_SCOPE_LABELS[s]}</option>
          ))}
        </select>
        <select className="lf-input" value={assetType} onChange={(e) => setAssetType(e.target.value)} aria-label="Filter by asset type" style={{ maxWidth: 160 }}>
          <option value="">All asset types</option>
          {LIBRARY_ASSET_TYPES.map((t) => (
            <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10, fontSize: 13 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} />
          Include drafts
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Archived assets are shown with a warning and refused unless you opt in">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          Include archived (with warnings)
        </label>
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: '#64748b' }}>Loading the Library…</p>
      ) : error ? (
        <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<GalleryIcon size={20} />}
          title="No matching Library assets"
          description="Reusable assets live here — generated outputs stay in Gallery."
          borderless
          actions={onInlineAdd ? (
            <Button variant="primary" onClick={onInlineAdd}>Add a new asset</Button>
          ) : undefined}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, maxHeight: 340, overflowY: 'auto' }}>
          {rows.map((asset) => {
            const isSelected = selectedIds.has(asset.id);
            const archived = asset.archivedAt !== null || asset.status === 'archived';
            const warnings = includeArchived ? libraryAttachmentWarnings(asset, { archivedSelectedExplicitly: true }) : [];
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => toggle(asset.id)}
                aria-pressed={isSelected}
                title={warnings.join(' ')}
                style={{
                  textAlign: 'left',
                  border: isSelected ? '2px solid #2563eb' : archived ? '1px dashed #f59e0b' : '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: 8,
                  background: isSelected ? '#eff6ff' : archived ? '#fffbeb' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                  {asset.assetType.replaceAll('_', ' ')}
                </div>
                <strong style={{ fontSize: 13, display: 'block' }}>{asset.name}</strong>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {asset.usageScope && <Badge tone="neutral">{USAGE_SCOPE_LABELS[asset.usageScope]}</Badge>}
                  {archived ? <Badge tone="warning">Archived</Badge> : asset.status === 'draft' && <Badge tone="warning">Draft</Badge>}
                  <Badge tone="info">{TYPE_SCOPE_HINT[asset.assetType]}</Badge>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="lf-dialogactions" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {multiSelect ? `${selected.length} selected` : selected.length === 1 ? selected[0].name : 'Nothing selected'}
          {' · '}archived assets need an explicit opt-in
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {onCancel && <Button onClick={onCancel}>Cancel</Button>}
          <Button variant="primary" disabled={selected.length === 0} onClick={() => onConfirm(selected)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
