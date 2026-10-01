/**
 * Library Home (/library) — the unified Library overview.
 *
 * Reusable assets organized by WHERE they are used. Deliberately distinct
 * from Gallery: no output history, no generation language — counts, scopes,
 * recents and quick actions for managing reusable resources.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { LibraryIcon } from '../../components/icons';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import type { LibraryAssetRecord, LibraryUsageScope } from '../../domain/library';
import { USAGE_SCOPE_LABELS } from '../../domain/library';
import { useLibraryOpsService } from './useLibraryOpsService';

const QUICK_TYPES: Array<{ type: string; label: string; scope: LibraryUsageScope }> = [
  { type: 'product', label: 'Product', scope: 'item' },
  { type: 'prop', label: 'Prop', scope: 'item' },
  { type: 'wardrobe', label: 'Wardrobe', scope: 'model' },
  { type: 'accessory', label: 'Accessory', scope: 'model' },
  { type: 'reference', label: 'Shared reference', scope: 'shared' },
  { type: 'environment_reference', label: 'Environment reference', scope: 'environment' },
];

export function LibraryOpsHomePage() {
  const navigate = useNavigate();
  const ops = useLibraryOpsService();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<LibraryAssetRecord[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [active, archived] = await Promise.all([
        ops.listLibraryAssets(SEED_LIBRARY_WORKSPACE_ID, {}),
        ops.listLibraryAssets(SEED_LIBRARY_WORKSPACE_ID, { archivedOnly: true }),
      ]);
      setAssets(active);
      setArchivedCount(archived.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the Library.');
    } finally {
      setLoading(false);
    }
  }, [ops]);

  useEffect(() => {
    void load();
  }, [load]);

  const byScope = useMemo(() => {
    const counts = new Map<LibraryUsageScope, number>();
    for (const a of assets) {
      const key: LibraryUsageScope = a.usageScope ?? 'shared';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [assets]);

  const byType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assets) counts.set(a.assetType, (counts.get(a.assetType) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [assets]);

  const recent = useMemo(() => assets.slice(0, 6), [assets]);
  const filtered = useMemo(
    () =>
      search
        ? assets.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
        : recent,
    [assets, recent, search],
  );

  return (
    <div>
      <PageHeader
        title="Library"
        description="One Library of reusable assets — organized by where they are used: on a model, on an item, in an environment, or shared. Generated outputs live in Gallery."
        actions={
          <Button variant="primary" onClick={() => navigate('/library/assets?create=1')}>
            New asset
          </Button>
        }
      />

      {loading ? (
        <Skeleton height={260} />
      ) : error ? (
        <EmptyState icon={<LibraryIcon size={22} />} title="Could not load the Library" description={error} actions={<Button onClick={() => void load()}>Try again</Button>} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              className="lf-input"
              type="search"
              placeholder="Search reusable assets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search the Library"
              style={{ flex: 1 }}
            />
            <Button onClick={() => navigate(`/library/assets${search ? `?search=${encodeURIComponent(search)}` : ''}`)}>
              Browse all
            </Button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            {(Object.keys(USAGE_SCOPE_LABELS) as LibraryUsageScope[]).map((scope) => (
              <Card key={scope}>
                <CardBody>
                  <div style={{ fontSize: 26, fontWeight: 600 }}>{byScope.get(scope) ?? 0}</div>
                  <Badge tone={scope === 'shared' ? 'info' : 'neutral'}>{USAGE_SCOPE_LABELS[scope]}</Badge>
                  <div style={{ marginTop: 8 }}>
                    <Link to={`/library/assets?scope=${scope}`} style={{ fontSize: 12 }}>Browse →</Link>
                  </div>
                </CardBody>
              </Card>
            ))}
            <Card>
              <CardBody>
                <div style={{ fontSize: 26, fontWeight: 600 }}>{archivedCount}</div>
                <Badge tone="warning">Archived</Badge>
                <div style={{ marginTop: 8 }}>
                  <Link to="/library/archived" style={{ fontSize: 12 }}>Open archive →</Link>
                </div>
              </CardBody>
            </Card>
          </div>

          <Card style={{ marginBottom: 16 }}>
            <CardBody>
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Quick add</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {QUICK_TYPES.map((q) => (
                  <Button key={q.type} size="sm" onClick={() => navigate(`/library/assets?create=1&type=${q.type}&scope=${q.scope}`)}>
                    + {q.label}
                  </Button>
                ))}
              </div>
              <p style={{ margin: '10px 0 0', fontSize: 12, color: '#64748b' }}>
                Saved shortcuts — every asset lands in the same unified Library, only its usage differs.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Asset mix</h3>
              {byType.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>No assets yet — add your first reusable asset.</p>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {byType.map(([type, count]) => (
                    <Badge key={type} tone="neutral">{type.replaceAll('_', ' ')} · {count}</Badge>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card style={{ marginTop: 16 }}>
            <CardBody>
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Recently updated</h3>
              {filtered.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Nothing matches “{search}”.</p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                  {filtered.map((a) => (
                    <li key={a.id}>
                      <Link to={`/library/assets/${a.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                        <LibraryIcon size={14} />
                        <strong>{a.name}</strong>
                        <span style={{ color: '#64748b' }}>{a.assetType.replaceAll('_', ' ')}</span>
                        {a.usageScope && <Badge tone="neutral">{USAGE_SCOPE_LABELS[a.usageScope]}</Badge>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
