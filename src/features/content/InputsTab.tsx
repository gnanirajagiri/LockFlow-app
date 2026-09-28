/**
 * Inputs tab — selects canonical reusable inputs (never copies): primary
 * model + version, optional environment + version, optional Look (whose
 * model must match the primary model), and shared Library assets with roles.
 * Shows lock states, Character Sheet / anchor summaries and a continuity
 * sidebar. All writes go through the Content Studio service.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import type {
  ContentInputRole,
  ContentProjectInputRecord,
  ResolvedProjectInput,
} from '../../domain/content';
import type {
  CharacterSheetRecord,
  ModelRecord,
  ModelVersionRecord,
} from '../../domain/models';
import type { EnvironmentRecord, EnvironmentSpecRecord, EnvironmentVersionRecord } from '../../domain/environments';
import type { LibraryAssetRecord, LibraryAssetVersionRecord, LookAssetItemRecord } from '../../domain/library';
import { useContentProjectOutletContext } from './tabRoutes';

const SHARED_ASSET_TYPES = new Set([
  'product', 'prop', 'wardrobe', 'accessory', 'personal_item', 'creator_tool', 'brand_asset', 'reference', 'scene',
]);

function LockBadge({ status }: { status: string }) {
  if (status === 'locked') return <Badge tone="locked">locked</Badge>;
  if (status === 'draft') return <Badge tone="warning">draft</Badge>;
  return <Badge tone="neutral">{status}</Badge>;
}

export function InputsTab() {
  const { toast } = useToast();
  const { service, data } = useContentProjectOutletContext();
  const project = data.project;
  const workspaceId = SEED_CONTENT_WORKSPACE_ID;

  const library = useMemo(() => new LibraryService(getLibraryRepository()), []);
  const modelsService = useMemo(() => new ModelsService(getModelsRepository()), []);
  const environmentsService = useMemo(() => new EnvironmentsService(getEnvironmentsRepository()), []);

  // Catalog data (canonical records; read-only).
  const [models, setModels] = useState<ModelRecord[] | null>(null);
  const [environments, setEnvironments] = useState<EnvironmentRecord[] | null>(null);
  const [libraryAssets, setLibraryAssets] = useState<LibraryAssetRecord[] | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [environmentSearch, setEnvironmentSearch] = useState('');
  const [assetSearch, setAssetSearch] = useState('');

  // Version detail per selected input id.
  const [modelVersions, setModelVersions] = useState<ModelVersionRecord[] | null>(null);
  const [modelSheet, setModelSheet] = useState<CharacterSheetRecord | null>(null);
  const [environmentVersions, setEnvironmentVersions] = useState<EnvironmentVersionRecord[] | null>(null);
  const [environmentSpec, setEnvironmentSpec] = useState<EnvironmentSpecRecord | null>(null);
  const [lookItems, setLookItems] = useState<LookAssetItemRecord[] | null>(null);
  const [lookItemAssets, setLookItemAssets] = useState<Record<string, { asset: LibraryAssetRecord; version: LibraryAssetVersionRecord | null }>>({});

  const [resolved, setResolved] = useState<ResolvedProjectInput[] | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const isDraft = project?.status === 'draft';
  const modelInput = project ? data.inputs.find((entry) => entry.inputType === 'model') : undefined;
  const environmentInput = project ? data.inputs.find((entry) => entry.inputType === 'environment') : undefined;
  const lookInput = project ? data.inputs.find((entry) => entry.inputType === 'look') : undefined;
  const sharedInputs = useMemo(
    () => data.inputs.filter((entry) => entry.inputType === 'library_asset'),
    [data.inputs],
  );

  const loadCatalog = useCallback(async () => {
    try {
      const [modelList, environmentList, assets] = await Promise.all([
        modelsService.listModels(workspaceId),
        environmentsService.listEnvironments(workspaceId),
        library.listAssets(workspaceId),
      ]);
      setModels(modelList);
      setEnvironments(environmentList);
      setLibraryAssets(assets);
    } catch {
      setModels((current) => current ?? []);
      setEnvironments((current) => current ?? []);
      setLibraryAssets((current) => current ?? []);
    }
  }, [environmentsService, library, modelsService, workspaceId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const refreshResolution = useCallback(async () => {
    if (!project) return;
    try {
      const entries = await service.resolveProjectInputs(project.id, workspaceId);
      setResolved(entries);
      setProblems(await service.validateExecutionReadiness(project.id, workspaceId));
    } catch (err) {
      setResolved(null);
      setProblems([err instanceof Error ? err.message : 'Could not resolve inputs.']);
    }
  }, [project, service, workspaceId]);

  useEffect(() => {
    void refreshResolution();
  }, [refreshResolution, data.inputs]);

  // Character Sheet for the selected model version.
  useEffect(() => {
    if (!modelInput?.modelVersionId) return;
    let cancelled = false;
    modelsService
      .getCharacterSheet(modelInput.modelVersionId, workspaceId)
      .then((sheet) => {
        if (!cancelled) setModelSheet(sheet);
      })
      .catch(() => {
        if (!cancelled) setModelSheet(null);
      });
    return () => {
      cancelled = true;
    };
  }, [modelInput?.modelVersionId, modelsService, workspaceId]);

  // Environment versions + spec for the selected environment.
  useEffect(() => {
    if (!environmentInput?.environmentId) {
      setEnvironmentVersions(null);
      setEnvironmentSpec(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const versions = await environmentsService
        .getVersions(environmentInput.environmentId!, workspaceId)
        .catch(() => null);
      if (!cancelled) setEnvironmentVersions(versions);
      const target = versions?.find((version) => version.id === environmentInput.environmentVersionId);
      if (target) {
        const spec = await environmentsService.getSpec(target.id, workspaceId).catch(() => null);
        if (!cancelled) setEnvironmentSpec(spec);
      } else if (!cancelled) {
        setEnvironmentSpec(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [environmentInput?.environmentId, environmentInput?.environmentVersionId, environmentsService, workspaceId]);

  // Model versions for the selected model.
  useEffect(() => {
    if (!modelInput?.modelId) {
      setModelVersions(null);
      return;
    }
    let cancelled = false;
    modelsService
      .getVersions(modelInput.modelId, workspaceId)
      .then((versions) => {
        if (!cancelled) setModelVersions(versions);
      })
      .catch(() => {
        if (!cancelled) setModelVersions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [modelInput?.modelId, modelsService, workspaceId]);

  // Look items + their asset/version lock states.
  useEffect(() => {
    if (!lookInput?.libraryAssetVersionId) {
      setLookItems(null);
      setLookItemAssets({});
      return;
    }
    let cancelled = false;
    (async () => {
      const details = await library.getLookDetails(lookInput.libraryAssetVersionId!, workspaceId).catch(() => null);
      if (!details) {
        if (!cancelled) {
          setLookItems([]);
          setLookItemAssets({});
        }
        return;
      }
      const items = await library.getLookItems(details.id, workspaceId).catch(() => []);
      const itemMap: Record<string, { asset: LibraryAssetRecord; version: LibraryAssetVersionRecord | null }> = {};
      for (const item of items) {
        const asset = await library.getAsset(item.libraryAssetId, workspaceId).catch(() => null);
        const versionId = item.libraryAssetVersionId ?? asset?.activeVersionId ?? null;
        const version = versionId
          ? await library.getVersion(versionId, workspaceId).catch(() => null)
          : null;
        if (asset) itemMap[item.id] = { asset, version };
      }
      if (!cancelled) {
        setLookItems(items);
        setLookItemAssets(itemMap);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [library, lookInput?.libraryAssetVersionId, workspaceId]);

  if (!project) return null;

  async function act(action: () => Promise<void>, successMessage: string) {
    setBusy(true);
    try {
      await action();
      toast({ title: successMessage, tone: 'success' });
      await data.reload();
      await refreshResolution();
    } catch (err) {
      toast({
        title: 'Not allowed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function addInput(payload: Record<string, unknown>, message: string) {
    await act(async () => {
      await service.addProjectInput({ contentProjectId: project!.id, ...payload }, workspaceId);
    }, message);
  }

  const filteredModels = (models ?? []).filter((model) =>
    model.name.toLowerCase().includes(modelSearch.trim().toLowerCase()),
  );
  const filteredEnvironments = (environments ?? []).filter((environment) =>
    environment.name.toLowerCase().includes(environmentSearch.trim().toLowerCase()),
  );
  const filteredAssets = (libraryAssets ?? []).filter(
    (asset) =>
      SHARED_ASSET_TYPES.has(asset.assetType) &&
      asset.name.toLowerCase().includes(assetSearch.trim().toLowerCase()),
  );

  const selectedModel = models?.find((model) => model.id === modelInput?.modelId) ?? null;
  const selectedEnvironment = environments?.find((environment) => environment.id === environmentInput?.environmentId) ?? null;
  const selectedLookAsset =
    lookInput?.libraryAssetId
      ? (libraryAssets ?? []).find((asset) => asset.id === lookInput.libraryAssetId) ?? null
      : null;

  const continuityReady = problems !== null && problems.length === 0;

  return (
    <div className="lf-envprofile__layout">
      <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
        {/* 1. Primary model ─────────────────────────────────────────────── */}
        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Primary model</h3>
            <p className="lf-tile__description">
              Selected from Models — canonical and independently reusable. Selecting a model here
              never changes its protected Character Sheet.
            </p>
            <Input
              label="Search models"
              hideLabel
              placeholder="Search models…"
              value={modelSearch}
              onChange={(event) => setModelSearch(event.target.value)}
              type="search"
            />
            {models === null ? (
              <Skeleton lines={2} />
            ) : (
              <div className="lf-library__assetpick" role="listbox" aria-label="Models">
                {filteredModels.map((model) => {
                  const selected = model.id === modelInput?.modelId;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className="lf-library__assetoption"
                      disabled={!isDraft || busy || selected}
                      onClick={() =>
                        void addInput(
                          { inputType: 'model', modelId: model.id, modelVersionId: model.activeVersionId, role: 'primary_model' },
                          `${model.name} selected`,
                        )
                      }
                    >
                      <span>{model.name}</span>
                      <span className="lf-library__assetoptionmeta">{selected ? 'selected' : 'select'}</span>
                    </button>
                  );
                })}
                {filteredModels.length === 0 ? <p className="lf-tile__description">No models match.</p> : null}
              </div>
            )}

            {modelInput ? (
              <div className="lf-section" style={{ gap: 'var(--lf-space-2)', marginTop: 'var(--lf-space-3)' }}>
                <div className="lf-envcard__badges">
                  <strong>{selectedModel?.name ?? modelInput.modelId}</strong>
                  {modelVersions === null ? (
                    <Skeleton lines={1} />
                  ) : (
                    modelVersions.map((version) => (
                      <button
                        key={version.id}
                        type="button"
                        className="lf-btn lf-btn--sm"
                        disabled={!isDraft || busy || version.id === modelInput.modelVersionId}
                        onClick={() =>
                          void act(async () => {
                            await service.removeProjectInput(modelInput.id, workspaceId);
                            await service.addProjectInput(
                              {
                                contentProjectId: project.id,
                                inputType: 'model',
                                modelId: modelInput.modelId!,
                                modelVersionId: version.id,
                                role: 'primary_model',
                              },
                              workspaceId,
                            );
                          }, `v${version.versionNumber} selected`)
                        }
                      >
                        v{version.versionNumber} <LockBadge status={version.status} />
                      </button>
                    ))
                  )}
                </div>
                {modelVersions?.some((version) => version.id === modelInput.modelVersionId && version.status !== 'locked') ? (
                  <p className="lf-library__warning" role="note">
                    A draft model version is selected for planning. It must be locked before job
                    preparation — locking happens in Models, never here.
                  </p>
                ) : null}
                <details className="lf-sheet__section">
                  <summary style={{ cursor: 'pointer' }}>Identity protection summary</summary>
                  {modelSheet ? (
                    <p className="lf-tile__description">
                      {modelSheet.identitySummary?.trim() !== ''
                        ? modelSheet.identitySummary
                        : 'The Character Sheet is identity-only: face, hair, complexion, body proportions and distinctive details. Clothing and props attach from the Library; they are never identity traits.'}
                    </p>
                  ) : (
                    <Skeleton lines={1} />
                  )}
                </details>
                {isDraft ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void act(() => service.removeProjectInput(modelInput.id, workspaceId), 'Model removed')}
                  >
                    Remove model
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>

        {/* 2. Environment (optional) ────────────────────────────────────── */}
        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Environment (optional)</h3>
            <p className="lf-tile__description">
              Selected from Environments. The environment is never permanently tied to the model —
              this plan only references both at job time.
            </p>
            <Input
              label="Search environments"
              hideLabel
              placeholder="Search environments…"
              value={environmentSearch}
              onChange={(event) => setEnvironmentSearch(event.target.value)}
              type="search"
            />
            {environments === null ? (
              <Skeleton lines={2} />
            ) : (
              <div className="lf-library__assetpick" role="listbox" aria-label="Environments">
                {filteredEnvironments.map((environment) => {
                  const selected = environment.id === environmentInput?.environmentId;
                  return (
                    <button
                      key={environment.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className="lf-library__assetoption"
                      disabled={!isDraft || busy || selected}
                      onClick={() =>
                        void addInput(
                          {
                            inputType: 'environment',
                            environmentId: environment.id,
                            environmentVersionId: environment.activeVersionId,
                            role: 'environment',
                          },
                          `${environment.name} selected`,
                        )
                      }
                    >
                      <span>{environment.name}</span>
                      <span className="lf-library__assetoptionmeta">{selected ? 'selected' : 'select'}</span>
                    </button>
                  );
                })}
                {filteredEnvironments.length === 0 ? <p className="lf-tile__description">No environments match.</p> : null}
              </div>
            )}

            {environmentInput ? (
              <div className="lf-section" style={{ gap: 'var(--lf-space-2)', marginTop: 'var(--lf-space-3)' }}>
                <div className="lf-envcard__badges">
                  <strong>{selectedEnvironment?.name ?? environmentInput.environmentId}</strong>
                  {environmentVersions === null ? (
                    <Skeleton lines={1} />
                  ) : (
                    environmentVersions.map((version) => (
                      <button
                        key={version.id}
                        type="button"
                        className="lf-btn lf-btn--sm"
                        disabled={!isDraft || busy || version.id === environmentInput.environmentVersionId}
                        onClick={() =>
                          void act(async () => {
                            await service.removeProjectInput(environmentInput.id, workspaceId);
                            await service.addProjectInput(
                              {
                                contentProjectId: project.id,
                                inputType: 'environment',
                                environmentId: environmentInput.environmentId!,
                                environmentVersionId: version.id,
                                role: 'environment',
                              },
                              workspaceId,
                            );
                          }, `v${version.versionNumber} selected`)
                        }
                      >
                        v{version.versionNumber} <LockBadge status={version.status} />
                        {version.status === 'locked' ? <Badge tone="neutral">{version.lockLevel} lock</Badge> : null}
                      </button>
                    ))
                  )}
                </div>
                {environmentSpec ? (
                  <details className="lf-sheet__section">
                    <summary style={{ cursor: 'pointer' }}>Protected anchors</summary>
                    <p className="lf-tile__description">
                      {environmentSpec.roomType} — {environmentSpec.layoutFeel}; lighting:{' '}
                      {environmentSpec.lightingStyle}
                    </p>
                  </details>
                ) : null}
                {isDraft ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void act(() => service.removeProjectInput(environmentInput.id, workspaceId), 'Environment removed')}
                  >
                    Remove environment
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>

        {/* 3. Look (optional) ───────────────────────────────────────────── */}
        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Look (optional)</h3>
            <p className="lf-tile__description">
              Saved Looks from the unified Library. A Look changes presentation only — it never
              alters the model's protected Character Sheet. The Look's model must match the
              selected primary model.
            </p>
            {libraryAssets === null ? (
              <Skeleton lines={2} />
            ) : (
              <div className="lf-library__assetpick" role="listbox" aria-label="Looks">
                {(libraryAssets ?? [])
                  .filter((asset) => asset.assetType === 'look')
                  .filter((asset) => asset.name.toLowerCase().includes(assetSearch.trim().toLowerCase()))
                  .map((asset) => {
                    const selected = asset.id === lookInput?.libraryAssetId;
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className="lf-library__assetoption"
                        disabled={!isDraft || busy || selected}
                        onClick={() =>
                          void act(async () => {
                            const lookVersions = await library.getVersions(asset.id, workspaceId);
                            const locked =
                              lookVersions.find((version) => version.id === asset.activeVersionId) ??
                              lookVersions[0];
                            if (lookInput) await service.removeProjectInput(lookInput.id, workspaceId);
                            await service.addProjectInput(
                              {
                                contentProjectId: project.id,
                                inputType: 'look',
                                libraryAssetId: asset.id,
                                libraryAssetVersionId: locked.id,
                                role: 'look',
                              },
                              workspaceId,
                            );
                          }, `${asset.name} selected`)
                        }
                      >
                        <span>{asset.name}</span>
                        <span className="lf-library__assetoptionmeta">{selected ? 'selected' : 'Saved Look'}</span>
                      </button>
                    );
                  })}
                {(libraryAssets ?? []).filter((asset) => asset.assetType === 'look').length === 0 ? (
                  <p className="lf-tile__description">No Saved Looks in the Library yet.</p>
                ) : null}
              </div>
            )}

            {lookInput ? (
              <div className="lf-section" style={{ gap: 'var(--lf-space-2)', marginTop: 'var(--lf-space-3)' }}>
                <div className="lf-envcard__badges">
                  <strong>{selectedLookAsset?.name ?? lookInput.libraryAssetId}</strong>
                  <Link className="lf-btn lf-btn--ghost lf-btn--sm" to={`/library/looks/${lookInput.libraryAssetId}`}>
                    Open Look
                  </Link>
                </div>
                {lookItems === null ? (
                  <Skeleton lines={2} />
                ) : lookItems.length === 0 ? (
                  <p className="lf-tile__description">No linked items in this Look.</p>
                ) : (
                  <ul className="lf-library__lookitems">
                    {lookItems.map((item) => {
                      const entry = lookItemAssets[item.id];
                      return (
                        <li key={item.id} className="lf-library__lookitem">
                          <span className="lf-library__lookitembody">
                            <strong>{entry?.asset.name ?? item.libraryAssetId}</strong>
                            <span className="lf-library__lookitemmeta">
                              role: {item.role} ·{' '}
                              {entry?.version ? (
                                <>
                                  {item.libraryAssetVersionId ? 'pinned v' : 'active v'}
                                  {entry.version.versionNumber} <LockBadge status={entry.version.status} />
                                </>
                              ) : (
                                'no version resolved'
                              )}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {isDraft ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void act(() => service.removeProjectInput(lookInput.id, workspaceId), 'Look removed')}
                  >
                    Remove Look
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>

        {/* 4. Shared assets ─────────────────────────────────────────────── */}
        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Shared assets</h3>
            <p className="lf-tile__description">
              Search the one unified Library and assign roles. Assets stay canonical — their
              profiles open in the Library; nothing is duplicated here.
            </p>
            <Input
              label="Search the Library"
              hideLabel
              placeholder="Search products, props, wardrobe…"
              value={assetSearch}
              onChange={(event) => setAssetSearch(event.target.value)}
              type="search"
            />
            {libraryAssets === null ? (
              <Skeleton lines={2} />
            ) : (
              <div className="lf-library__assetpick" role="listbox" aria-label="Library assets">
                {filteredAssets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="lf-library__assetoption"
                    disabled={!isDraft || busy}
                    onClick={() =>
                      void act(async () => {
                        const version = asset.activeVersionId
                          ? await library.getVersion(asset.activeVersionId, workspaceId).catch(() => null)
                          : null;
                        if (!version) throw new Error('This asset has no version to select yet.');
                        await service.addProjectInput(
                          {
                            contentProjectId: project.id,
                            inputType: 'library_asset',
                            libraryAssetId: asset.id,
                            libraryAssetVersionId: version.id,
                            role: asset.assetType in ROLE_FOR_TYPE ? ROLE_FOR_TYPE[asset.assetType as keyof typeof ROLE_FOR_TYPE] : 'other',
                          },
                          `${asset.name} added`,
                        );
                      }, '')
                    }
                  >
                    <span>{asset.name}</span>
                    <span className="lf-library__assetoptionmeta">{asset.assetType.replace('_', ' ')}</span>
                  </button>
                ))}
                {filteredAssets.length === 0 ? <p className="lf-tile__description">No assets match.</p> : null}
              </div>
            )}

            {sharedInputs.length > 0 ? (
              <ul className="lf-library__lookitems" style={{ marginTop: 'var(--lf-space-3)' }}>
                {sharedInputs.map((input, index) => (
                  <SharedAssetRow
                    key={input.id}
                    input={input}
                    name={
                      (libraryAssets ?? []).find((asset) => asset.id === input.libraryAssetId)?.name ??
                      input.libraryAssetId ??
                      input.id
                    }
                    index={index}
                    total={sharedInputs.length}
                    disabled={!isDraft || busy}
                    onRemove={() => void act(() => service.removeProjectInput(input.id, workspaceId), 'Asset removed')}
                    onReorder={(delta) =>
                      void act(async () => {
                        const ids = sharedInputs.map((entry) => entry.id);
                        const [moved] = ids.splice(index, 1);
                        ids.splice(index + delta, 0, moved);
                        await service.reorderProjectInputs(project.id, [
                          ...data.inputs.filter((entry) => entry.inputType !== 'library_asset').map((entry) => entry.id),
                          ...ids,
                        ], workspaceId);
                      }, 'Order updated')
                    }
                  />
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {/* Continuity sidebar ─────────────────────────────────────────────── */}
      <aside className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Continuity status</h3>
            {problems === null ? (
              <Skeleton lines={3} />
            ) : continuityReady ? (
              <p className="lf-library__note" role="note">
                Ready: all selected inputs are locked.
              </p>
            ) : (
              <>
                <p className="lf-tile__description">Resolve these before job preparation:</p>
                <ul className="lf-alertbox" role="alert">
                  {problems.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Input summary</h3>
            {resolved === null ? (
              <Skeleton lines={4} />
            ) : (
              <ul className="lf-envref__list">
                {resolved.map((entry) => (
                  <li key={entry.input.id} className="lf-envref__item">
                    <strong>{inputDisplayName(entry, models, environments, libraryAssets)}</strong>
                    <span className="lf-tile__description">
                      {entry.input.inputType} · role: {entry.input.role} ·{' '}
                      {entry.versionStatus === 'locked' ? 'locked ✓' : `${entry.versionStatus} — must be locked`}
                    </span>
                  </li>
                ))}
                {resolved.length === 0 ? (
                  <li className="lf-envref__item">
                    <span className="lf-tile__description">No inputs selected yet.</span>
                  </li>
                ) : null}
              </ul>
            )}
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}

const ROLE_FOR_TYPE: Partial<Record<string, ContentInputRole>> = {
  product: 'product',
  prop: 'prop',
  wardrobe: 'wardrobe',
  accessory: 'accessory',
  creator_tool: 'creator_tool',
  brand_asset: 'brand_asset',
  reference: 'reference',
};

function inputDisplayName(
  entry: ResolvedProjectInput,
  models: ModelRecord[] | null,
  environments: EnvironmentRecord[] | null,
  assets: LibraryAssetRecord[] | null,
): string {
  const { input } = entry;
  if (input.inputType === 'model' && input.modelId) {
    return models?.find((model) => model.id === input.modelId)?.name ?? input.modelId;
  }
  if (input.inputType === 'environment' && input.environmentId) {
    return environments?.find((environment) => environment.id === input.environmentId)?.name ?? input.environmentId;
  }
  if ((input.inputType === 'library_asset' || input.inputType === 'look') && input.libraryAssetId) {
    return assets?.find((asset) => asset.id === input.libraryAssetId)?.name ?? input.libraryAssetId;
  }
  return input.inputType;
}

function SharedAssetRow({
  input,
  name,
  index,
  total,
  disabled,
  onRemove,
  onReorder,
}: {
  input: ContentProjectInputRecord;
  name: string;
  index: number;
  total: number;
  disabled: boolean;
  onRemove: () => void;
  onReorder: (delta: number) => void;
}) {
  return (
    <li className="lf-library__lookitem">
      <span className="lf-library__lookitemnum" aria-hidden="true">{index + 1}</span>
      <span className="lf-library__lookitembody">
        <Link to={`/library/${input.libraryAssetId}`}>
          <strong>{name}</strong>
        </Link>
        <span className="lf-library__lookitemmeta">
          role: {input.role} · version {input.libraryAssetVersionId}
        </span>
      </span>
      <span className="lf-library__lookitemactions">
        <button type="button" className="lf-iconbtn" aria-label="Move up" disabled={disabled || index === 0} onClick={() => onReorder(-1)}>
          ↑
        </button>
        <button type="button" className="lf-iconbtn" aria-label="Move down" disabled={disabled || index === total - 1} onClick={() => onReorder(1)}>
          ↓
        </button>
        <button type="button" className="lf-iconbtn" aria-label="Remove asset" disabled={disabled} onClick={onRemove}>
          ×
        </button>
      </span>
    </li>
  );
}
