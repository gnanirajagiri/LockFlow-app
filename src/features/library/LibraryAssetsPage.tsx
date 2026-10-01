/**
 * Library Assets (/library/assets) — grid/table browsing with multi-filter
 * controls, search and bulk archive. The create flow validates scope/link
 * consistency server-side (same-workspace links only).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { LibraryIcon } from '../../components/icons';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import type { LibraryAssetRecord, LibraryUsageScope } from '../../domain/library';
import { LIBRARY_ASSET_TYPES, USAGE_SCOPE_LABELS } from '../../domain/library';
import { formatUpdated } from './libraryOpsUi';
import { useLibraryOpsService } from './useLibraryOpsService';

const USER_ID = 'demo-user';

export function LibraryAssetsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { toast } = useToast();
  const ops = useLibraryOpsService();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LibraryAssetRecord[]>([]);
  const [mode, setMode] = useState<'grid' | 'table'>('grid');
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [typeFilter, setTypeFilter] = useState(params.get('type') ?? 'all');
  const [scopeFilter, setScopeFilter] = useState<LibraryUsageScope | ''>((params.get('scope') as LibraryUsageScope) ?? '');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(params.get('create') === '1');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '',
    assetType: params.get('type') ?? 'product',
    usageScope: (params.get('scope') as LibraryUsageScope) ?? 'shared',
    description: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await ops.listLibraryAssets(SEED_LIBRARY_WORKSPACE_ID, {
        ...(search ? { search } : {}),
        ...(typeFilter !== 'all' ? { assetType: typeFilter as never } : {}),
        ...(scopeFilter ? { usageScope: scopeFilter } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter as never } : {}),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load assets.');
    } finally {
      setLoading(false);
    }
  }, [ops, search, typeFilter, scopeFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (!form.name.trim()) {
      toast({ title: 'Give the asset a name first.', tone: 'warning' });
      return;
    }
    setBusy(true);
    try {
      const asset = await ops.createLibraryAsset(
        SEED_LIBRARY_WORKSPACE_ID,
        {
          workspaceId: SEED_LIBRARY_WORKSPACE_ID,
          name: form.name.trim(),
          assetType: form.assetType as never,
          usageScope: form.usageScope as LibraryUsageScope,
          ...(form.description ? { description: form.description } : {}),
        },
        USER_ID,
      );
      toast({ title: `Asset “${asset.name}” created in the unified Library.`, tone: 'success' });
      setCreating(false);
      setForm({ ...form, name: '', description: '' });
      navigate(`/library/assets/${asset.id}`);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not create the asset.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkArchive() {
    setBusy(true);
    try {
      for (const id of selected) {
        await ops.archiveLibraryAsset(SEED_LIBRARY_WORKSPACE_ID, id, USER_ID);
      }
      toast({ title: `${selected.size} asset${selected.size === 1 ? '' : 's'} archived.`, tone: 'success' });
      setSelected(new Set());
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not archive.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Library assets"
        description="Reusable assets only — organized by where they are used. Generated outputs belong to Gallery."
        actions={
          <Button variant="primary" onClick={() => navigate('/library/add')}>
            Add asset
          </Button>
        }
      />

      <Card>
        <CardBody>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="lf-input" type="search" placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search assets" style={{ flex: '1 1 160px' }} />
            <select className="lf-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by asset type" style={{ maxWidth: 170 }}>
              <option value="all">All types</option>
              {LIBRARY_ASSET_TYPES.map((t) => (
                <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>
              ))}
            </select>
            <select className="lf-input" value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value as LibraryUsageScope | '')} aria-label="Filter by usage scope" style={{ maxWidth: 190 }}>
              <option value="">All scopes</option>
              {(Object.keys(USAGE_SCOPE_LABELS) as LibraryUsageScope[]).map((s) => (
                <option key={s} value={s}>{USAGE_SCOPE_LABELS[s]}</option>
              ))}
            </select>
            <select className="lf-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status" style={{ maxWidth: 130 }}>
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="ready">Approved</option>
            </select>
            <div className="lf-viewtoggle" role="group" aria-label="View mode">
              <button type="button" className={`lf-viewtoggle__btn${mode === 'grid' ? ' lf-viewtoggle__btn--active' : ''}`} aria-pressed={mode === 'grid'} onClick={() => setMode('grid')}>Grid</button>
              <button type="button" className={`lf-viewtoggle__btn${mode === 'table' ? ' lf-viewtoggle__btn--active' : ''}`} aria-pressed={mode === 'table'} onClick={() => setMode('table')}>Table</button>
            </div>
          </div>
          {selected.size > 0 && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 13 }}>{selected.size} selected</span>
              <Button size="sm" disabled={busy} onClick={() => void handleBulkArchive()}>Archive selected</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
          )}
        </CardBody>
      </Card>

      {loading ? (
        <Skeleton height={280} />
      ) : error ? (
        <EmptyState icon={<LibraryIcon size={22} />} title="Could not load assets" description={error} actions={<Button onClick={() => void load()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon size={22} />}
          title="No reusable assets match"
          description="Adjust the filters, or create a new reusable asset. Generated outputs stay in Gallery."
          actions={<Button onClick={() => setCreating(true)}>New asset</Button>}
        />
      ) : mode === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginTop: 16 }}>
          {rows.map((asset) => (
            <Card key={asset.id}>
              <CardBody>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${asset.name}`}
                    checked={selected.has(asset.id)}
                    onChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(asset.id)) n.delete(asset.id); else n.add(asset.id); return n; })}
                  />
                  <div style={{ flex: 1 }}>
                    <Link to={`/library/assets/${asset.id}`} style={{ fontWeight: 600, fontSize: 14 }}>{asset.name}</Link>
                    <div style={{ fontSize: 12, color: '#64748b', margin: '4px 0 8px' }}>
                      {asset.assetType.replaceAll('_', ' ')} · updated {formatUpdated(asset.updatedAt)}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {asset.usageScope && <Badge tone="neutral">{USAGE_SCOPE_LABELS[asset.usageScope]}</Badge>}
                      <Badge tone={asset.status === 'ready' ? 'success' : 'info'}>{asset.status === 'ready' ? 'Approved' : 'Draft'}</Badge>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : (
        <Card style={{ marginTop: 16 }}>
          <CardBody>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748b' }}>
                  <th style={{ padding: '6px 8px' }}></th>
                  <th style={{ padding: '6px 8px' }}>Name</th>
                  <th style={{ padding: '6px 8px' }}>Type</th>
                  <th style={{ padding: '6px 8px' }}>Scope</th>
                  <th style={{ padding: '6px 8px' }}>Status</th>
                  <th style={{ padding: '6px 8px' }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((asset) => (
                  <tr key={asset.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '8px' }}>
                      <input type="checkbox" aria-label={`Select ${asset.name}`} checked={selected.has(asset.id)} onChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(asset.id)) n.delete(asset.id); else n.add(asset.id); return n; })} />
                    </td>
                    <td style={{ padding: '8px' }}><Link to={`/library/assets/${asset.id}`}><strong>{asset.name}</strong></Link></td>
                    <td style={{ padding: '8px' }}>{asset.assetType.replaceAll('_', ' ')}</td>
                    <td style={{ padding: '8px' }}>{asset.usageScope ? USAGE_SCOPE_LABELS[asset.usageScope] : '—'}</td>
                    <td style={{ padding: '8px' }}><Badge tone={asset.status === 'ready' ? 'success' : 'info'}>{asset.status === 'ready' ? 'Approved' : 'Draft'}</Badge></td>
                    <td style={{ padding: '8px' }}>{formatUpdated(asset.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New Library asset"
        description="One unified Library — the usage scope decides where it is used, not which library owns it."
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void handleCreate()}>Create asset</Button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="lib-name">Name</label>
            <input id="lib-name" className="lf-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="lib-type">Asset type</label>
            <select id="lib-type" className="lf-input" value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })}>
              {LIBRARY_ASSET_TYPES.map((t) => (
                <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="lib-scope">Usage scope</label>
            <select id="lib-scope" className="lf-input" value={form.usageScope} onChange={(e) => setForm({ ...form, usageScope: e.target.value as LibraryUsageScope })}>
              {(Object.keys(USAGE_SCOPE_LABELS) as LibraryUsageScope[]).map((s) => (
                <option key={s} value={s}>{USAGE_SCOPE_LABELS[s]}</option>
              ))}
            </select>
            <p className="lf-field__help">Scoped assets must link a specific model, item or environment — validated against this workspace.</p>
          </div>
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="lib-desc">Description (optional)</label>
            <input id="lib-desc" className="lf-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
