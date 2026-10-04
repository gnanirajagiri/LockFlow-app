/**
 * Model Builder tab — prompt 32.
 *
 * The Model Builder workspace: labeled reference import (identity vs
 * supporting roles), honest posture/angle coverage, Character Sheet identity
 * summary, lock readiness and the explicit lock-and-save confirmation with
 * its pre-lock snapshot. Locked versions are visibly immutable — every
 * change path routes through "create draft from locked version".
 *
 * Talks ONLY to ModelBuilderService + ModelsService (never Storage, never
 * provider code). Private storage paths never render.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { LockIcon } from '../../components/icons';
import { ModelBuilderService, InMemoryModelBuilderAuditStore } from '../../models/modelBuilderService';
import type { ModelBuilderView, ModelVersionSnapshot } from '../../models/modelBuilderService';
import {
  COVERAGE_SLOTS,
  REFERENCE_ROLE_LABELS,
} from '../../models/modelBuilderWorkflow';
import type { ModelBuilderReferenceRole } from '../../models/modelBuilderWorkflow';
import { LockedVersionError } from '../../domain/models/guards';
import { getModelsRepository } from '../../data';
import { LibraryService } from '../../services/libraryService';
import { getLibraryRepository } from '../../data/libraryFactory';
import { useModelOutletContext } from './tabRoutes';

const WORKSPACE = 'ws_demo';
const ACTOR = 'demo-user';

/** Roles offered in the import dialog (grouped identity vs supporting). */
const IMPORT_ROLES: Array<{ role: ModelBuilderReferenceRole; identity: boolean }> = [
  { role: 'primary_identity', identity: true },
  { role: 'supporting_face', identity: true },
  { role: 'full_body_posture', identity: true },
  { role: 'angle_three_quarter', identity: false },
  { role: 'angle_left', identity: false },
  { role: 'angle_right', identity: false },
  { role: 'back_360', identity: false },
  { role: 'style_look', identity: false },
  { role: 'non_identity_supporting', identity: false },
];

/** Shared audit store (remount-survival, same pattern as the app). */
let auditStoreInstance: InMemoryModelBuilderAuditStore | null = null;
function getAuditStore(): InMemoryModelBuilderAuditStore {
  if (!auditStoreInstance) auditStoreInstance = new InMemoryModelBuilderAuditStore();
  return auditStoreInstance;
}

let builderServiceInstance: ModelBuilderService | null = null;

/** Shared ModelBuilderService over the app's models service. */
export function useModelBuilderService(models: ModelBuilderServiceCtorArgs): ModelBuilderService {
  return useMemo(() => {
    if (builderServiceInstance) return builderServiceInstance;
    const library = new LibraryService(getLibraryRepository());
    const deps = {
      getLibraryAsset: async (assetId: string, workspaceId: string) => {
        const asset = await library.getAsset(assetId, workspaceId);
        return { id: asset.id, workspaceId, name: asset.name, storagePath: asset.coverImagePath };
      },
    };
    builderServiceInstance = new ModelBuilderService(
      models.service,
      models.repo,
      deps,
      getAuditStore(),
    );
    return builderServiceInstance;
  }, [models.service, models.repo]);
}

interface ModelBuilderServiceCtorArgs {
  service: import('../../services/modelsService').ModelsService;
  repo: ReturnType<typeof getModelsRepository>;
}

