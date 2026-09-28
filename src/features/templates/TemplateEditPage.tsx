/**
 * Template storyboard editor (/templates/:templateId/edit).
 *
 * Sections: brief + creative direction, suggested (non-binding) inputs, and
 * the ordered scene/beat planner. Every reorder has a keyboard alternative
 * (move up/down buttons). The prompt bar appends local direction text only.
 * Archived templates render read-only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { TemplateIcon } from '../../components/icons';
import { TemplatesService } from '../../services/templatesService';
import { getTemplatesRepository } from '../../data/templatesFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import {
  TEMPLATE_SUGGESTED_ROLES,
  validateReorder,
} from '../../domain/templates';
import type {
  ContentTemplateBeatRecord,
  ContentTemplateRecord,
  ContentTemplateSceneRecord,
  ContentTemplateSuggestionRecord,
  TemplateSuggestedRole,
  TemplateSuggestionType,
} from '../../domain/templates';
import { ContentIntentBar } from '../content/ContentIntentBar';
import {
  SUGGESTION_ONLY_COPY,
  STORYBOARD_PROMPT_PLACEHOLDER,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_OUTPUT_LABELS,
  TEMPLATE_PROMPT_NOTE,
  TEMPLATE_STATUS_TONE,
} from './templatesUi';

type LoadState = 'loading' | 'error' | 'ready';

interface EditorData {
  template: ContentTemplateRecord;
  scenes: ContentTemplateSceneRecord[];
  beatsByScene: Record<string, ContentTemplateBeatRecord[]>;
  suggestions: ContentTemplateSuggestionRecord[];
}

export function TemplateEditPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const { toast } = useToast();

  const service = useMemo(
    () =>
      new TemplatesService(getTemplatesRepository(), {
        library: new LibraryService(getLibraryRepository()),
        models: new ModelsService(getModelsRepository()),
        environments: new EnvironmentsService(getEnvironmentsRepository()),
      }),
    [],
  );

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EditorData | null>(null);
  const [busy, setBusy] = useState(false);

  // Pending delete confirmations.
  const [deletingScene, setDeletingScene] = useState<ContentTemplateSceneRecord | null>(null);
  const [deletingBeat, setDeletingBeat] = useState<ContentTemplateBeatRecord | null>(null);

  const load = useCallback(async () => {
    if (!templateId) return;
    setState('loading');
    setError(null);
    try {
      const template = await service.getTemplate(templateId, SEED_CONTENT_WORKSPACE_ID);
      const scenes = await service.listScenes(templateId, SEED_CONTENT_WORKSPACE_ID);
      const beatsByScene: Record<string, ContentTemplateBeatRecord[]> = {};
      for (const scene of scenes) {
        beatsByScene[scene.id] = await service.listBeats(scene.id, SEED_CONTENT_WORKSPACE_ID);
      }
      const suggestions = await service.listSuggestions(templateId, SEED_CONTENT_WORKSPACE_ID);
      setData({ template, scenes, beatsByScene, suggestions });
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this template.');
      setState('error');
    }
  }, [service, templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    try {
      await action();
      toast({ title: successMessage, tone: 'success' });
      await load();
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

  if (!templateId || state === 'loading') {
    return (
      <div className="lf-page" aria-busy="true">
        <Skeleton variant="rect" height={56} />
        <Skeleton variant="rect" height={300} />
      </div>
    );
  }

  if (state === 'error' || !data) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<TemplateIcon size={22} />}
          title="Couldn't open this template"
          description={error ?? undefined}
          actions={<Link className="lf-btn lf-btn--secondary" to="/templates">Back to Templates</Link>}
        />
      </div>
    );
  }

  const { template, scenes, beatsByScene, suggestions } = data;
  const editable = template.status !== 'archived';

  async function appendDirection(text: string) {
    const next = template.creativeDirection ? `${template.creativeDirection}\n${text}` : text;
    await act(
      () => service.updateTemplate(template.id, { creativeDirection: next }, SEED_CONTENT_WORKSPACE_ID),
      'Direction saved',
    );
  }

  async function reorderScenes(scene: ContentTemplateSceneRecord, delta: number) {
    const orderedIds = scenes.map((entry) => entry.id);
    const from = orderedIds.indexOf(scene.id);
    const to = from + delta;
    if (to < 0 || to >= orderedIds.length) return;
    orderedIds.splice(to, 0, orderedIds.splice(from, 1)[0]);
    const result = validateReorder(orderedIds);
    if (!result.ok) return;
    await act(
      () => service.reorderScenes(template.id, result.value, SEED_CONTENT_WORKSPACE_ID),
      'Scene order saved',
    );
  }

  async function reorderBeats(sceneId: string, beat: ContentTemplateBeatRecord, delta: number) {
    const orderedIds = (beatsByScene[sceneId] ?? []).map((entry) => entry.id);
    const from = orderedIds.indexOf(beat.id);
    const to = from + delta;
    if (to < 0 || to >= orderedIds.length) return;
    orderedIds.splice(to, 0, orderedIds.splice(from, 1)[0]);
    const result = validateReorder(orderedIds);
    if (!result.ok) return;
    await act(
      () => service.reorderBeats(sceneId, result.value, SEED_CONTENT_WORKSPACE_ID),
      'Beat order saved',
    );
  }

  async function duplicateScene(scene: ContentTemplateSceneRecord) {
    await act(async () => {
      const beats = beatsByScene[scene.id] ?? [];
      const created = await service.createScene(
        {
          contentTemplateId: template.id,
          title: `${scene.title} (copy)`,
          purpose: scene.purpose ?? undefined,
          settingNotes: scene.settingNotes ?? undefined,
          shotNotes: scene.shotNotes ?? undefined,
        },
        SEED_CONTENT_WORKSPACE_ID,
      );
      for (const beat of beats) {
        await service.createBeat(
          {
            contentTemplateSceneId: created.id,
            title: beat.title,
            actionDescription: beat.actionDescription ?? undefined,
            dialogueOrOverlay: beat.dialogueOrOverlay ?? undefined,
            cameraDirection: beat.cameraDirection ?? undefined,
            durationSeconds: beat.durationSeconds ?? undefined,
          },
          SEED_CONTENT_WORKSPACE_ID,
        );
      }
    }, 'Scene duplicated');
  }

  return (
    <div className="lf-page">
      <nav className="lf-library__filterreset" aria-label="Breadcrumb">
        <Link to="/templates">Templates</Link> /{' '}
        <Link to={`/templates/${template.id}`}>{template.name}</Link> /{' '}
        <span aria-current="page">Edit</span>
      </nav>

      <PageHeader
        eyebrow={`${TEMPLATE_CATEGORY_LABELS[template.category]} · ${TEMPLATE_OUTPUT_LABELS[template.defaultOutputType]}`}
        title={template.name}
        description={template.description ?? 'Reusable creative plan.'}
        actions={
          <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
            <Badge tone={TEMPLATE_STATUS_TONE[template.status]} dot>{template.status}</Badge>
            <Link className="lf-btn lf-btn--primary" to={`/templates/${template.id}/apply`}>
              Use template
            </Link>
            {!editable ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => service.restoreTemplate(template.id, SEED_CONTENT_WORKSPACE_ID),
                    'Template restored to draft',
                  )
                }
              >
                Restore
              </Button>
            ) : null}
          </div>
        }
      />

      {!editable ? (
        <p className="lf-library__note" role="note">
          This template is archived and read-only. Restore it to make changes.
        </p>
      ) : null}

      <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
        {/* 1. Brief and creative direction ─────────────────────────────────── */}
        <BriefSection
          template={template}
          service={service}
          editable={editable}
          busy={busy}
          onChanged={load}
          onAppendDirection={(text) => void act(() => appendDirection(text), 'Direction saved')}
        />

        {/* 2. Suggested inputs ─────────────────────────────────────────────── */}
        <SuggestionsSection
          template={template}
          suggestions={suggestions}
          service={service}
          editable={editable}
          busy={busy}
          onChanged={load}
          act={act}
        />

        {/* 3. Scenes and beats ─────────────────────────────────────────────── */}
        <ScenesSection
          template={template}
          scenes={scenes}
          beatsByScene={beatsByScene}
          service={service}
          editable={editable}
          busy={busy}
          act={act}
          onReorderScenes={(scene, delta) => void reorderScenes(scene, delta)}
          onReorderBeats={(sceneId, beat, delta) => void reorderBeats(sceneId, beat, delta)}
          onDuplicateScene={(scene) => void duplicateScene(scene)}
          onDeleteScene={(scene) => setDeletingScene(scene)}
          onDeleteBeat={(beat) => setDeletingBeat(beat)}
        />
      </div>

      {/* Delete confirmations ──────────────────────────────────────────────── */}
      <Modal
        open={deletingScene !== null}
        onClose={() => setDeletingScene(null)}
        title={deletingScene ? `Delete scene “${deletingScene.title}”?` : 'Delete scene'}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setDeletingScene(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                const scene = deletingScene;
                setDeletingScene(null);
                if (!scene) return;
                void act(
                  () => service.deleteScene(scene.id, SEED_CONTENT_WORKSPACE_ID),
                  'Scene deleted',
                );
              }}
            >
              Delete scene
            </Button>
          </div>
        }
      >
        <p>
          The scene and its beats are removed from this template. Templates already applied to
          content plans are not affected.
        </p>
      </Modal>

      <Modal
        open={deletingBeat !== null}
        onClose={() => setDeletingBeat(null)}
        title={deletingBeat ? `Delete beat “${deletingBeat.title}”?` : 'Delete beat'}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setDeletingBeat(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                const beat = deletingBeat;
                setDeletingBeat(null);
                if (!beat) return;
                void act(
                  () => service.deleteBeat(beat.id, SEED_CONTENT_WORKSPACE_ID),
                  'Beat deleted',
                );
              }}
            >
              Delete beat
            </Button>
          </div>
        }
      >
        <p>The beat is removed from this template scene. This cannot be undone.</p>
      </Modal>
    </div>
  );
}

