/**
 * Environment Builder tab — prompt 33.
 *
 * The Environment Builder workspace: labeled reference import, honest
 * coverage, Library prop/asset attachment (pointers, reversible), reusable
 * environment-specific camera views, readiness and the explicit
 * lock-and-save confirmation with its pre-lock snapshot. Locked versions
 * are visibly immutable — changes route through "create draft from locked".
 *
 * Talks ONLY to EnvironmentBuilderService + EnvironmentsService (never
 * Storage, never OAuth, never provider code). Private storage paths never
 * render. Environments stay independent from models by construction.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { LockIcon } from '../../components/icons';
import {
  EnvironmentBuilderService,
  InMemoryEnvironmentBuilderAuditStore,
  InMemoryEnvironmentCameraViewStore,
  InMemoryEnvironmentAssetLinkStore,
} from '../../environments/environmentBuilderService';
import type {
  EnvironmentBuilderView,
  EnvironmentVersionSnapshot,
} from '../../environments/environmentBuilderService';
import {
  CAMERA_MOVEMENT_LABELS,
  ENVIRONMENT_COVERAGE_SLOTS,
  ENVIRONMENT_REFERENCE_ROLE_LABELS,
} from '../../environments/environmentBuilderWorkflow';
import type {
  EnvironmentBuilderReferenceRole,
  EnvironmentCameraViewRecord,
} from '../../environments/environmentBuilderWorkflow';
import { EnvironmentsService } from '../../services/environmentsService';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { LibraryService } from '../../services/libraryService';
import { getLibraryRepository } from '../../data/libraryFactory';
import { SEED_ENVIRONMENT_WORKSPACE_ID } from '../../mock/environmentsSeed';
import { useEnvironmentOutletContext } from './tabRoutes';

const ACTOR = 'demo-user';

/** Shared stores (remount-survival, same pattern as the app). */
let auditStoreInstance: InMemoryEnvironmentBuilderAuditStore | null = null;
function getAuditStore(): InMemoryEnvironmentBuilderAuditStore {
  if (!auditStoreInstance) auditStoreInstance = new InMemoryEnvironmentBuilderAuditStore();
  return auditStoreInstance;
}
let cameraStoreInstance: InMemoryEnvironmentCameraViewStore | null = null;
function getCameraStore(): InMemoryEnvironmentCameraViewStore {
  if (!cameraStoreInstance) cameraStoreInstance = new InMemoryEnvironmentCameraViewStore();
  return cameraStoreInstance;
}
let assetLinkStoreInstance: InMemoryEnvironmentAssetLinkStore | null = null;
function getAssetLinkStore(): InMemoryEnvironmentAssetLinkStore {
  if (!assetLinkStoreInstance) assetLinkStoreInstance = new InMemoryEnvironmentAssetLinkStore();
  return assetLinkStoreInstance;
}

interface BuilderServiceArgs {
  service: EnvironmentsService;
}

/** Shared EnvironmentBuilderService over the app's environments service. */
function useEnvironmentBuilderService(args: BuilderServiceArgs): EnvironmentBuilderService {
  const { service } = args;
  return useMemo(() => {
    const library = new LibraryService(getLibraryRepository());
    const deps = {
      getLibraryAsset: async (assetId: string, workspaceId: string) => {
        const asset = await library.getAsset(assetId, workspaceId);
        return { id: asset.id, workspaceId, name: asset.name, storagePath: asset.coverImagePath };
      },
    };
    return new EnvironmentBuilderService(
      service,
      getEnvironmentsRepository(),
      deps,
      getAuditStore(),
      getCameraStore(),
      getAssetLinkStore(),
    );
  }, [service]);
}

/** Roles offered in the import dialog. */
const IMPORT_ROLES: EnvironmentBuilderReferenceRole[] = [
  'primary_environment', 'layout', 'lighting_mood', 'material_color',
  'prop_furnishing', 'camera_view', 'supporting_inspiration',
];

const ASSET_CATEGORIES: Array<{ key: 'furniture' | 'prop' | 'lighting' | 'decor' | 'product' | 'other'; label: string }> = [
  { key: 'furniture', label: 'Furniture' },
  { key: 'prop', label: 'Prop' },
  { key: 'lighting', label: 'Lighting' },
  { key: 'decor', label: 'Decor' },
  { key: 'product', label: 'Product' },
  { key: 'other', label: 'Other' },
];

