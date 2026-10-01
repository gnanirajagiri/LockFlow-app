/**
 * Library Add Asset (/library/add) — the ONE unified ingestion flow.
 *
 * Intake paths: upload a file, import/scan an image, paste an image URL,
 * create manually, or describe the asset and let LockFlow SUGGEST metadata
 * (never auto-approved — suggestions always land in an explicit review
 * step). Every path ends in the same metadata confirmation before save.
 *
 * Storage honesty: the secure byte-upload pipeline is not wired yet, so
 * uploads register a SAFE file reference (bucket + workspace-scoped path)
 * with upload_status 'pending' — no fake local storage behavior.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import type {
  LibraryAssetSuggestion,
  LibraryAssetType,
  LibraryIntakeMethod,
  LibraryUsageScope,
} from '../../domain/library';
import {
  INTAKE_METHOD_LABELS,
  LIBRARY_ASSET_TYPES,
  LIBRARY_FILE_MIME_TYPES,
  MAX_LIBRARY_FILE_BYTES,
  TYPE_SCOPE_HINT,
  USAGE_SCOPE_LABELS,
  USAGE_SCOPES,
  sanitizeExternalImageUrl,
} from '../../domain/library';
import { useLibraryOpsService } from './useLibraryOpsService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';

const USER_ID = 'demo-user';
const WS = SEED_LIBRARY_WORKSPACE_ID;

type Step = 'method' | 'intake' | 'suggest' | 'meta';

interface ChosenFile {
  fileName: string;
  fileSizeBytes: number;
  fileMimeType: string;
  previewUrl: string | null;
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'asset-file';
}

export function LibraryAddAssetPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ops = useLibraryOpsService();

  const returnTo = params.get('return');
  const inline = params.get('context') === 'picker';

  const [step, setStep] = useState<Step>('method');
  const [method, setMethod] = useState<LibraryIntakeMethod | null>(null);
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [describeText, setDescribeText] = useState('');
  const [suggestion, setSuggestion] = useState<LibraryAssetSuggestion | null>(null);
  const [parsing, setParsing] = useState(false);

  // Metadata confirmation form (pre-filled from a suggestion when present).
  const [name, setName] = useState('');
  const [assetType, setAssetType] = useState<LibraryAssetType>('prop');
  const [usageScope, setUsageScope] = useState<LibraryUsageScope>('shared');
  const [linkedModelId, setLinkedModelId] = useState('');
  const [linkedEnvironmentId, setLinkedEnvironmentId] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [rightsNote, setRightsNote] = useState('');

  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [environments, setEnvironments] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const modelRows = await new ModelsService(getModelsRepository()).listModels(WS);
        const envRows = await new EnvironmentsService(getEnvironmentsRepository()).listEnvironments(WS);
        if (!cancelled) {
          setModels(modelRows.map((m) => ({ id: m.id, name: m.name })));
          setEnvironments(envRows.map((e) => ({ id: e.id, name: e.name })));
        }
      } catch {
        // Selectors stay empty; linking is optional.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Inline add from a picker: audit the inline start on mount.
  useEffect(() => {
    if (inline) void ops.recordInlineLibraryAddStart(WS, USER_ID, 'add-flow-opened-from-picker');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needsItemHint = usageScope === 'item';

  const parsedTags = useMemo(
    () => tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
    [tagsInput],
  );

  function chooseMethod(next: LibraryIntakeMethod) {
    setError(null);
    setMethod(next);
    if (next === 'manual') {
      setStep('meta');
    } else {
      setStep('intake');
    }
  }

  function onFileChosen(picked: File | null) {
    setError(null);
    if (!picked) return;
    if (!(LIBRARY_FILE_MIME_TYPES as readonly string[]).includes(picked.type)) {
      setError('That file type is not supported yet — try JPEG, PNG, WebP, AVIF, GIF or PDF.');
      return;
    }
    if (picked.size > MAX_LIBRARY_FILE_BYTES) {
      setError('That file is larger than 25 MiB — choose a smaller one.');
      return;
    }
    setFile({
      fileName: picked.name,
      fileSizeBytes: picked.size,
      fileMimeType: picked.type,
      previewUrl: picked.type.startsWith('image/') ? URL.createObjectURL(picked) : null,
    });
  }

  async function runParse() {
    setError(null);
    setParsing(true);
    try {
      const parsed = await ops.parseLibraryAssetDescription(WS, { description: describeText }, USER_ID);
      setSuggestion(parsed);
      // Pre-fill the confirmation form — the user reviews and edits EVERYTHING.
      setName(parsed.name);
      setAssetType(parsed.assetType);
      setUsageScope(parsed.usageScope);
      setDescription(parsed.description);
      setTagsInput(parsed.tags.join(', '));
      setRightsNote(parsed.rightsOrUsageNote ?? '');
      setStep('suggest');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that description — try naming the asset and what it is used for.');
    } finally {
      setParsing(false);
    }
  }

  async function save() {
    if (!method) return;
    setError(null);
    setSaving(true);
    try {
      await ops.startLibraryAssetAdd(WS, method, USER_ID, file?.fileName ?? (imageUrl || undefined));

      if (method === 'image_url' && !sanitizeExternalImageUrl(imageUrl)) {
        throw new Error('That image URL is not allowed — use a public http(s) URL.');
      }
      if (usageScope === 'model' && !linkedModelId) {
        throw new Error('Scope “model” requires a linked model.');
      }
      if (usageScope === 'environment' && !linkedEnvironmentId) {
        throw new Error('Scope “environment” requires a linked environment.');
      }

      const asset = await ops.createLibraryAsset(
        WS,
        {
          workspaceId: WS,
          name: name.trim(),
          assetType,
          usageScope,
          ...(linkedModelId ? { linkedModelId } : {}),
          ...(linkedEnvironmentId ? { linkedEnvironmentId } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(parsedTags.length ? { tags: parsedTags } : {}),
          ...(rightsNote.trim() ? { rightsOrUsageNote: rightsNote.trim() } : {}),
          intake: {
            intakeMethod: method,
            ...(file ? {
              fileName: file.fileName,
              fileSizeBytes: file.fileSizeBytes,
              fileMimeType: file.fileMimeType,
            } : {}),
            ...(method === 'image_url' ? { sourceUrl: sanitizeExternalImageUrl(imageUrl) ?? undefined } : {}),
            ...(method === 'prompt_assisted' ? { parseConfirmed: true } : {}),
          },
        },
        USER_ID,
      );

      // Register the safe file reference (no bytes move — upload pipeline pending).
      if (file) {
        await ops.registerLibraryAssetFile(
          WS,
          asset.id,
          {
            storageBucket: 'lockflow-references',
            storagePath: `${WS}/library-assets/${asset.id}/${Date.now()}-${safeFileName(file.fileName)}`,
            fileName: file.fileName,
            mimeType: file.fileMimeType,
            fileSizeBytes: file.fileSizeBytes,
            fileKind: file.fileMimeType === 'application/pdf' ? 'document' : 'image',
          },
          USER_ID,
        );
      }
      if (method === 'image_url') {
        await ops.registerLibraryAssetFile(
          WS,
          asset.id,
          {
            storageBucket: 'lockflow-references',
            storagePath: `${WS}/library-assets/${asset.id}/url-import-${Date.now()}`,
            fileName: safeFileName(name || 'url-import'),
            mimeType: 'image/png',
            sourceUrl: sanitizeExternalImageUrl(imageUrl) ?? undefined,
            fileKind: 'image',
          },
          USER_ID,
        );
      }

      navigate(returnTo ?? `/library/assets/${asset.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the asset.');
    } finally {
      setSaving(false);
    }
  }

  const stepLabels: Array<[Step, string]> = [
    ['method', 'Method'],
    ['intake', 'Intake'],
    ['suggest', 'Suggestion'],
    ['meta', 'Confirm & save'],
  ];
  const activeIndex = stepLabels.findIndex(([s]) => s === step);

  return (
    <div>
      <PageHeader
        title="Add to the Library"
        description="One Library, one flow — reusable assets only. Generated outputs belong to Gallery and are never copied here."
        actions={<Button variant="ghost" onClick={() => navigate(returnTo ?? '/library/assets')}>Cancel</Button>}
      />

      <Card>
        <CardBody>
          <ol style={{ display: 'flex', gap: 14, listStyle: 'none', padding: 0, margin: '0 0 18px', fontSize: 13 }}>
            {stepLabels.map(([s, label], index) => (
              <li key={s} style={{ display: 'flex', gap: 6, alignItems: 'center', color: index <= activeIndex ? '#1d4ed8' : '#94a3b8', fontWeight: index === activeIndex ? 700 : 400 }}>
                <span>{index + 1}. {label}</span>
                {index < stepLabels.length - 1 && <span aria-hidden>→</span>}
              </li>
            ))}
          </ol>

          {step === 'method' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {(Object.keys(INTAKE_METHOD_LABELS) as LibraryIntakeMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => chooseMethod(m)}
                  style={{
                    textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14,
                    background: '#fff', cursor: 'pointer', minHeight: 84,
                  }}
                >
                  <strong style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>{INTAKE_METHOD_LABELS[m]}</strong>
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    {m === 'prompt_assisted'
                      ? 'LockFlow suggests metadata — you confirm before saving.'
                      : m === 'image_url'
                        ? 'For URLs already allowed in your flow.'
                        : m === 'manual'
                          ? 'Fill the metadata yourself.'
                          : 'Safe file reference recorded now; byte upload arrives with storage integration.'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === 'intake' && (method === 'upload' || method === 'import_scan') && (
            <div>
              <p style={{ marginTop: 0, fontSize: 14 }}>
                {method === 'upload' ? 'Choose an image or PDF to reference.' : 'Choose or shoot a scan/photo of the reference.'}
              </p>
              <input
                className="lf-input"
                type="file"
                accept={[...LIBRARY_FILE_MIME_TYPES].join(',')}
                onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
                aria-label="Choose a file"
              />
              {file && (
                <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {file.previewUrl && (
                    <img src={file.previewUrl} alt="Selected file preview" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  )}
                  <div style={{ fontSize: 13 }}>
                    <strong>{file.fileName}</strong>
                    <div style={{ color: '#64748b' }}>{Math.max(1, Math.round(file.fileSizeBytes / 1024))} KB · {file.fileMimeType}</div>
                    <p style={{ margin: '6px 0 0', color: '#92400e', fontSize: 12 }}>
                      Secure byte upload arrives with storage integration — a safe file reference is recorded now.
                    </p>
                  </div>
                </div>
              )}
              <div className="lf-dialogactions" style={{ marginTop: 14 }}>
                <Button onClick={() => setStep('method')}>Back</Button>
                <Button variant="primary" disabled={!file} onClick={() => setStep('meta')}>Continue</Button>
              </div>
            </div>
          )}

          {step === 'intake' && method === 'image_url' && (
            <div>
              <p style={{ marginTop: 0, fontSize: 14 }}>Paste a public image URL (http/https). It is stored as a reference — never fetched or copied.</p>
              <input
                className="lf-input"
                type="url"
                value={imageUrl}
                onChange={(e) => { setImageUrl(e.target.value); setError(null); }}
                placeholder="https://…"
                aria-label="Image URL"
                style={{ maxWidth: 480 }}
              />
              <div className="lf-dialogactions" style={{ marginTop: 14 }}>
                <Button onClick={() => setStep('method')}>Back</Button>
                <Button variant="primary" disabled={!sanitizeExternalImageUrl(imageUrl)} onClick={() => setStep('meta')}>Continue</Button>
              </div>
            </div>
          )}

          {step === 'intake' && method === 'prompt_assisted' && (
            <div>
              <p style={{ marginTop: 0, fontSize: 14 }}>
                Describe the asset in plain language — what it is and where it is used. LockFlow will SUGGEST metadata; you confirm or edit before anything is saved.
              </p>
              <textarea
                className="lf-input"
                value={describeText}
                onChange={(e) => { setDescribeText(e.target.value); setError(null); }}
                rows={5}
                placeholder="e.g. Matte ceramic matcha bowl for countertop product shots. tags: ceramic, kitchen"
                aria-label="Asset description"
                style={{ maxWidth: 560, width: '100%' }}
              />
              <div className="lf-dialogactions" style={{ marginTop: 14 }}>
                <Button onClick={() => setStep('method')}>Back</Button>
                <Button variant="primary" disabled={parsing || describeText.trim().length < 10} onClick={() => void runParse()}>
                  {parsing ? 'Reading…' : 'Suggest metadata'}
                </Button>
              </div>
            </div>
          )}

          {step === 'suggest' && suggestion && (
            <div>
              <div style={{ padding: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, marginBottom: 12 }}>
                <Badge tone="info">Suggested — not saved</Badge>
                <p style={{ margin: '8px 0 0', fontSize: 13 }}>
                  {suggestion.warnings.join(' ')} Nothing is stored until you confirm on the next step.
                </p>
              </div>
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 6, fontSize: 13 }}>
                <dt style={{ color: '#64748b' }}>Name</dt><dd style={{ margin: 0 }}>{suggestion.name}</dd>
                <dt style={{ color: '#64748b' }}>Type</dt><dd style={{ margin: 0 }}>{suggestion.assetType}</dd>
                <dt style={{ color: '#64748b' }}>Usage scope</dt><dd style={{ margin: 0 }}>{USAGE_SCOPE_LABELS[suggestion.usageScope]}</dd>
                <dt style={{ color: '#64748b' }}>Tags</dt><dd style={{ margin: 0 }}>{suggestion.tags.length ? suggestion.tags.join(', ') : '—'}</dd>
                {suggestion.rightsOrUsageNote && (<><dt style={{ color: '#64748b' }}>Rights</dt><dd style={{ margin: 0 }}>{suggestion.rightsOrUsageNote}</dd></>)}
              </dl>
              <div className="lf-dialogactions" style={{ marginTop: 14 }}>
                <Button onClick={() => setStep('intake')}>Back</Button>
                <Button variant="primary" onClick={() => setStep('meta')}>Review & edit metadata</Button>
              </div>
            </div>
          )}

          {step === 'meta' && (
            <div style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
              {method === 'prompt_assisted' && (
                <p style={{ margin: 0, fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, padding: 10 }}>
                  Pre-filled from your description — review every field before saving.
                </p>
              )}
              <label style={{ fontSize: 13, display: 'block' }}>
                <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Name</span>
                <input className="lf-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} style={{ width: '100%' }} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ fontSize: 13, display: 'block' }}>
                  <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Asset type</span>
                  <select className="lf-input" value={assetType} onChange={(e) => setAssetType(e.target.value as LibraryAssetType)} style={{ width: '100%' }}>
                    {LIBRARY_ASSET_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 13, display: 'block' }}>
                  <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Used on / in</span>
                  <select className="lf-input" value={usageScope} onChange={(e) => setUsageScope(e.target.value as LibraryUsageScope)} style={{ width: '100%' }}>
                    {USAGE_SCOPES.map((s) => <option key={s} value={s}>{USAGE_SCOPE_LABELS[s]}</option>)}
                  </select>
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ fontSize: 13, display: 'block' }}>
                  <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Linked model {usageScope === 'model' ? '(required)' : '(optional)'}</span>
                  <select className="lf-input" value={linkedModelId} onChange={(e) => setLinkedModelId(e.target.value)} style={{ width: '100%' }}>
                    <option value="">No model</option>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 13, display: 'block' }}>
                  <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Linked environment {usageScope === 'environment' ? '(required)' : '(optional)'}</span>
                  <select className="lf-input" value={linkedEnvironmentId} onChange={(e) => setLinkedEnvironmentId(e.target.value)} style={{ width: '100%' }}>
                    <option value="">No environment</option>
                    {environments.map((env) => <option key={env.id} value={env.id}>{env.name}</option>)}
                  </select>
                </label>
              </div>
              {needsItemHint && (
                <p style={{ margin: 0, fontSize: 12, color: '#92400e' }}>
                  Item links are made from the scene workflow — save this asset, then attach it from Content Studio.
                </p>
              )}
              <label style={{ fontSize: 13, display: 'block' }}>
                <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Description</span>
                <textarea className="lf-input" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} style={{ width: '100%' }} />
              </label>
              <label style={{ fontSize: 13, display: 'block' }}>
                <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Tags (comma-separated)</span>
                <input className="lf-input" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} style={{ width: '100%' }} />
              </label>
              <label style={{ fontSize: 13, display: 'block' }}>
                <span style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Rights / usage note (optional)</span>
                <input className="lf-input" value={rightsNote} onChange={(e) => setRightsNote(e.target.value)} maxLength={500} style={{ width: '100%' }} />
              </label>
              <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                New assets start as drafts — approve them by locking a version. Suggested scope for this type: {TYPE_SCOPE_HINT[assetType]}.
              </p>
              {error && <p style={{ margin: 0, fontSize: 13, color: '#b91c1c' }} role="alert">{error}</p>}
              <div className="lf-dialogactions">
                <Button onClick={() => setStep(method === 'prompt_assisted' ? 'suggest' : method === 'manual' ? 'method' : 'intake')}>Back</Button>
                <Button variant="primary" disabled={saving || name.trim().length === 0} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Confirm & save to Library'}
                </Button>
              </div>
            </div>
          )}

          {error && step !== 'meta' && (
            <p style={{ marginTop: 12, fontSize: 13, color: '#b91c1c' }} role="alert">{error}</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