// ── Section 1: brief + direction ─────────────────────────────────────────────

function BriefSection({
  template,
  service,
  editable,
  busy,
  onChanged,
  onAppendDirection,
}: {
  template: ContentTemplateRecord;
  service: TemplatesService;
  editable: boolean;
  busy: boolean;
  onChanged: () => Promise<void>;
  onAppendDirection: (text: string) => void;
}) {
  const { toast } = useToast();
  const [objective, setObjective] = useState(template.briefTemplate.objective ?? '');
  const [audience, setAudience] = useState(template.briefTemplate.audience ?? '');
  const [brandVoice, setBrandVoice] = useState(template.briefTemplate.brandVoice ?? '');
  const [campaignBrief, setCampaignBrief] = useState(template.briefTemplate.campaignBrief ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setObjective(template.briefTemplate.objective ?? '');
    setAudience(template.briefTemplate.audience ?? '');
    setBrandVoice(template.briefTemplate.brandVoice ?? '');
    setCampaignBrief(template.briefTemplate.campaignBrief ?? '');
  }, [template.id, template.updatedAt, template.briefTemplate]);

  async function save() {
    setSaving(true);
    try {
      await service.updateTemplate(
        template.id,
        {
          briefTemplate: {
            objective: objective.trim() || null,
            audience: audience.trim() || null,
            brandVoice: brandVoice.trim() || null,
            campaignBrief: campaignBrief.trim() || null,
          },
        },
        SEED_CONTENT_WORKSPACE_ID,
      );
      toast({ title: 'Brief saved', tone: 'success' });
      await onChanged?.();
    } catch (err) {
      toast({
        title: 'Could not save the brief',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <h3 className="lf-envpanel__heading">Brief and creative direction</h3>
        <div className="lf-formstack" style={{ marginTop: 'var(--lf-space-2)' }}>
          <Input
            label="Objective"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            disabled={!editable}
          />
          <Input
            label="Audience"
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
            disabled={!editable}
          />
          <Input
            label="Brand voice"
            value={brandVoice}
            onChange={(event) => setBrandVoice(event.target.value)}
            disabled={!editable}
          />
          <label className="lf-field">
            <span className="lf-field__label">Campaign brief</span>
            <textarea
              className="lf-input lf-envform__textarea"
              rows={3}
              value={campaignBrief}
              onChange={(event) => setCampaignBrief(event.target.value)}
              disabled={!editable}
            />
          </label>
        </div>
        {editable ? (
          <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
            <Button size="sm" variant="secondary" disabled={saving || busy} onClick={() => void save()}>
              Save draft
            </Button>
          </div>
        ) : null}

        <div style={{ marginTop: 'var(--lf-space-3)' }}>
          <ContentIntentBar
            label="Describe a structure change"
            placeholder={STORYBOARD_PROMPT_PLACEHOLDER}
            buttonLabel="Add as direction"
            savedNote={TEMPLATE_PROMPT_NOTE}
            hasExistingText={(template.creativeDirection ?? '').trim() !== ''}
            onApply={(text) => onAppendDirection(text)}
          />
          {template.creativeDirection ? (
            <p className="lf-tile__description" style={{ whiteSpace: 'pre-wrap' }}>
              <strong>Direction so far:</strong> {template.creativeDirection}
            </p>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

// ── Section 2: suggested inputs ──────────────────────────────────────────────

const SUGGESTION_KINDS: Array<{ type: TemplateSuggestionType; label: string }> = [
  { type: 'model', label: 'Suggested primary model' },
  { type: 'environment', label: 'Suggested environment' },
  { type: 'look', label: 'Suggested Look' },
  { type: 'library_asset_category', label: 'Suggested Library category' },
  { type: 'library_asset', label: 'Suggested Library asset' },
];

function SuggestionsSection({
  template,
  suggestions,
  service,
  editable,
  busy,
  act,
}: {
  template: ContentTemplateRecord;
  suggestions: ContentTemplateSuggestionRecord[];
  service: TemplatesService;
  editable: boolean;
  busy: boolean;
  onChanged: () => Promise<void>;
  act: (action: () => Promise<void>, successMessage: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<TemplateSuggestionType>('library_asset_category');
  const [role, setRole] = useState<TemplateSuggestedRole>('product');
  const [assetId, setAssetId] = useState('');
  const [assetType, setAssetType] = useState('');
  const [notes, setNotes] = useState('');

  async function add() {
    await act(async () => {
      await service.addSuggestion(
        {
          contentTemplateId: template.id,
          suggestionType: kind,
          suggestedRole: role,
          ...(kind !== 'library_asset_category' && assetId.trim() ? { suggestedAssetId: assetId.trim() } : {}),
          ...(assetType.trim() ? { suggestedAssetType: assetType.trim() } : {}),
          ...(notes.trim() ? { compatibilityNotes: notes.trim() } : {}),
        },
        SEED_CONTENT_WORKSPACE_ID,
      );
      setAssetId('');
      setAssetType('');
      setNotes('');
    }, 'Suggestion added');
  }

  async function move(suggestion: ContentTemplateSuggestionRecord, delta: number) {
    const orderedIds = suggestions.map((entry) => entry.id);
    const from = orderedIds.indexOf(suggestion.id);
    const to = from + delta;
    if (to < 0 || to >= orderedIds.length) return;
    orderedIds.splice(to, 0, orderedIds.splice(from, 1)[0]);
    const result = validateReorder(orderedIds);
    if (!result.ok) return;
    await act(
      () => service.reorderSuggestions(template.id, result.value, SEED_CONTENT_WORKSPACE_ID),
      'Suggestion order saved',
    );
  }

  return (
    <Card>
      <CardBody>
        <h3 className="lf-envpanel__heading">Suggested inputs</h3>
        <p className="lf-tile__description">{SUGGESTION_ONLY_COPY}</p>

        {suggestions.length > 0 ? (
          <ol className="lf-library__lookitems" style={{ marginTop: 'var(--lf-space-2)' }}>
            {suggestions.map((suggestion, index) => (
              <li key={suggestion.id} className="lf-library__lookitem">
                <span className="lf-library__lookitemnum" aria-hidden="true">{index + 1}</span>
                <span className="lf-library__lookitembody">
                  <strong>{suggestion.suggestedRole.replace(/_/g, ' ')}</strong>
                  <span className="lf-library__lookitemmeta">
                    {suggestion.suggestionType.replace(/_/g, ' ')}
                    {suggestion.suggestedAssetId ? ` · ${suggestion.suggestedAssetId}` : ' · category only'}
                    {suggestion.compatibilityNotes ? ` — ${suggestion.compatibilityNotes}` : ''}
                  </span>
                </span>
                {editable ? (
                  <span className="lf-library__lookitemactions">
                    <button
                      type="button"
                      className="lf-iconbtn"
                      aria-label={`Move suggestion ${index + 1} up`}
                      disabled={busy || index === 0}
                      onClick={() => void move(suggestion, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="lf-iconbtn"
                      aria-label={`Move suggestion ${index + 1} down`}
                      disabled={busy || index === suggestions.length - 1}
                      onClick={() => void move(suggestion, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="lf-iconbtn"
                      aria-label={`Remove suggestion ${index + 1}`}
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => service.removeSuggestion(suggestion.id, SEED_CONTENT_WORKSPACE_ID),
                          'Suggestion removed',
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="lf-tile__description" style={{ marginTop: 'var(--lf-space-2)' }}>
            No suggested inputs yet.
          </p>
        )}

        {editable ? (
          <fieldset style={{ border: 'none', padding: 0, margin: 0, marginTop: 'var(--lf-space-3)' }}>
            <legend className="lf-field__label">Add a suggestion</legend>
            <div className="lf-formstack">
              <div>
                <label className="lf-field__label" htmlFor="tmpl-sugg-kind">Kind</label>
                <select
                  id="tmpl-sugg-kind"
                  className="lf-input"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as TemplateSuggestionType)}
                >
                  {SUGGESTION_KINDS.map((entry) => (
                    <option key={entry.type} value={entry.type}>{entry.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="lf-field__label" htmlFor="tmpl-sugg-role">Role</label>
                <select
                  id="tmpl-sugg-role"
                  className="lf-input"
                  value={role}
                  onChange={(event) => setRole(event.target.value as TemplateSuggestedRole)}
                >
                  {TEMPLATE_SUGGESTED_ROLES.map((value) => (
                    <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              {kind !== 'library_asset_category' ? (
                <Input
                  label="Asset id (workspace record — no version)"
                  placeholder="e.g. model_aisha"
                  value={assetId}
                  onChange={(event) => setAssetId(event.target.value)}
                />
              ) : null}
              <Input
                label="Asset category label (optional)"
                placeholder="e.g. product"
                value={assetType}
                onChange={(event) => setAssetType(event.target.value)}
              />
              <Input
                label="Compatibility notes (optional)"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
              <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void add()}>
                  Add suggestion
                </Button>
              </div>
            </div>
          </fieldset>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ── Section 3: scenes and beats ──────────────────────────────────────────────

function ScenesSection({
  template,
  scenes,
  beatsByScene,
  service,
  editable,
  busy,
  act,
  onReorderScenes,
  onReorderBeats,
  onDuplicateScene,
  onDeleteScene,
  onDeleteBeat,
}: {
  template: ContentTemplateRecord;
  scenes: ContentTemplateSceneRecord[];
  beatsByScene: Record<string, ContentTemplateBeatRecord[]>;
  service: TemplatesService;
  editable: boolean;
  busy: boolean;
  act: (action: () => Promise<unknown>, successMessage: string) => Promise<void>;
  onReorderScenes: (scene: ContentTemplateSceneRecord, delta: number) => void;
  onReorderBeats: (sceneId: string, beat: ContentTemplateBeatRecord, delta: number) => void;
  onDuplicateScene: (scene: ContentTemplateSceneRecord) => void;
  onDeleteScene: (scene: ContentTemplateSceneRecord) => void;
  onDeleteBeat: (beat: ContentTemplateBeatRecord) => void;
}) {
  return (
    <Card>
      <CardBody>
        <h3 className="lf-envpanel__heading">Scenes and beats</h3>
        <p className="lf-tile__description">
          Structure only. Reordering is safe and always has keyboard controls (↑ / ↓). Dialogue and
          overlay text is written direction — LockFlow does not generate audio.
        </p>

        <ol className="lf-section" style={{ gap: 'var(--lf-space-3)', marginTop: 'var(--lf-space-3)' }}>
          {scenes.map((scene, sceneIndex) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              sceneIndex={sceneIndex}
              sceneCount={scenes.length}
              beats={beatsByScene[scene.id] ?? []}
              service={service}
              editable={editable}
              busy={busy}
              act={act}
              onReorderScenes={onReorderScenes}
              onReorderBeats={onReorderBeats}
              onDuplicateScene={onDuplicateScene}
              onDeleteScene={onDeleteScene}
              onDeleteBeat={onDeleteBeat}
            />
          ))}
        </ol>

        {editable ? (
          <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    service.createScene(
                      { contentTemplateId: template.id, title: `Scene ${scenes.length + 1}` },
                      SEED_CONTENT_WORKSPACE_ID,
                    ),
                  'Scene added',
                )
              }
            >
              Add scene
            </Button>
          </div>
        ) : null}
        {scenes.length === 0 ? (
          <p className="lf-tile__description">No scenes yet — add the first scene above.</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function SceneCard({
  scene,
  sceneIndex,
  sceneCount,
  beats,
  service,
  editable,
  busy,
  act,
  onReorderScenes,
  onReorderBeats,
  onDuplicateScene,
  onDeleteScene,
  onDeleteBeat,
}: {
  scene: ContentTemplateSceneRecord;
  sceneIndex: number;
  sceneCount: number;
  beats: ContentTemplateBeatRecord[];
  service: TemplatesService;
  editable: boolean;
  busy: boolean;
  act: (action: () => Promise<unknown>, successMessage: string) => Promise<void>;
  onReorderScenes: (scene: ContentTemplateSceneRecord, delta: number) => void;
  onReorderBeats: (sceneId: string, beat: ContentTemplateBeatRecord, delta: number) => void;
  onDuplicateScene: (scene: ContentTemplateSceneRecord) => void;
  onDeleteScene: (scene: ContentTemplateSceneRecord) => void;
  onDeleteBeat: (beat: ContentTemplateBeatRecord) => void;
}) {
  const [title, setTitle] = useState(scene.title);
  const [purpose, setPurpose] = useState(scene.purpose ?? '');
  const [settingNotes, setSettingNotes] = useState(scene.settingNotes ?? '');
  const [shotNotes, setShotNotes] = useState(scene.shotNotes ?? '');

  useEffect(() => {
    setTitle(scene.title);
    setPurpose(scene.purpose ?? '');
    setSettingNotes(scene.settingNotes ?? '');
    setShotNotes(scene.shotNotes ?? '');
  }, [scene]);

  const dirty =
    title !== scene.title ||
    purpose !== (scene.purpose ?? '') ||
    settingNotes !== (scene.settingNotes ?? '') ||
    shotNotes !== (scene.shotNotes ?? '');

  return (
    <li className="lf-section" style={{ border: '1px solid var(--lf-border, #ddd)', borderRadius: 8, padding: 'var(--lf-space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
        <strong>
          Scene {sceneIndex + 1}
          {dirty && !editable ? ' *' : ''}
        </strong>
        {editable ? (
          <span className="lf-library__lookitemactions">
            <button
              type="button"
              className="lf-iconbtn"
              aria-label={`Move scene ${sceneIndex + 1} up`}
              disabled={busy || sceneIndex === 0}
              onClick={() => onReorderScenes(scene, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="lf-iconbtn"
              aria-label={`Move scene ${sceneIndex + 1} down`}
              disabled={busy || sceneIndex === sceneCount - 1}
              onClick={() => onReorderScenes(scene, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="lf-iconbtn"
              aria-label={`Duplicate scene ${sceneIndex + 1}`}
              disabled={busy}
              onClick={() => onDuplicateScene(scene)}
            >
              ⧉
            </button>
            <button
              type="button"
              className="lf-iconbtn"
              aria-label={`Delete scene ${sceneIndex + 1}`}
              disabled={busy}
              onClick={() => onDeleteScene(scene)}
            >
              ×
            </button>
          </span>
        ) : null}
      </div>

      <div className="lf-formstack" style={{ marginTop: 'var(--lf-space-2)' }}>
        <Input
          label="Scene title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={!editable}
        />
        <Input
          label="Purpose"
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
          disabled={!editable}
        />
        <Input
          label="Setting notes"
          value={settingNotes}
          onChange={(event) => setSettingNotes(event.target.value)}
          disabled={!editable}
        />
        <Input
          label="Shot notes"
          value={shotNotes}
          onChange={(event) => setShotNotes(event.target.value)}
          disabled={!editable}
        />
      </div>

      {editable && dirty ? (
        <div className="lf-dialogactions" style={{ justifyContent: 'flex-start', marginTop: 'var(--lf-space-2)' }}>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  service.updateScene(
                    scene.id,
                    {
                      title: title.trim() || scene.title,
                      purpose: purpose.trim() || null,
                      settingNotes: settingNotes.trim() || null,
                      shotNotes: shotNotes.trim() || null,
                    },
                    SEED_CONTENT_WORKSPACE_ID,
                  ),
                'Scene saved',
              )
            }
          >
            Save scene
          </Button>
        </div>
      ) : null}

      {/* Beats ─────────────────────────────────────────────────────────────── */}
      <ol className="lf-section" style={{ gap: 'var(--lf-space-2)', marginTop: 'var(--lf-space-3)' }} aria-label={`Beats for scene ${sceneIndex + 1}`}>
        {beats.map((beat, beatIndex) => (
          <BeatRow
            key={beat.id}
            beat={beat}
            beatIndex={beatIndex}
            beatCount={beats.length}
            service={service}
            editable={editable}
            busy={busy}
            act={act}
            onReorder={(delta) => onReorderBeats(scene.id, beat, delta)}
            onDelete={() => onDeleteBeat(beat)}
          />
        ))}
      </ol>

      {editable ? (
        <div className="lf-dialogactions" style={{ justifyContent: 'flex-start', marginTop: 'var(--lf-space-2)' }}>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  service.createBeat(
                    { contentTemplateSceneId: scene.id, title: `Beat ${beats.length + 1}` },
                    SEED_CONTENT_WORKSPACE_ID,
                  ),
                'Beat added',
              )
            }
          >
            ＋ Add beat
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function BeatRow({
  beat,
  beatIndex,
  beatCount,
  service,
  editable,
  busy,
  act,
  onReorder,
  onDelete,
}: {
  beat: ContentTemplateBeatRecord;
  beatIndex: number;
  beatCount: number;
  service: TemplatesService;
  editable: boolean;
  busy: boolean;
  act: (action: () => Promise<unknown>, successMessage: string) => Promise<void>;
  onReorder: (delta: number) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(beat.title);
  const [actionDescription, setActionDescription] = useState(beat.actionDescription ?? '');
  const [dialogueOrOverlay, setDialogueOrOverlay] = useState(beat.dialogueOrOverlay ?? '');
  const [cameraDirection, setCameraDirection] = useState(beat.cameraDirection ?? '');
  const [durationSeconds, setDurationSeconds] = useState(
    beat.durationSeconds === null ? '' : String(beat.durationSeconds),
  );

  useEffect(() => {
    setTitle(beat.title);
    setActionDescription(beat.actionDescription ?? '');
    setDialogueOrOverlay(beat.dialogueOrOverlay ?? '');
    setCameraDirection(beat.cameraDirection ?? '');
    setDurationSeconds(beat.durationSeconds === null ? '' : String(beat.durationSeconds));
  }, [beat]);

  const dirty =
    title !== beat.title ||
    actionDescription !== (beat.actionDescription ?? '') ||
    dialogueOrOverlay !== (beat.dialogueOrOverlay ?? '') ||
    cameraDirection !== (beat.cameraDirection ?? '') ||
    durationSeconds !== (beat.durationSeconds === null ? '' : String(beat.durationSeconds));

  const duration = durationSeconds.trim() === '' ? null : Number(durationSeconds);
  const durationValid = duration === null || (Number.isFinite(duration) && duration >= 0);

  return (
    <li style={{ border: '1px dashed var(--lf-border, #ccc)', borderRadius: 8, padding: 'var(--lf-space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
        <strong>Beat {beatIndex + 1}</strong>
        {editable ? (
          <span className="lf-library__lookitemactions">
            <button
              type="button"
              className="lf-iconbtn"
              aria-label={`Move beat ${beatIndex + 1} up`}
              disabled={busy || beatIndex === 0}
              onClick={() => onReorder(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="lf-iconbtn"
              aria-label={`Move beat ${beatIndex + 1} down`}
              disabled={busy || beatIndex === beatCount - 1}
              onClick={() => onReorder(1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="lf-iconbtn"
              aria-label={`Delete beat ${beatIndex + 1}`}
              disabled={busy}
              onClick={onDelete}
            >
              ×
            </button>
          </span>
        ) : null}
      </div>

      <div className="lf-formstack" style={{ marginTop: 'var(--lf-space-2)' }}>
        <Input
          label="Beat title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={!editable}
        />
        <Input
          label="Action description"
          value={actionDescription}
          onChange={(event) => setActionDescription(event.target.value)}
          disabled={!editable}
        />
        <Input
          label="Dialogue / overlay (written direction, not audio)"
          value={dialogueOrOverlay}
          onChange={(event) => setDialogueOrOverlay(event.target.value)}
          disabled={!editable}
        />
        <Input
          label="Camera direction"
          value={cameraDirection}
          onChange={(event) => setCameraDirection(event.target.value)}
          disabled={!editable}
        />
        <Input
          label="Duration (seconds, optional)"
          type="number"
          min={0}
          value={durationSeconds}
          onChange={(event) => setDurationSeconds(event.target.value)}
          disabled={!editable}
        />
      </div>

      {editable && dirty ? (
        <div className="lf-dialogactions" style={{ justifyContent: 'flex-start', marginTop: 'var(--lf-space-2)' }}>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !durationValid}
            onClick={() =>
              void act(
                () =>
                  service.updateBeat(
                    beat.id,
                    {
                      title: title.trim() || beat.title,
                      actionDescription: actionDescription.trim() || null,
                      dialogueOrOverlay: dialogueOrOverlay.trim() || null,
                      cameraDirection: cameraDirection.trim() || null,
                      durationSeconds: durationValid ? duration : null,
                    },
                    SEED_CONTENT_WORKSPACE_ID,
                  ),
                'Beat saved',
              )
            }
          >
            Save beat
          </Button>
        </div>
      ) : null}
    </li>
  );
}
