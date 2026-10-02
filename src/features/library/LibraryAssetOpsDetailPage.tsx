/**
 * Library Asset Detail (/library/assets/:assetId).
 *
 * Preview, metadata, tags, validated links, file references, and the
 * asset's audit trail. Actions: edit metadata, archive/restore, reuse in
 * the picker. Storage paths are internal references — never signed URLs.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { LibraryIcon } from '../../components/icons';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import type { LibraryAssetRecord, LibraryEventRecord, LibraryTagRecord, LibraryUsageScope } from '../../domain/library';
import { USAGE_SCOPE_LABELS } from '../../domain/library';
import { formatDateTime } from './libraryOpsUi';
import { useLibraryOpsService } from './useLibraryOpsService';

const USER_ID = 'demo-user';

export function LibraryAssetOpsDetailPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const ops = useLibraryOpsService();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asset, setAsset] = useState<LibraryAssetRecord | null>(null);
  const [tags, setTags] = useState<LibraryTagRecord[]>([]);
  const [events, setEvents] = useState<LibraryEventRecord[]>([]);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [scopeDraft, setScopeDraft] = useState<LibraryUsageScope | ''>('');
  const [tagDraft, setTagDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!assetId) return;
    setLoading(true);
    setError(null);
    try {
      const [a, t, e] = await Promise.all([
        ops.getLibraryAsset(SEED_LIBRARY_WORKSPACE_ID, assetId, USER_ID),
        ops.getAssetTags(SEED_LIBRARY_WORKSPACE_ID, assetId),
        ops.getAssetEvents(SEED_LIBRARY_WORKSPACE_ID, assetId),
      ]);
      setAsset(a);
      setTags(t);
      setEvents(e);
      setNameDraft(a.name);
      setDescDraft(a.description ?? '');
      setScopeDraft(a.usageScope ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this asset.');
    } finally {
      setLoading(false);
    }
  }, [ops, assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>, okMessage: string) {
    setBusy(true);
    try {
      await action();
      toast({ title: okMessage, tone: 'success' });
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Action failed.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Library asset" description="Loading…" />
        <Skeleton height={280} />
      </div>
    );
  }
  if (error || !asset) {
    return (
      <EmptyState
        icon={<LibraryIcon size={22} />}
        title="Asset not available"
        description={error ?? 'The asset belongs to another workspace or does not exist.'}
        actions={<Button onClick={() => navigate('/library/assets')}>Back to Library</Button>}
      />
    );
  }

  const archived = asset.archivedAt !== null || asset.status === 'archived';

  return (
    <div>
      <PageHeader
        title={asset.name}
        description={`Reusable ${asset.assetType.replaceAll('_', ' ')} — ${asset.usageScope ? USAGE_SCOPE_LABELS[asset.usageScope] : 'usage scope not set'}.`}
        actions={
          <Button variant="ghost" onClick={() => navigate('/library/assets')}>Back to assets</Button>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <Card>
          <CardBody>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {archived && <Badge tone="warning">Archived</Badge>}
              <Badge tone={asset.status === 'ready' ? 'success' : 'info'}>{asset.status === 'ready' ? 'Approved' : 'Draft'}</Badge>
              {asset.usageScope && <Badge tone="neutral">{USAGE_SCOPE_LABELS[asset.usageScope]}</Badge>}
              {asset.sourceKind && <Badge tone="info">{asset.sourceKind.replaceAll('_', ' ')}</Badge>}
            </div>

            {editing ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <div className="lf-field">
                  <label className="lf-field__label" htmlFor="edit-name">Name</label>
                  <input id="edit-name" className="lf-input" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
                </div>
                <div className="lf-field">
                  <label className="lf-field__label" htmlFor="edit-desc">Description</label>
                  <input id="edit-desc" className="lf-input" value={descDraft} onChange={(e) => setDescDraft(e.target.value)} />
                </div>
                <div className="lf-field">
                  <label className="lf-field__label" htmlFor="edit-scope">Usage scope</label>
                  <select id="edit-scope" className="lf-input" value={scopeDraft} onChange={(e) => setScopeDraft(e.target.value as LibraryUsageScope | '')}>
                    <option value="">Not set</option>
                    {(Object.keys(USAGE_SCOPE_LABELS) as LibraryUsageScope[]).map((s) => (
                      <option key={s} value={s}>{USAGE_SCOPE_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await ops.updateLibraryAsset(
                          SEED_LIBRARY_WORKSPACE_ID,
                          asset.id,
                          {
                            name: nameDraft.trim(),
                            description: descDraft.trim() || null,
                            usageScope: (scopeDraft || null) as LibraryUsageScope | null,
                          },
                          USER_ID,
                        );
                      }, 'Asset updated.').then(() => setEditing(false))
                    }
                  >
                    Save
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <dl style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '6px 10px', fontSize: 13 }}>
                  <dt>Type</dt><dd style={{ margin: 0 }}>{asset.assetType.replaceAll('_', ' ')}</dd>
                  <dt>Description</dt><dd style={{ margin: 0 }}>{asset.description ?? '—'}</dd>
                  <dt>Created</dt><dd style={{ margin: 0 }}>{formatDateTime(asset.createdAt)} by {asset.createdBy}</dd>
                  <dt>Updated</dt><dd style={{ margin: 0 }}>{formatDateTime(asset.updatedAt)}</dd>
                  {asset.archivedAt && (<><dt>Archived</dt><dd style={{ margin: 0 }}>{formatDateTime(asset.archivedAt)} by {asset.archivedBy ?? '—'}</dd></>)}
                  <dt>Primary file</dt><dd style={{ margin: 0 }}><code>{asset.primaryFileId ?? 'not set (upload integration pending)'}</code></dd>
                  <dt>Thumbnail</dt><dd style={{ margin: 0 }}><code>{asset.thumbnailFileId ?? 'not set (upload integration pending)'}</code></dd>
                </dl>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <Button disabled={busy || archived} onClick={() => setEditing(true)}>Edit metadata</Button>
                  <Button variant="secondary" onClick={() => navigate(`/library/assets/${asset.id}/edit`)}>
                    Open full editor
                  </Button>
                  {!archived ? (
                    <Button disabled={busy} onClick={() => void run(() => ops.archiveLibraryAsset(SEED_LIBRARY_WORKSPACE_ID, asset.id, USER_ID).then(() => undefined), 'Asset archived.')}>
                      Archive
                    </Button>
                  ) : (
                    <Button disabled={busy} onClick={() => void run(() => ops.restoreLibraryAsset(SEED_LIBRARY_WORKSPACE_ID, asset.id, USER_ID).then(() => undefined), 'Asset restored.')}>
                      Restore
                    </Button>
                  )}
                  <Button variant="ghost" disabled={busy || archived} onClick={() => navigate(`/library/picker?asset=${asset.id}`)}>
                    Open in picker
                  </Button>
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <div style={{ display: 'grid', gap: 16 }}>
          <Card>
            <CardBody>
              <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Linked to</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                <li>Model: {asset.linkedModelId ? <code>{asset.linkedModelId}</code> : '—'}</li>
                <li>Item: {asset.linkedItemId ? <code>{asset.linkedItemId}</code> : '—'}</li>
                <li>Environment: {asset.linkedEnvironmentId ? <code>{asset.linkedEnvironmentId}</code> : '—'}</li>
                <li>Brand: {asset.linkedBrandId ? <code>{asset.linkedBrandId}</code> : '—'}</li>
              </ul>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b' }}>
                Links are validated against this workspace — cross-workspace links are refused server-side.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Tags</h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {tags.length === 0 ? <span style={{ fontSize: 13, color: '#64748b' }}>No tags yet.</span> : tags.map((t) => <Badge key={t.id} tone="neutral">{t.name}</Badge>)}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="lf-input" placeholder="Add a tag…" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} aria-label="New tag name" style={{ flex: 1 }} />
                <Button
                  size="sm"
                  disabled={busy || !tagDraft.trim()}
                  onClick={() =>
                    void run(async () => {
                      await ops.addAssetTag(SEED_LIBRARY_WORKSPACE_ID, asset.id, tagDraft.trim(), USER_ID);
                      setTagDraft('');
                    }, 'Tag added.')
                  }
                >
                  Add
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <Card style={{ marginTop: 16 }}>
        <CardBody>
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Audit trail</h3>
          {events.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>No events recorded yet.</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
              {events.map((e) => (
                <li key={e.id} style={{ fontSize: 13 }}>
                  <code style={{ fontSize: 11 }}>{e.eventType}</code> — {e.message}
                  <span style={{ color: '#94a3b8', fontSize: 11 }}> · {formatDateTime(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
