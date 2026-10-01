/**
 * Library Asset Edit (/library/assets/:assetId/edit) — metadata, tags,
 * scope/links, rights note, archive controls, file references and an
 * audit-safe history summary. Everything is workspace-scoped via the ops
 * service; archived assets stay fully inspectable here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import type {
  LibraryAssetFileRecord,
  LibraryAttachmentRecord,
  LibraryAssetRecord,
  LibraryEventRecord,
  LibraryTagRecord,
  LibraryUsageScope,
} from '../../domain/library';
import {
  ATTACHMENT_TARGET_LABELS,
  USAGE_SCOPE_LABELS,
  USAGE_SCOPES,
} from '../../domain/library';
import { useLibraryOpsService } from './useLibraryOpsService';
import { LibraryAssetStorageService, DemoModeError } from '../../services/libraryAssetStorage';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';

const USER_ID = 'demo-user';
const WS = SEED_LIBRARY_WORKSPACE_ID;

export function LibraryAssetEditPage() {
  const navigate = useNavigate();
  const { assetId = '' } = useParams();
  const ops = useLibraryOpsService();

  const [asset, setAsset] = useState<LibraryAssetRecord | null>(null);
  const [tags, setTags] = useState<LibraryTagRecord[]>([]);
  const [attachments, setAttachments] = useState<LibraryAttachmentRecord[]>([]);
  const [files, setFiles] = useState<LibraryAssetFileRecord[]>([]);
  const [events, setEvents] = useState<LibraryEventRecord[]>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [environments, setEnvironments] = useState<Array<{ id: string; name: string }>>([]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rightsNote, setRightsNote] = useState('');
  const [usageScope, setUsageScope] = useState<LibraryUsageScope>('shared');
  const [linkedModelId, setLinkedModelId] = useState('');
  const [linkedEnvironmentId, setLinkedEnvironmentId] = useState('');
  const [newTag, setNewTag] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Signed-URL upload pipeline (real Supabase) with per-row retry.
  const storage = useMemo(() => new LibraryAssetStorageService(), []);
  const retryFileIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingFileId, setUploadingFileId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loaded, tagRows, attachmentRows, fileRows, eventRows] = await Promise.all([
        ops.getLibraryAsset(WS, assetId, USER_ID),
        ops.getAssetTags(WS, assetId),
        ops.listAttachmentsForAsset(WS, assetId),
        ops.listAssetFiles(WS, assetId),
        ops.getAssetEvents(WS, assetId, 12),
      ]);
      setAsset(loaded);
      setTags(tagRows);
      setAttachments(attachmentRows);
      setFiles(fileRows);
      setEvents(eventRows);
      setName(loaded.name);
      setDescription(loaded.description ?? '');
      setRightsNote(loaded.rightsOrUsageNote ?? '');
      setUsageScope(loaded.usageScope ?? 'shared');
      setLinkedModelId(loaded.linkedModelId ?? '');
      setLinkedEnvironmentId(loaded.linkedEnvironmentId ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this asset.');
    } finally {
      setLoading(false);
    }
  }, [ops, assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Honest demo-mode notice surfaced by the Add flow after a metadata-only save.
  useEffect(() => {
    if (searchParams.get('upload') === 'demo-mode') {
      setNotice('Saved without the file — uploads need a configured Supabase project. Use “Upload file” on the pending reference to finish it.');
    }
  }, [searchParams]);

  function startUpload(fileId: string | null) {
    retryFileIdRef.current = fileId;
    fileInputRef.current?.click();
  }

  async function onUploadFileChosen(picked: File | null) {
    if (!picked || !asset) return;
    setUploadingFileId(retryFileIdRef.current ?? 'new');
    setError(null);
    try {
      await storage.uploadAssetFile({
        workspaceId: WS,
        assetId: asset.id,
        file: picked,
        ...(retryFileIdRef.current ? { retryFileId: retryFileIdRef.current } : {}),
      });
      setFiles(await ops.listAssetFiles(WS, asset.id));
      setEvents(await ops.getAssetEvents(WS, asset.id, 12));
      setNotice('File uploaded.');
    } catch (err) {
      setError(err instanceof DemoModeError ? err.message : err instanceof Error ? err.message : 'Upload failed.');
      if (asset && retryFileIdRef.current) {
        setFiles(await ops.listAssetFiles(WS, asset.id));
      }
    } finally {
      setUploadingFileId(null);
      retryFileIdRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const [modelRows, envRows] = await Promise.all([
          new ModelsService(getModelsRepository()).listModels(WS),
          new EnvironmentsService(getEnvironmentsRepository()).listEnvironments(WS),
        ]);
        setModels(modelRows.map((m) => ({ id: m.id, name: m.name })));
        setEnvironments(envRows.map((e) => ({ id: e.id, name: e.name })));
      } catch {
        // Selectors stay empty; linking is optional.
      }
    })();
  }, []);

  async function save() {
    if (!asset) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await ops.updateLibraryAsset(
        WS,
        asset.id,
        {
          name: name.trim(),
          description: description.trim() || null,
          rightsOrUsageNote: rightsNote.trim() || null,
          usageScope,
          linkedModelId: linkedModelId || null,
          linkedEnvironmentId: linkedEnvironmentId || null,
        },
        USER_ID,
      );
      setAsset(updated);
      setNotice('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  }

  async function addTag() {
    if (!asset || !newTag.trim()) return;
    try {
      await ops.addAssetTag(WS, asset.id, newTag.trim(), USER_ID);
      setTags(await ops.getAssetTags(WS, asset.id));
      setNewTag('');
      setNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the tag.');
    }
  }

  async function removeTag(tagName: string) {
    if (!asset) return;
    try {
      await ops.removeAssetTag(WS, asset.id, tagName, USER_ID);
      setTags(await ops.getAssetTags(WS, asset.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the tag.');
    }
  }

  async function toggleArchive() {
    if (!asset) return;
    try {
      const next = asset.archivedAt || asset.status === 'archived'
        ? await ops.restoreLibraryAsset(WS, asset.id, USER_ID)
        : await ops.archiveLibraryAsset(WS, asset.id, USER_ID);
      setAsset(next);
      setNotice(next.archivedAt ? 'Asset archived — it stays inspectable and is excluded from pickers.' : 'Asset restored.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the archive state.');
    }
  }

  async function detach(attachmentId: string) {
    try {
      await ops.detachLibraryAsset(WS, attachmentId, USER_ID);
      setAttachments(await ops.listAttachmentsForAsset(WS, assetId));
      setEvents(await ops.getAssetEvents(WS, assetId, 12));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not detach.');
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Edit asset" description="Loading…" actions={<Button variant="ghost" onClick={() => navigate(`/library/assets/${assetId}`)}>Back</Button>} />
        <Card><CardBody><p style={{ fontSize: 13, color: '#64748b' }}>Loading the asset…</p></CardBody></Card>
      </div>
    );
  }

  if (!asset) {
    return (
      <div>
        <PageHeader title="Edit asset" description="Asset not found in this workspace." actions={<Button variant="ghost" onClick={() => navigate('/library/assets')}>Back to assets</Button>} />
        <Card><CardBody><EmptyState title="Nothing to edit" description={error ?? 'This asset does not exist here.'} borderless /></CardBody></Card>
      </div>
    );
  }

  const archived = asset.archivedAt !== null || asset.status === 'archived';

  return (
    <div>
      <PageHeader
        title={`Edit: ${asset.name}`}
        description="Metadata, links and archive state — every change is audited."
        actions={<Button variant="ghost" onClick={() => navigate(`/library/assets/${asset.id}`)}>Back to asset</Button>}
      />

      <div style={{ display: 'grid', gap: 14 }}>
        <Card>
          <CardBody>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
              <Badge tone={archived ? 'warning' : asset.status === 'draft' ? 'neutral' : 'success'}>
                {archived ? 'Archived' : asset.status}
              </Badge>
              <Badge tone="info">{asset.assetType.replaceAll('_', ' ')}</Badge>
              {asset.usageScope && <Badge tone="neutral">{USAGE_SCOPE_LABELS[asset.usageScope]}</Badge>}
              {archived && (
                <Button variant="ghost" onClick={() => void toggleArchive()}>Restore from archive</Button>
              )}
              {!archived && (
                <Button variant="ghost" onClick={() => void toggleArchive()}>Archive asset</Button>
              )}
            </div>

            <div style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
              <label style={{ fontSize: 13, display: 'block' }}>
                <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Name</span>
                <input className="lf-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} style={{ width: '100%' }} />
              </label>
              <label style={{ fontSize: 13, display: 'block' }}>
                <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Description</span>
                <textarea className="lf-input" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} style={{ width: '100%' }} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ fontSize: 13, display: 'block' }}>
                  <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Used on / in</span>
                  <select className="lf-input" value={usageScope} onChange={(e) => setUsageScope(e.target.value as LibraryUsageScope)} style={{ width: '100%' }}>
                    {USAGE_SCOPES.map((s) => <option key={s} value={s}>{USAGE_SCOPE_LABELS[s]}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 13, display: 'block' }}>
                  <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Rights / usage note</span>
                  <input className="lf-input" value={rightsNote} onChange={(e) => setRightsNote(e.target.value)} maxLength={500} style={{ width: '100%' }} />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ fontSize: 13, display: 'block' }}>
                  <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Linked model {usageScope === 'model' ? '(required)' : ''}</span>
                  <select className="lf-input" value={linkedModelId} onChange={(e) => setLinkedModelId(e.target.value)} style={{ width: '100%' }}>
                    <option value="">No model</option>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 13, display: 'block' }}>
                  <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Linked environment {usageScope === 'environment' ? '(required)' : ''}</span>
                  <select className="lf-input" value={linkedEnvironmentId} onChange={(e) => setLinkedEnvironmentId(e.target.value)} style={{ width: '100%' }}>
                    <option value="">No environment</option>
                    {environments.map((env) => <option key={env.id} value={env.id}>{env.name}</option>)}
                  </select>
                </label>
              </div>

              <div>
                <span style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 }}>Tags</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  {tags.map((tag) => (
                    <span key={tag.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <Badge tone="neutral">{tag.normalizedName}</Badge>
                      <button type="button" onClick={() => void removeTag(tag.normalizedName)} aria-label={`Remove tag ${tag.normalizedName}`} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b' }}>×</button>
                    </span>
                  ))}
                  {tags.length === 0 && <span style={{ fontSize: 12, color: '#94a3b8' }}>No tags yet.</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="lf-input" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Add a tag…" maxLength={40} style={{ maxWidth: 220 }} />
                  <Button onClick={() => void addTag()} disabled={!newTag.trim()}>Add tag</Button>
                </div>
              </div>

              {error && <p style={{ margin: 0, fontSize: 13, color: '#b91c1c' }} role="alert">{error}</p>}
              {notice && <p style={{ margin: 0, fontSize: 13, color: '#166534' }}>{notice}</p>}
              <div className="lf-dialogactions">
                <Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</Button>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Attachments ({attachments.length})</h2>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#64748b' }}>
              Where this asset is referenced. Detaching removes only the reference — the asset stays.
            </p>
            {attachments.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Not attached anywhere yet — use the attach drawer in a workflow.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                {attachments.map((record) => (
                  <li key={record.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px' }}>
                    <span style={{ fontSize: 13 }}>
                      <strong>{ATTACHMENT_TARGET_LABELS[record.targetType]}</strong> · slot “{record.roleOrSlot}”{record.isPrimary ? ' · primary' : ''}
                      <span style={{ color: '#94a3b8' }}> · {new Date(record.createdAt).toLocaleDateString()}</span>
                    </span>
                    <Button variant="ghost" onClick={() => void detach(record.id)}>Detach</Button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>File references ({files.length})</h2>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#64748b' }}>
              Uploads transfer directly to private storage through a short-lived signed URL — no credentials in the browser.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => void onUploadFileChosen(e.target.files?.[0] ?? null)}
            />
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6, fontSize: 13 }}>
              {files.map((f) => (
                <li key={f.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <span>
                    <strong>{f.fileName}</strong>
                    <span style={{ color: '#64748b' }}> · {f.mimeType} · {f.fileSizeBytes ? `${Math.max(1, Math.round(f.fileSizeBytes / 1024))} KB` : 'size unknown'}</span>
                    <Badge tone={f.uploadStatus === 'uploaded' ? 'success' : f.uploadStatus === 'failed' ? 'warning' : 'neutral'}> {f.uploadStatus}</Badge>
                    {f.sourceUrl && <div style={{ color: '#64748b', wordBreak: 'break-all' }}>{f.sourceUrl}</div>}
                  </span>
                  {f.uploadStatus !== 'uploaded' && f.mimeType !== 'application/pdf' && (
                    <Button variant="ghost" disabled={uploadingFileId !== null} onClick={() => startUpload(f.uploadStatus === 'pending' || f.uploadStatus === 'failed' ? f.id : null)}>
                      {uploadingFileId === f.id ? 'Uploading…' : f.uploadStatus === 'failed' ? 'Retry upload' : 'Upload file'}
                    </Button>
                  )}
                </li>
              ))}
              {files.length === 0 && <li style={{ color: '#64748b' }}>No file references yet — add one by uploading.</li>}
            </ul>
            <div className="lf-dialogactions" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
              <Button variant="secondary" disabled={uploadingFileId !== null} onClick={() => startUpload(null)}>
                {uploadingFileId === 'new' ? 'Uploading…' : 'Upload file to this asset'}
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Audit summary</h2>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4, fontSize: 13 }}>
              {events.map((event) => (
                <li key={event.id} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: '#94a3b8', flexShrink: 0 }}>{new Date(event.createdAt).toLocaleString()}</span>
                  <span>{event.message}</span>
                </li>
              ))}
              {events.length === 0 && <li style={{ color: '#64748b' }}>No events recorded yet.</li>}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
