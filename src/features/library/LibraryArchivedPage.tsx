/**
 * Library Archived (/library/archived) — archived assets remain inspectable
 * and restorable. Restore is distinct from delete: nothing here destroys
 * records (no permanent delete exists in the product).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { LibraryIcon } from '../../components/icons';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import type { LibraryAssetRecord } from '../../domain/library';
import { USAGE_SCOPE_LABELS } from '../../domain/library';
import { formatDateTime } from './libraryOpsUi';
import { useLibraryOpsService } from './useLibraryOpsService';

const USER_ID = 'demo-user';

export function LibraryArchivedPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const ops = useLibraryOpsService();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LibraryAssetRecord[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await ops.listLibraryAssets(SEED_LIBRARY_WORKSPACE_ID, { archivedOnly: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the archive.');
    } finally {
      setLoading(false);
    }
  }, [ops]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRestore(assetId: string) {
    setBusyId(assetId);
    try {
      await ops.restoreLibraryAsset(SEED_LIBRARY_WORKSPACE_ID, assetId, USER_ID);
      toast({ title: 'Asset restored to the active Library.', tone: 'success' });
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not restore.', tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Archived assets"
        description="Archived assets stay inspectable and can be restored. There is no permanent delete in the Library."
        actions={<Button variant="ghost" onClick={() => navigate('/library/assets')}>Back to assets</Button>}
      />
      {loading ? (
        <Skeleton height={240} />
      ) : error ? (
        <EmptyState icon={<LibraryIcon size={22} />} title="Could not load the archive" description={error} actions={<Button onClick={() => void load()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon size={22} />}
          title="Nothing archived"
          description="Archived reusable assets appear here with a restore action."
          actions={<Button onClick={() => navigate('/library/assets')}>Browse active assets</Button>}
        />
      ) : (
        <Card style={{ marginTop: 16 }}>
          <CardBody>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748b' }}>
                  <th style={{ padding: '6px 8px' }}>Name</th>
                  <th style={{ padding: '6px 8px' }}>Type</th>
                  <th style={{ padding: '6px 8px' }}>Scope</th>
                  <th style={{ padding: '6px 8px' }}>Archived</th>
                  <th style={{ padding: '6px 8px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((asset) => (
                  <tr key={asset.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '8px' }}><Link to={`/library/assets/${asset.id}`}><strong>{asset.name}</strong></Link></td>
                    <td style={{ padding: '8px' }}>{asset.assetType.replaceAll('_', ' ')}</td>
                    <td style={{ padding: '8px' }}>{asset.usageScope ? USAGE_SCOPE_LABELS[asset.usageScope] : '—'}</td>
                    <td style={{ padding: '8px' }}>{formatDateTime(asset.archivedAt)}{asset.archivedBy ? ` by ${asset.archivedBy}` : ''}</td>
                    <td style={{ padding: '8px' }}>
                      <Button size="sm" disabled={busyId === asset.id} onClick={() => void handleRestore(asset.id)}>
                        Restore
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