export function BuilderTab() {
  const { service, data, basePath } = useModelOutletContext();
  const { toast } = useToast();
  const repo = useMemo(() => getModelsRepository(), []);
  const builder = useModelBuilderService({ service, repo });

  const model = data.model;
  const versions = data.versions;

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [view, setView] = useState<ModelBuilderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Import dialog state
  const [importOpen, setImportOpen] = useState(false);
  const [importRole, setImportRole] = useState<ModelBuilderReferenceRole>('primary_identity');
  const [importPath, setImportPath] = useState('');

  // Lock confirmation state
  const [lockOpen, setLockOpen] = useState(false);
  const [lockConfirmed, setLockConfirmed] = useState(false);
  const [snapshot, setSnapshot] = useState<ModelVersionSnapshot | null>(null);

  const draft = useMemo(
    () => versions.find((version) => version.status === 'draft') ?? null,
    [versions],
  );

  const loadView = useCallback(async (versionId: string) => {
    setView(await builder.getModelBuilderView(WORKSPACE, versionId));
  }, [builder]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const target = selectedVersionId ?? draft?.id ?? versions[0]?.id ?? null;
      setSelectedVersionId(target);
      setView(target ? await builder.getModelBuilderView(WORKSPACE, target) : null);
    } finally {
      setLoading(false);
    }
  }, [builder, selectedVersionId, draft?.id, versions]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id]);

  if (!model) return null;
  const locked = view?.version.status === 'locked';

  async function handleImport() {
    if (!view || busy || !importPath.trim()) return;
    setBusy(true);
    try {
      await builder.attachModelReference(WORKSPACE, view.version.id, {
        role: importRole,
        source: { kind: 'upload', storagePath: importPath.trim() },
      }, ACTOR);
      toast({ title: `${REFERENCE_ROLE_LABELS[importRole]} reference added.`, tone: 'success' });
      setImportOpen(false);
      setImportPath('');
      await loadView(view.version.id);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not add the reference.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(referenceId: string) {
    if (!view || busy) return;
    setBusy(true);
    try {
      await builder.removeModelReference(WORKSPACE, view.version.id, referenceId);
      await loadView(view.version.id);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not remove the reference.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckReadiness() {
    if (!view || busy) return;
    setBusy(true);
    try {
      const check = await builder.validateModelReadinessForLock(WORKSPACE, view.version.id);
      if (check.ok) {
        toast({ title: 'Ready to lock — open lock-and-save to continue.', tone: 'success' });
      } else {
        toast({ title: `Not ready: ${check.blockers[0]}`, tone: 'error' });
      }
      await loadView(view.version.id);
    } finally {
      setBusy(false);
    }
  }

  async function openLockDialog() {
    if (!view || busy) return;
    setBusy(true);
    try {
      const check = await builder.validateModelReadinessForLock(WORKSPACE, view.version.id);
      if (!check.ok) {
        toast({ title: `Cannot lock yet: ${check.blockers[0]}`, tone: 'error' });
        return;
      }
      setSnapshot(await builder.getModelVersionSnapshot(WORKSPACE, view.version.id));
      setLockConfirmed(false);
      setLockOpen(true);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not prepare the lock.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleLock() {
    if (!view || !lockConfirmed || busy) return;
    setBusy(true);
    try {
      const { version } = await builder.lockAndSaveModelVersion(WORKSPACE, view.version.id, ACTOR);
      toast({ title: `v${version.versionNumber} locked. It cannot be edited — future changes create a new draft.`, tone: 'success' });
      setLockOpen(false);
      await refresh();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not lock the version.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateDraftFromLocked() {
    if (!view || busy) return;
    setBusy(true);
    try {
      const draftVersion = await builder.createModelDraftFromLockedVersion(WORKSPACE, view.version.id, ACTOR);
      toast({ title: `Draft v${draftVersion.versionNumber} created from the locked version.`, tone: 'success' });
      setSelectedVersionId(draftVersion.id);
      await loadView(draftVersion.id);
    } catch (err) {
      const message = err instanceof LockedVersionError ? 'Locked versions cannot be edited.' : err instanceof Error ? err.message : 'Could not create the draft.';
      toast({ title: message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
      {/* Version selector (draft-first) */}
      <Card>
        <CardBody>
          <div className="lf-dialogactions" style={{ justifyContent: 'space-between' }}>
            <h3 className="lf-envpanel__heading" style={{ margin: 0 }}>Model Builder</h3>
            <div className="lf-envcard__badges">
              {versions.slice(0, 4).map((version) => (
                <Button
                  key={version.id}
                  size="sm"
                  variant={version.id === (view?.version.id ?? '') ? 'primary' : 'ghost'}
                  onClick={() => {
                    setSelectedVersionId(version.id);
                    void loadView(version.id);
                  }}
                >
                  v{version.versionNumber} · {version.status}
                </Button>
              ))}
            </div>
          </div>
          <p className="lf-tile__description" style={{ margin: 0 }}>
            Models stay independently reusable — never tied to an environment, prop or campaign.
            Protected identity lives in the Character Sheet; styling attaches from the Library.
          </p>
        </CardBody>
      </Card>

      {loading ? (
        <Skeleton height={200} />
      ) : !view ? (
        <EmptyState title="No version yet" description="Create a draft to start building this model." />
      ) : (
        <>
          {/* Reference coverage panel */}
          <Card>
            <CardBody>
              <div className="lf-dialogactions" style={{ justifyContent: 'space-between' }}>
                <h4 style={{ margin: 0 }}>Reference coverage</h4>
                <div className="lf-envcard__badges">
                  <Badge tone={view.coverage.complete ? 'success' : 'warning'} dot>
                    {view.coverage.referenceCompleteness.replace('_', ' ')}
                  </Badge>
                  <Badge tone="neutral">
                    {view.coverage.requiredFilled}/{view.coverage.requiredTotal} required
                  </Badge>
                  <Badge tone={view.version.status === 'locked' ? 'primary' : 'neutral'} dot>
                    {view.version.status}
                  </Badge>
                </div>
              </div>
              <ul className="lf-sheet__trait-list" style={{ margin: 'var(--lf-space-2) 0 0' }}>
                {COVERAGE_SLOTS.map((slot) => {
                  const filled = view.coverage.slots.find((entry) => entry.key === slot.key)?.filled ?? false;
                  return (
                    <li key={slot.key} className="lf-sheet__trait-row">
                      <span className="lf-sheet__trait-key">
                        {filled ? '✓' : '○'} {slot.label}
                        {slot.required ? '' : ' (optional)'}
                      </span>
                      <span className="lf-sheet__trait-value">
                        {filled ? 'Added' : slot.required ? 'Missing — required' : 'Not provided'}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {view.coverage.missingRequired.length > 0 ? (
                <p className="lf-field__hint" role="alert" style={{ marginTop: 'var(--lf-space-2)' }}>
                  Missing required views: {view.coverage.missingRequired.join(', ')}.
                </p>
              ) : null}
            </CardBody>
          </Card>

          {/* Character Sheet identity summary */}
          <Card>
            <CardBody>
              <div className="lf-dialogactions" style={{ justifyContent: 'space-between' }}>
                <h4 style={{ margin: 0 }}>Character Sheet identity</h4>
                <Link className="lf-btn lf-btn--ghost lf-btn--sm" to={`${basePath}/character-sheet`}>
                  Open Character Sheet
                </Link>
              </div>
              {view.sheet && view.sheet.identitySummary ? (
                <>
                  <p className="lf-tile__description">{view.sheet.identitySummary}</p>
                  <p className="lf-field__hint">
                    <LockIcon size={12} /> Protected traits (face, hair, complexion, body,
                    distinctive details) only change through a draft → lock version flow.
                  </p>
                </>
              ) : (
                <p className="lf-tile__description">
                  Identity is incomplete — fill the Character Sheet before locking.
                </p>
              )}
            </CardBody>
          </Card>

          {/* References */}
          <Card>
            <CardBody>
              <div className="lf-dialogactions" style={{ justifyContent: 'space-between' }}>
                <h4 style={{ margin: 0 }}>References</h4>
                {!locked ? (
                  <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>Add reference</Button>
                ) : (
                  <Badge tone="primary" dot>Locked — immutable</Badge>
                )}
              </div>
              {view.references.length === 0 ? (
                <p className="lf-tile__description">No references yet.</p>
              ) : (
                <ul className="lf-sheet__trait-list" style={{ margin: 'var(--lf-space-2) 0 0' }}>
                  {view.references.map((entry) => (
                    <li key={entry.reference.id} className="lf-sheet__trait-row">
                      <span className="lf-sheet__trait-key">
                        {entry.roleLabel}
                        {entry.identityGoverned ? ' · identity' : ''}
                      </span>
                      <span className="lf-sheet__trait-value" style={{ display: 'inline-flex', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
                        {entry.reference.caption.replace(/^\[builder:[a-z_]+\]\s*/, '')}
                        {!locked ? (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleRemove(entry.reference.id)}>
                            Remove
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Readiness + lock actions */}
          <Card>
            <CardBody>
              <h4 style={{ margin: 0 }}>Readiness: {view.readiness.readiness.replace(/_/g, ' ')}</h4>
              {view.readiness.blockers.length > 0 ? (
                <ul className="lf-sheet__trait-list" style={{ margin: 'var(--lf-space-2) 0' }}>
                  {view.readiness.blockers.map((blocker) => (
                    <li key={blocker} className="lf-sheet__trait-row" role="alert">{blocker}</li>
                  ))}
                </ul>
              ) : (
                <p className="lf-tile__description">All checks pass — this draft can be locked.</p>
              )}
              <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
                <Button variant="secondary" disabled={busy || locked} onClick={() => void handleCheckReadiness()}>
                  Check readiness
                </Button>
                <Button variant="primary" disabled={busy || locked || view.readiness.readiness !== 'ready_to_lock'} onClick={() => void openLockDialog()}>
                  <LockIcon size={12} /> Lock-and-save
                </Button>
                {locked || draft ? (
                  <Button variant="ghost" disabled={busy} onClick={() => void handleCreateDraftFromLocked()}>
                    Create new draft from v{view.version.versionNumber}
                  </Button>
                ) : null}
              </div>
            </CardBody>
          </Card>
        </>
      )}

      {/* ── Import reference dialog ──────────────────────────────────────── */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Add reference"
        description="Label the role clearly. Identity roles feed the Character Sheet; supporting roles never overwrite protected identity."
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !importPath.trim()} onClick={() => void handleImport()}>Add</Button>
          </div>
        }
      >
        <div className="lf-formgrid">
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="ref-role">Reference role</label>
            <select
              id="ref-role"
              className="lf-input"
              value={importRole}
              onChange={(event) => setImportRole(event.target.value as ModelBuilderReferenceRole)}
            >
              {IMPORT_ROLES.map((entry) => (
                <option key={entry.role} value={entry.role}>
                  {REFERENCE_ROLE_LABELS[entry.role]}{entry.identity ? ' — identity' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="lf-field lf-field--full">
            <label className="lf-field__label" htmlFor="ref-path">Secured upload path</label>
            <input
              id="ref-path"
              className="lf-input"
              value={importPath}
              onChange={(event) => setImportPath(event.target.value)}
              placeholder="models/references/…"
            />
            <p className="lf-field__hint">Library import and secure uploads attach through controlled paths; private storage details are never exposed.</p>
          </div>
        </div>
      </Modal>

      {/* ── Lock-and-save confirmation ───────────────────────────────────── */}
      <Modal
        open={lockOpen}
        onClose={() => setLockOpen(false)}
        title="Lock-and-save this version"
        description="An explicit, immutable save point — review the snapshot before confirming."
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setLockOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!lockConfirmed || busy} onClick={() => void handleLock()}>
              {busy ? 'Locking…' : 'Lock version'}
            </Button>
          </div>
        }
      >
        {snapshot ? (
          <>
            <p className="lf-tile__description">
              <LockIcon size={12} /> Locked versions cannot be edited or re-locked. Future changes
              create a new draft version — the locked identity stays intact.
            </p>
            <ul className="lf-sheet__trait-list" style={{ margin: 'var(--lf-space-2) 0' }}>
              <li className="lf-sheet__trait-row">
                <span className="lf-sheet__trait-key">Version</span>
                <span className="lf-sheet__trait-value">v{snapshot.versionNumber}</span>
              </li>
              <li className="lf-sheet__trait-row">
                <span className="lf-sheet__trait-key">Identity</span>
                <span className="lf-sheet__trait-value">{snapshot.sheet?.identitySummary || '—'}</span>
              </li>
              <li className="lf-sheet__trait-row">
                <span className="lf-sheet__trait-key">Coverage</span>
                <span className="lf-sheet__trait-value">
                  {snapshot.coverageSummary.requiredFilled}/{snapshot.coverageSummary.requiredTotal} required · {snapshot.coverageSummary.referenceCompleteness.replace('_', ' ')}
                </span>
              </li>
              <li className="lf-sheet__trait-row">
                <span className="lf-sheet__trait-key">References</span>
                <span className="lf-sheet__trait-value">{snapshot.references.length} labeled</span>
              </li>
            </ul>
            <label className="lf-envlock__rights" htmlFor="lock-confirm">
              <input
                id="lock-confirm"
                type="checkbox"
                checked={lockConfirmed}
                onChange={(event) => setLockConfirmed(event.target.checked)}
              />
              <span>I understand this locked version cannot be destructively edited.</span>
            </label>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