export function EnvironmentBuilderTab() {
  const { service, data } = useEnvironmentOutletContext();
  const { toast } = useToast();
  const builder = useEnvironmentBuilderService({ service });

  const environment = data.environment;
  const versions = data.versions;
  const draft = useMemo(() => versions.find((version) => version.status === 'draft') ?? null, [versions]);

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [view, setView] = useState<EnvironmentBuilderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Import dialog
  const [importOpen, setImportOpen] = useState(false);
  const [importRole, setImportRole] = useState<EnvironmentBuilderReferenceRole>('primary_environment');
  const [importPath, setImportPath] = useState('');

  // Asset dialog
  const [assetOpen, setAssetOpen] = useState(false);
  const [assetCategory, setAssetCategory] = useState<'furniture' | 'prop' | 'lighting' | 'decor' | 'product' | 'other'>('prop');
  const [libraryAssetId, setLibraryAssetId] = useState('');
  const [libraryOptions, setLibraryOptions] = useState<Array<{ id: string; name: string }>>([]);

  // Camera view dialog
  const [viewOpen, setViewOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [viewAngle, setViewAngle] = useState('');
  const [viewMovement, setViewMovement] = useState<'static' | 'dolly_in' | 'dolly_out' | 'trolley_left' | 'trolley_right'>('static');

  // Lock confirm
  const [lockOpen, setLockOpen] = useState(false);
  const [lockConfirmed, setLockConfirmed] = useState(false);
  const [snapshot, setSnapshot] = useState<EnvironmentVersionSnapshot | null>(null);

  const loadView = useCallback(async (versionId: string) => {
    setView(await builder.getEnvironmentBuilderView(SEED_ENVIRONMENT_WORKSPACE_ID, versionId));
  }, [builder]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const target = selectedVersionId ?? draft?.id ?? versions[0]?.id ?? null;
      setSelectedVersionId(target);
      setView(target ? await builder.getEnvironmentBuilderView(SEED_ENVIRONMENT_WORKSPACE_ID, target) : null);
    } finally {
      setLoading(false);
    }
  }, [builder, selectedVersionId, draft?.id, versions]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment?.id]);

  if (!environment) return null;
  const locked = view?.version.status === 'locked';

  function openAssetDialog() {
    setAssetOpen(true);
    if (libraryOptions.length === 0) {
      new LibraryService(getLibraryRepository())
        .listAssets(SEED_ENVIRONMENT_WORKSPACE_ID)
        .then((rows) => setLibraryOptions(rows.map((row) => ({ id: row.id, name: row.name }))))
        .catch(() => setLibraryOptions([]));
    }
  }

  async function handleImport() {
    if (!view || busy || !importPath.trim()) return;
    setBusy(true);
    try {
      await builder.attachEnvironmentReference(SEED_ENVIRONMENT_WORKSPACE_ID, view.version.id, {
        role: importRole,
        source: { kind: 'upload', storagePath: importPath.trim() },
      }, ACTOR);
      toast({ title: `${ENVIRONMENT_REFERENCE_ROLE_LABELS[importRole]} reference added.`, tone: 'success' });
      setImportOpen(false);
      setImportPath('');
      await loadView(view.version.id);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not add the reference.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveReference(referenceId: string) {
    if (!view || busy) return;
    setBusy(true);
    try {
      await builder.removeEnvironmentReference(SEED_ENVIRONMENT_WORKSPACE_ID, view.version.id, referenceId);
      await loadView(view.version.id);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not remove the reference.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleAttachAsset() {
    if (!view || busy || !libraryAssetId) return;
    setBusy(true);
    try {
      await builder.attachEnvironmentAsset(SEED_ENVIRONMENT_WORKSPACE_ID, view.version.id, {
        libraryAssetId,
        category: assetCategory,
      }, ACTOR);
      toast({ title: 'Asset attached as a Library pointer — reversible.', tone: 'success' });
      setAssetOpen(false);
      setLibraryAssetId('');
      await loadView(view.version.id);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not attach the asset.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveAsset(linkId: string) {
    if (!view || busy) return;
    setBusy(true);
    try {
      await builder.removeEnvironmentAsset(SEED_ENVIRONMENT_WORKSPACE_ID, view.version.id, linkId);
      await loadView(view.version.id);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not remove the asset.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCameraView() {
    if (!view || busy || !viewName.trim()) return;
    setBusy(true);
    try {
      await builder.saveEnvironmentCameraView(SEED_ENVIRONMENT_WORKSPACE_ID, view.version.id, {
        name: viewName,
        angle: viewAngle || null,
        movement: viewMovement,
      }, ACTOR);
      toast({ title: 'Camera view saved for this environment.', tone: 'success' });
      setViewOpen(false);
      setViewName('');
      setViewAngle('');
      await loadView(view.version.id);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not save the camera view.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function openLockDialog() {
    if (!view || busy) return;
    setBusy(true);
    try {
      const check = await builder.validateEnvironmentReadinessForLock(SEED_ENVIRONMENT_WORKSPACE_ID, view.version.id);
      if (!check.ok) {
        toast({ title: `Cannot lock yet: ${check.blockers[0]}`, tone: 'error' });
        return;
      }
      setSnapshot(await builder.getEnvironmentVersionSnapshot(SEED_ENVIRONMENT_WORKSPACE_ID, view.version.id));
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
      const { version } = await builder.lockAndSaveEnvironmentVersion(SEED_ENVIRONMENT_WORKSPACE_ID, view.version.id, ACTOR);
      toast({ title: `v${version.versionNumber} locked — this environment stays stable for every generation set using it.`, tone: 'success' });
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
      const draftVersion = await builder.createEnvironmentDraftFromLockedVersion(SEED_ENVIRONMENT_WORKSPACE_ID, view.version.id, ACTOR);
      toast({ title: `Draft v${draftVersion.versionNumber} created — repaint, rearrange or relight there.`, tone: 'success' });
      setSelectedVersionId(draftVersion.id);
      await loadView(draftVersion.id);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not create the draft.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
      {/* Version selector */}
      <Card>
        <CardBody>
          <div className="lf-dialogactions" style={{ justifyContent: 'space-between' }}>
            <h3 className="lf-envpanel__heading" style={{ margin: 0 }}>Environment Builder</h3>
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
            Environments are independently reusable locations — never tied to a model. Locked
            versions stay visually stable across every generation set that uses them.
          </p>
        </CardBody>
      </Card>

      {loading ? (
        <Skeleton height={200} />
      ) : !view ? (
        <EmptyState title="No version yet" description="Create a draft to start building this environment." />
      ) : (
        <>
          {/* Coverage panel */}
          <Card>
            <CardBody>
              <div className="lf-dialogactions" style={{ justifyContent: 'space-between' }}>
                <h4 style={{ margin: 0 }}>Reference coverage</h4>
                <div className="lf-envcard__badges">
                  <Badge tone={view.coverage.missingRequired.length === 0 ? 'success' : 'warning'} dot>
                    {view.coverage.referenceCompleteness.replace('_', ' ')}
                  </Badge>
                  <Badge tone="neutral">{view.coverage.requiredFilled}/{view.coverage.requiredTotal} required</Badge>
                  <Badge tone={locked ? 'primary' : 'neutral'} dot>{view.version.status}</Badge>
                </div>
              </div>
              <ul className="lf-sheet__trait-list" style={{ margin: 'var(--lf-space-2) 0 0' }}>
                {ENVIRONMENT_COVERAGE_SLOTS.map((slot) => {
                  const filled = view.coverage.slots.find((entry) => entry.key === slot.key)?.filled ?? false;
                  return (
                    <li key={slot.key} className="lf-sheet__trait-row">
                      <span className="lf-sheet__trait-key">
                        {filled ? '✓' : '○'} {slot.label}{slot.required ? '' : ' (optional)'}
                      </span>
                      <span className="lf-sheet__trait-value">
                        {filled ? 'Added' : slot.required ? 'Missing — required' : 'Not provided'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>

          {/* Environment definition */}
          <Card>
            <CardBody>
              <h4 style={{ margin: 0 }}>Environment definition</h4>
              {view.spec ? (
                <ul className="lf-sheet__trait-list" style={{ margin: 'var(--lf-space-2) 0 0' }}>
                  <li className="lf-sheet__trait-row"><span className="lf-sheet__trait-key">Room type</span><span className="lf-sheet__trait-value">{view.spec.roomType || '—'}</span></li>
                  <li className="lf-sheet__trait-row"><span className="lf-sheet__trait-key">Layout feel</span><span className="lf-sheet__trait-value">{view.spec.layoutFeel || '—'}</span></li>
                  <li className="lf-sheet__trait-row"><span className="lf-sheet__trait-key">Hero angle</span><span className="lf-sheet__trait-value">{view.spec.heroAngle || '—'}</span></li>
                  <li className="lf-sheet__trait-row"><span className="lf-sheet__trait-key">Lighting</span><span className="lf-sheet__trait-value">{view.spec.lightingStyle || '—'}</span></li>
                </ul>
              ) : (
                <p className="lf-tile__description">No spec yet — fill the defining anchors on the Environment Specs tab.</p>
              )}
              <div className="lf-dialogactions" style={{ justifyContent: 'flex-start', marginTop: 'var(--lf-space-2)' }}>
                {!locked ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>Add reference</Button>
                    <Button size="sm" variant="ghost" onClick={() => openAssetDialog()}>Attach Library asset</Button>
                    <Button size="sm" variant="ghost" onClick={() => setViewOpen(true)}>Save camera view</Button>
                  </>
                ) : (
                  <Badge tone="primary" dot>Locked — immutable</Badge>
                )}
              </div>
            </CardBody>
          </Card>

          {/* References */}
          <Card>
            <CardBody>
              <h4 style={{ margin: 0 }}>References</h4>
              {view.references.length === 0 ? (
                <p className="lf-tile__description">No references yet.</p>
              ) : (
                <ul className="lf-sheet__trait-list" style={{ margin: 'var(--lf-space-2) 0 0' }}>
                  {view.references.map((entry) => (
                    <li key={entry.reference.id} className="lf-sheet__trait-row">
                      <span className="lf-sheet__trait-key">
                        {entry.roleLabel}{entry.defining ? ' · defining' : ''}
                      </span>
                      <span className="lf-sheet__trait-value" style={{ display: 'inline-flex', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
                        {entry.reference.caption.replace(/^\[envbuilder:[a-z_]+\]\s*/, '')}
                        {!locked ? (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleRemoveReference(entry.reference.id)}>Remove</Button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Attached assets */}
          <Card>
            <CardBody>
              <h4 style={{ margin: 0 }}>Attached props & assets</h4>
              <p className="lf-field__hint" style={{ margin: '2px 0 0' }}>
                Library pointers only — inspectable and reversible; environment assets are separate
                from model assets.
              </p>
              {view.assets.length === 0 ? (
                <p className="lf-tile__description">No assets attached yet.</p>
              ) : (
                <ul className="lf-sheet__trait-list" style={{ margin: 'var(--lf-space-2) 0 0' }}>
                  {view.assets.map((link) => (
                    <li key={link.id} className="lf-sheet__trait-row">
                      <span className="lf-sheet__trait-key">{link.category}</span>
                      <span className="lf-sheet__trait-value" style={{ display: 'inline-flex', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
                        {link.libraryAssetId.slice(0, 12)}…
                        {!locked ? (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleRemoveAsset(link.id)}>Remove</Button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Camera views */}
          <Card>
            <CardBody>
              <h4 style={{ margin: 0 }}>Camera / views</h4>
              <p className="lf-field__hint" style={{ margin: '2px 0 0' }}>
                Environment-specific staging metadata — never model identity traits.
              </p>
              {view.cameraViews.length === 0 ? (
                <p className="lf-tile__description">No saved views yet.</p>
              ) : (
                <ul className="lf-sheet__trait-list" style={{ margin: 'var(--lf-space-2) 0 0' }}>
                  {view.cameraViews.map((cameraView: EnvironmentCameraViewRecord) => (
                    <li key={cameraView.id} className="lf-sheet__trait-row">
                      <span className="lf-sheet__trait-key">{cameraView.name}</span>
                      <span className="lf-sheet__trait-value">
                        {cameraView.angle ?? '—'}
                        {cameraView.movement ? ` · ${CAMERA_MOVEMENT_LABELS[cameraView.movement]}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Readiness + lock */}
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
                <Button variant="primary" disabled={busy || locked || view.readiness.readiness !== 'ready_to_lock'} onClick={() => void openLockDialog()}>
                  <LockIcon size={12} /> Lock-and-save
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void handleCreateDraftFromLocked()}>
                  Create new draft from v{view.version.versionNumber}
                </Button>
              </div>
            </CardBody>
          </Card>
        </>
      )}

      {/* ── Import reference dialog ──────────────────────────────────────── */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Add environment reference"
        description="Label the role clearly. Defining roles anchor the environment; inspiration never overwrites it."
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !importPath.trim()} onClick={() => void handleImport()}>Add</Button>
          </div>
        }
      >
        <div className="lf-formgrid">
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="envref-role">Reference role</label>
            <select
              id="envref-role"
              className="lf-input"
              value={importRole}
              onChange={(event) => setImportRole(event.target.value as EnvironmentBuilderReferenceRole)}
            >
              {IMPORT_ROLES.map((role) => (
                <option key={role} value={role}>{ENVIRONMENT_REFERENCE_ROLE_LABELS[role]}</option>
              ))}
            </select>
          </div>
          <div className="lf-field lf-field--full">
            <label className="lf-field__label" htmlFor="envref-path">Secured upload path</label>
            <input
              id="envref-path"
              className="lf-input"
              value={importPath}
              onChange={(event) => setImportPath(event.target.value)}
              placeholder="environments/references/…"
            />
            <p className="lf-field__hint">Private storage details are never exposed.</p>
          </div>
        </div>
      </Modal>

      {/* ── Attach asset dialog ──────────────────────────────────────────── */}
      <Modal
        open={assetOpen}
        onClose={() => setAssetOpen(false)}
        title="Attach Library asset"
        description="Pointers only — the asset stays in the Library and the attachment is reversible."
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setAssetOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !libraryAssetId} onClick={() => void handleAttachAsset()}>Attach</Button>
          </div>
        }
      >
        <div className="lf-formgrid">
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="envasset-category">Role in this environment</label>
            <select
              id="envasset-category"
              className="lf-input"
              value={assetCategory}
              onChange={(event) => setAssetCategory(event.target.value as typeof assetCategory)}
            >
              {ASSET_CATEGORIES.map((category) => (
                <option key={category.key} value={category.key}>{category.label}</option>
              ))}
            </select>
          </div>
          <div className="lf-field lf-field--full">
            <label className="lf-field__label" htmlFor="envasset-id">Library asset</label>
            <select
              id="envasset-id"
              className="lf-input"
              value={libraryAssetId}
              onChange={(event) => setLibraryAssetId(event.target.value)}
            >
              <option value="">Choose a Library asset…</option>
              {libraryOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </div>
        </div>
      </Modal>

      {/* ── Camera view dialog ───────────────────────────────────────────── */}
      <Modal
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        title="Save camera view"
        description="A reusable view of this environment — angle and optional movement metadata."
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setViewOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !viewName.trim()} onClick={() => void handleSaveCameraView()}>Save view</Button>
          </div>
        }
      >
        <div className="lf-formgrid">
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="envview-name">View name</label>
            <input id="envview-name" className="lf-input" maxLength={80} value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="Hero north window" />
          </div>
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="envview-movement">Movement</label>
            <select id="envview-movement" className="lf-input" value={viewMovement} onChange={(event) => setViewMovement(event.target.value as typeof viewMovement)}>
              {Object.entries(CAMERA_MOVEMENT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className="lf-field lf-field--full">
            <label className="lf-field__label" htmlFor="envview-angle">Angle / framing notes</label>
            <input id="envview-angle" className="lf-input" maxLength={500} value={viewAngle} onChange={(event) => setViewAngle(event.target.value)} placeholder="Eye level, wide, from the north window" />
          </div>
        </div>
      </Modal>

      {/* ── Lock-and-save confirmation ───────────────────────────────────── */}
      <Modal
        open={lockOpen}
        onClose={() => setLockOpen(false)}
        title="Lock-and-save this environment version"
        description="An explicit, immutable save point — review the exact configuration before confirming."
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
              <LockIcon size={12} /> Locked versions stay visually stable across every generation
              set that uses them. Future changes create a new draft — the locked environment never
              changes.
            </p>
            <ul className="lf-sheet__trait-list" style={{ margin: 'var(--lf-space-2) 0' }}>
              <li className="lf-sheet__trait-row"><span className="lf-sheet__trait-key">Version</span><span className="lf-sheet__trait-value">v{snapshot.versionNumber} · {snapshot.lockLevel} lock</span></li>
              <li className="lf-sheet__trait-row"><span className="lf-sheet__trait-key">Room</span><span className="lf-sheet__trait-value">{snapshot.spec?.roomType || '—'} · {snapshot.spec?.lightingStyle || '—'}</span></li>
              <li className="lf-sheet__trait-row"><span className="lf-sheet__trait-key">Coverage</span><span className="lf-sheet__trait-value">{snapshot.coverageSummary.requiredFilled}/{snapshot.coverageSummary.requiredTotal} required</span></li>
              <li className="lf-sheet__trait-row"><span className="lf-sheet__trait-key">References</span><span className="lf-sheet__trait-value">{snapshot.references.length} labeled</span></li>
              <li className="lf-sheet__trait-row"><span className="lf-sheet__trait-key">Assets / views</span><span className="lf-sheet__trait-value">{snapshot.assets.length} attached · {snapshot.cameraViews.length} saved views</span></li>
            </ul>
            <label className="lf-envlock__rights" htmlFor="envlock-confirm">
              <input
                id="envlock-confirm"
                type="checkbox"
                checked={lockConfirmed}
                onChange={(event) => setLockConfirmed(event.target.checked)}
              />
              <span>I understand this locked environment version cannot be destructively edited.</span>
            </label>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
