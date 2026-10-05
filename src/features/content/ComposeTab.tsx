/**
 * Compose tab — the Maya two-column compose surface. Left: locked-identity
 * asset strip, the creation prompt, Look, Assets and session-only craft
 * controls (Action / Camera / Hook / Voice / Captions). Right: the locked
 * identity preview panel with the plan's assets and the workflow actions.
 *
 * Everything here reads canonical, workspace-checked records through the
 * Content Studio service — the compose page owns nothing. Craft controls are
 * session-local capture surfaces for now (they do not mutate the plan); the
 * prompt maps onto the plan's creative direction and saves with the draft.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { useToast } from '../../components/ui/Toast';
import {
  ChevronRightIcon,
  EnvironmentIcon,
  LibraryIcon,
  LockIcon,
  ModelIcon,
  SparkIcon,
  StudioIcon,
} from '../../components/icons';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { LibraryService } from '../../services/libraryService';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import type { ContentOutputType } from '../../domain/content';
import type {
  ContentProjectInputRecord,
  ResolvedProjectInput,
} from '../../domain/content';
import type { ModelRecord } from '../../domain/models';
import type { EnvironmentRecord } from '../../domain/environments';
import type { LibraryAssetRecord } from '../../domain/library';
import { useContentProjectOutletContext } from './tabRoutes';

const PROMPT_MAX = 500;

const OUTPUT_LABEL: Record<ContentOutputType, string> = {
  photo: 'Photo',
  video: 'Video',
  story: 'Story',
  content_set: 'Content set',
};

/** Library asset types offered through the "Add assets" picker. */
const SHARED_ASSET_TYPES = new Set([
  'product',
  'prop',
  'wardrobe',
  'accessory',
  'personal_item',
  'creator_tool',
  'brand_asset',
  'reference',
  'scene',
]);

const PROMPT_PLACEHOLDER = 'A friendly morning-routine serum demo with a confident hook.';

interface CraftControls {
  action: string;
  camera: string;
  hook: string;
  voice: string;
  captions: string;
}

const EMPTY_CRAFT: CraftControls = { action: '', camera: '', hook: '', voice: '', captions: '' };

function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}

function lockTone(status: 'locked' | 'draft' | 'none'): string {
  if (status === 'locked') return 'lf-assetcard__lock';
  if (status === 'draft') return 'lf-assetcard__lock lf-assetcard__lock--draft';
  return 'lf-assetcard__lock lf-assetcard__lock--none';
}

function LockChip({ status }: { status: 'locked' | 'draft' | 'none' }) {
  return (
    <span className={lockTone(status)}>
      <LockIcon size={10} />
      {status === 'locked' ? 'Locked' : status === 'draft' ? 'Draft' : 'Not set'}
    </span>
  );
}

export function ComposeTab() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { service, data, basePath } = useContentProjectOutletContext();
  const project = data.project;
  const isDraft = project?.status === 'draft';
  const workspaceId = SEED_CONTENT_WORKSPACE_ID;

  const library = useMemo(() => new LibraryService(getLibraryRepository()), []);
  const modelsService = useMemo(() => new ModelsService(getModelsRepository()), []);
  const environmentsService = useMemo(() => new EnvironmentsService(getEnvironmentsRepository()), []);

  // Catalog names for inputs (canonical records, read-only).
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentRecord[]>([]);
  const [libraryAssets, setLibraryAssets] = useState<LibraryAssetRecord[]>([]);
  const [resolved, setResolved] = useState<ResolvedProjectInput[] | null>(null);

  // Compose state.
  const [prompt, setPrompt] = useState('');
  const [outputType, setOutputType] = useState<ContentOutputType | ''>('');
  const [craft, setCraft] = useState<CraftControls>(EMPTY_CRAFT);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Hydrate from the plan.
  useEffect(() => {
    if (!project) return;
    setPrompt(project.creativeDirection ?? '');
    setOutputType(project.plannedOutputType ?? '');
  }, [project]);

  // Catalog loads.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [modelList, environmentList, assets] = await Promise.all([
        modelsService.listModels(workspaceId).catch(() => []),
        environmentsService.listEnvironments(workspaceId).catch(() => []),
        library.listAssets(workspaceId).catch(() => []),
      ]);
      if (!cancelled) {
        setModels(modelList);
        setEnvironments(environmentList);
        setLibraryAssets(assets);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [environmentsService, library, modelsService, service, workspaceId]);

  // Resolved lock states for the asset strip.
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    service
      .resolveProjectInputs(project.id, workspaceId)
      .then((entries) => {
        if (!cancelled) setResolved(entries);
      })
      .catch(() => {
        if (!cancelled) setResolved([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project, service, workspaceId, data.inputs]);

  if (!project) return null;

  const modelInput = data.inputs.find((input) => input.inputType === 'model');
  const environmentInput = data.inputs.find((input) => input.inputType === 'environment');
  const lookInput = data.inputs.find((input) => input.inputType === 'look');
  const assetInputs = data.inputs.filter((input) => input.inputType === 'library_asset');

  const modelName = modelInput ? models.find((m) => m.id === modelInput.modelId)?.name ?? 'Model' : null;
  const environmentName = environmentInput
    ? environments.find((e) => e.id === environmentInput.environmentId)?.name ?? 'Environment'
    : null;
  const lookName = lookInput ? libraryAssets.find((a) => a.id === lookInput.libraryAssetId)?.name ?? 'Look' : null;

  const versionStatus = (input: ContentProjectInputRecord | undefined): 'locked' | 'draft' | 'none' => {
    if (!input) return 'none';
    const entry = resolved?.find((candidate) => candidate.input.id === input.id);
    if (!entry) return 'none';
    return entry.versionStatus === 'locked' ? 'locked' : 'draft';
  };

  const modelStatus = versionStatus(modelInput);
  const environmentStatus = versionStatus(environmentInput);
  const lookStatus = versionStatus(lookInput);

  const previewAssets = assetInputs.map((input) => ({
    input,
    name: libraryAssets.find((asset) => asset.id === input.libraryAssetId)?.name ?? 'Asset',
  }));

  const pickerChoices = libraryAssets
    .filter((asset) => SHARED_ASSET_TYPES.has(asset.assetType))
    .filter((asset) => !assetInputs.some((input) => input.libraryAssetId === asset.id));

  const outputMediaClass =
    outputType === 'photo'
      ? 'lf-assetcard__media--look'
      : outputType === 'story'
        ? 'lf-assetcard__media--env'
        : 'lf-assetcard__media--output';

  async function act(action: () => Promise<void>, message: string) {
    setBusy(true);
    try {
      await action();
      toast({ title: message, tone: 'success' });
      await data.reload();
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

  async function handleSaveDraft() {
    if (!project) return;
    setSaving(true);
    try {
      await service.updateProjectDraft(
        project.id,
        {
          creativeDirection: prompt.trim() === '' ? null : prompt.trim().slice(0, PROMPT_MAX),
          plannedOutputType: outputType === '' ? null : outputType,
        },
        workspaceId,
      );
      toast({ title: 'Draft saved', description: `${project.name} was updated.`, tone: 'success' });
      await data.reload();
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Could not save the draft.',
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveAsset(inputId: string) {
    await act(() => service.removeProjectInput(inputId, workspaceId), 'Asset removed');
  }

  async function handleAddAsset(asset: LibraryAssetRecord) {
    setPickerOpen(false);
    if (!project || !asset.activeVersionId) {
      toast({ title: 'Not available', description: 'That asset has no version to add yet.', tone: 'error' });
      return;
    }
    await act(async () => {
      await service.addProjectInput(
        {
          contentProjectId: project.id,
          inputType: 'library_asset',
          libraryAssetId: asset.id,
          libraryAssetVersionId: asset.activeVersionId,
          role: asset.assetType === 'product' ? 'product' : 'other',
        },
        workspaceId,
      );
    }, `${asset.name} added`);
  }

  async function handleLookChange(nextLookId: string) {
    if (!project) return;
    if (nextLookId === '') {
      if (lookInput) await act(() => service.removeProjectInput(lookInput.id, workspaceId), 'Look removed');
      return;
    }
    await act(async () => {
      const versions = await library.getVersions(nextLookId, workspaceId);
      const chosen =
        versions.find((version) => version.id === libraryAssets.find((a) => a.id === nextLookId)?.activeVersionId) ??
        versions.find((version) => version.status === 'locked') ??
        versions[0];
      if (!chosen) throw new Error('This Look has no version yet.');
      if (lookInput) await service.removeProjectInput(lookInput.id, workspaceId);
      await service.addProjectInput(
        {
          contentProjectId: project.id,
          inputType: 'look',
          libraryAssetId: nextLookId,
          libraryAssetVersionId: chosen.id,
          role: 'look',
        },
        workspaceId,
      );
    }, 'Look selected');
  }

  const lookOptions = libraryAssets.filter((asset) => asset.assetType === 'look');

  return (
    <div className="lf-compose">
      {/* ── Left column · brief / look / assets ─────────────────────────── */}
      <div className="lf-compose__left">
        <div className="lf-compose__strip" role="group" aria-label="Locked identity inputs">
          {/* Primary model */}
          <button
            type="button"
            className="lf-assetcard"
            onClick={() => (modelInput ? navigate(`/models/${modelInput.modelId}`) : navigate('/models'))}
          >
            <span className="lf-assetcard__media lf-assetcard__media--model" aria-hidden="true" />
            <span className="lf-assetcard__body">
              <span className="lf-assetcard__name">{modelName ?? 'Choose a model'}</span>
              <span className="lf-assetcard__sub">
                {modelInput ? `Primary model · v${resolved?.find((entry) => entry.input.id === modelInput.id)?.versionNumber ?? '—'}` : 'Pick your presenter'}
              </span>
              <LockChip status={modelStatus} />
            </span>
            <span className="lf-assetcard__chevron" aria-hidden="true"><ChevronRightIcon size={12} /></span>
          </button>

          {/* Environment */}
          <button
            type="button"
            className="lf-assetcard"
            onClick={() =>
              environmentInput ? navigate(`/environments/${environmentInput.environmentId}/builder`) : navigate('/environments')
            }
          >
            <span className="lf-assetcard__media lf-assetcard__media--env" aria-hidden="true" />
            <span className="lf-assetcard__body">
              <span className="lf-assetcard__name">{environmentName ?? 'Choose an environment'}</span>
              <span className="lf-assetcard__sub">
                {environmentInput ? `Environment · v${resolved?.find((entry) => entry.input.id === environmentInput.id)?.versionNumber ?? '—'}` : 'Where it happens'}
              </span>
              <LockChip status={environmentStatus} />
            </span>
            <span className="lf-assetcard__chevron" aria-hidden="true"><ChevronRightIcon size={12} /></span>
          </button>

          {/* Look */}
          <button
            type="button"
            className="lf-assetcard"
            onClick={() => (lookInput ? navigate(`/library/looks/${lookInput.libraryAssetId}`) : setPickerOpen(true))}
          >
            <span className="lf-assetcard__media lf-assetcard__media--look" aria-hidden="true" />
            <span className="lf-assetcard__body">
              <span className="lf-assetcard__name">{lookName ?? 'Choose a Look'}</span>
              <span className="lf-assetcard__sub">{lookInput ? 'Styling · presentation only' : 'Wardrobe & styling'}</span>
              <LockChip status={lookStatus} />
            </span>
            <span className="lf-assetcard__chevron" aria-hidden="true"><ChevronRightIcon size={12} /></span>
          </button>

          {/* Planned output */}
          <button
            type="button"
            className="lf-assetcard"
            onClick={() => navigate(`${basePath}/brief`)}
            title="Planned output is edited in the Brief tab"
          >
            <span className={`lf-assetcard__media ${outputMediaClass}`} aria-hidden="true" />
            <span className="lf-assetcard__body">
              <span className="lf-assetcard__name">{outputType ? OUTPUT_LABEL[outputType] : 'Output format'}</span>
              <span className="lf-assetcard__sub">{outputType ? 'Planned workflow output' : 'Set it in the brief'}</span>
              <LockChip status={outputType ? 'locked' : 'none'} />
            </span>
            <span className="lf-assetcard__chevron" aria-hidden="true"><ChevronRightIcon size={12} /></span>
          </button>
        </div>

        {/* Prompt */}
        <Card>
          <CardBody>
            <div className="lf-compose__prompthead">
              <span className="lf-compose__promptspark" aria-hidden="true"><SparkIcon size={16} /></span>
              <h3 className="lf-envpanel__heading" style={{ margin: 0 }}>What do you want to create?</h3>
            </div>
            <div className="lf-compose__promptfield" style={{ marginTop: 'var(--lf-space-2)' }}>
              <textarea
                className="lf-input"
                rows={4}
                value={prompt}
                placeholder={PROMPT_PLACEHOLDER}
                maxLength={PROMPT_MAX}
                disabled={!isDraft}
                onChange={(event) => setPrompt(event.target.value)}
                aria-label="Describe what you want to create"
              />
              <div className="lf-compose__promptmeta">
                <span>Saved with the draft as creative direction.</span>
                <span>
                  {prompt.trim().length}/{PROMPT_MAX}
                </span>              </div>
            </div>
          </CardBody>
        </Card>

        {/* Look + Assets */}
        <Card>
          <CardHeader title="Look" description="Presentation only — never alters the model's protected Character Sheet." />
          <CardBody>
            <div className="lf-formstack">
            <select
              className="lf-input"
              value={lookInput?.libraryAssetId ?? ''}
              disabled={!isDraft || busy}
              aria-label="Look"
              onChange={(event) => void handleLookChange(event.target.value)}
            >
              <option value="">No Look (model's default styling)</option>
              {lookOptions.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.name}</option>
              ))}
            </select>

            <div style={{ position: 'relative' }}>
              <span className="lf-field__label">Assets</span>
              <div className="lf-compose__chips" style={{ marginTop: 'var(--lf-space-2)' }}>
                {previewAssets.length === 0 ? (
                  <span className="lf-tile__description">No assets yet — add products, props or wardrobe.</span>
                ) : (
                  previewAssets.map(({ input, name }) => (
                    <span key={input.id} className="lf-composechip">
                      {name}
                      <button
                        type="button"
                        className="lf-composechip__remove"
                        aria-label={`Remove ${name}`}
                        disabled={!isDraft || busy}
                        onClick={() => void handleRemoveAsset(input.id)}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
                {isDraft ? (
                  <button
                    type="button"
                    className="lf-compose__addassets"
                    aria-expanded={pickerOpen}
                    onClick={() => setPickerOpen((open) => !open)}
                  >
                    + Add assets
                  </button>
                ) : null}
              </div>

              {pickerOpen ? (
                <>
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 1 }}
                    onClick={() => setPickerOpen(false)}
                    aria-hidden="true"
                  />
                  <div
                    role="listbox"
                    aria-label="Add assets from the Library"
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      left: 0,
                      zIndex: 2,
                      minWidth: 280,
                      maxHeight: 260,
                      overflowY: 'auto',
                      padding: 'var(--lf-space-2)',
                      background: 'var(--lf-color-surface)',
                      border: '1px solid var(--lf-color-border)',
                      borderRadius: 'var(--lf-radius-md)',
                      boxShadow: 'var(--lf-shadow-md)',
                      display: 'grid',
                      gap: 2,
                    }}
                  >
                    {pickerChoices.length === 0 ? (
                      <span className="lf-tile__description" style={{ padding: '6px 8px' }}>
                        Every eligible Library asset is already on this plan.
                      </span>
                    ) : (
                      pickerChoices.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          role="option"
                          aria-selected={false}
                          className="lf-library__assetoption"
                          disabled={busy}
                          onClick={() => void handleAddAsset(asset)}
                        >
                          <span>{asset.name}</span>
                          <span className="lf-library__assetoptionmeta">{humanize(asset.assetType)}</span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : null}
            </div>
            </div>
          </CardBody>
        </Card>

        {/* Craft controls — session capture surfaces */}
        <div className="lf-compose__grid2">
          <Card>
            <CardHeader title="Action" />
            <CardBody>
              <textarea
                className="lf-input"
                rows={3}
                placeholder="What is happening in the shot?"
                value={craft.action}
                disabled={!isDraft}
                onChange={(event) => setCraft((current) => ({ ...current, action: event.target.value }))}
                aria-label="Action"
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Camera" />
            <CardBody>
              <textarea
                className="lf-input"
                rows={3}
                placeholder="Framing, lens, movement…"
                value={craft.camera}
                disabled={!isDraft}
                onChange={(event) => setCraft((current) => ({ ...current, camera: event.target.value }))}
                aria-label="Camera"
              />
            </CardBody>
          </Card>
        </div>
        <div className="lf-compose__grid3">
          <Card>
            <CardHeader title="Hook" />
            <CardBody>
              <textarea
                className="lf-input"
                rows={2}
                placeholder="First-line hook…"
                value={craft.hook}
                disabled={!isDraft}
                onChange={(event) => setCraft((current) => ({ ...current, hook: event.target.value }))}
                aria-label="Hook"
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Voice" />
            <CardBody>
              <textarea
                className="lf-input"
                rows={2}
                placeholder="Tone of voice…"
                value={craft.voice}
                disabled={!isDraft}
                onChange={(event) => setCraft((current) => ({ ...current, voice: event.target.value }))}
                aria-label="Voice"
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Captions" />
            <CardBody>
              <textarea
                className="lf-input"
                rows={2}
                placeholder="On-screen text…"
                value={craft.captions}
                disabled={!isDraft}
                onChange={(event) => setCraft((current) => ({ ...current, captions: event.target.value }))}
                aria-label="Captions"
              />
            </CardBody>
          </Card>
        </div>
      </div>

      {/* ── Right column · locked identity preview ─────────────────────── */}
      <div className="lf-compose__right">
        <Card className="lf-composepreview">
          <div className={`lf-composepreview__media ${outputMediaClass}`} aria-hidden="true" />
          <div className="lf-composepreview__banner">
            <span className="lf-composepreview__bannericon" aria-hidden="true">
              <ModelIcon size={18} />
            </span>
            <span className="lf-composepreview__bannertext">
              <span className="lf-composepreview__bannertitle">
                {modelName ? `${modelName} · Locked identity` : 'No model selected yet'}
              </span>
              <span className="lf-composepreview__bannersub">
                {modelStatus === 'locked'
                  ? 'Your approved AI presenter'
                  : modelStatus === 'draft'
                    ? 'Draft version — lock it in Models before a job'
                    : 'Choose a locked model to preview'}
              </span>
            </span>
          </div>

          <div className="lf-composepreview__assets">
            <span className="lf-composepreview__assetstitle">Assets in this content</span>
            {previewAssets.length === 0 && !environmentName && !lookName ? (
              <span className="lf-tile__description">
                Assets from the Library appear here as you add them.
              </span>
            ) : (
              <div className="lf-compose__chips">
                {environmentName ? (
                  <span className="lf-composechip">
                    <EnvironmentIcon size={13} /> {environmentName}
                  </span>
                ) : null}
                {lookName ? (
                  <span className="lf-composechip">
                    <LibraryIcon size={13} /> {lookName}
                  </span>
                ) : null}
                {previewAssets.map(({ input, name }) => (
                  <span key={input.id} className="lf-composechip">
                    {name}
                    {isDraft ? (
                      <button
                        type="button"
                        className="lf-composechip__remove"
                        aria-label={`Remove ${name}`}
                        disabled={busy}
                        onClick={() => void handleRemoveAsset(input.id)}
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="lf-composepreview__footer">
            <Button variant="ghost" onClick={() => void handleSaveDraft()} disabled={!isDraft || saving}>
              {saving ? 'Saving…' : 'Save as draft'}
            </Button>
            <Button variant="primary" onClick={() => navigate(`${basePath}/inputs`)}>
              Preview workflow
            </Button>
          </div>
        </Card>

        <p className="lf-tile__description" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StudioIcon size={14} /> Draft status: <Badge tone={isDraft ? 'warning' : 'success'} dot>{project.status}</Badge>
        </p>
      </div>
    </div>
  );
}
