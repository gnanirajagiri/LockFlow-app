/**
 * Storyboard tab — ordered Scenes and Beats with safe reordering, add/remove
 * controls and the natural-language intent bar (saves direction text only;
 * no AI transformation). Structural edits require a draft project.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { SEED_CONTENT_WORKSPACE_ID as SEED_WS } from '../../mock/contentSeed';
import { ContentIntentBar } from './ContentIntentBar';
import { useContentProjectOutletContext } from './tabRoutes';
import type { ContentBeatRecord, ContentSceneRecord } from '../../domain/content';

export function StoryboardTab() {
  const { toast } = useToast();
  const { service, data, basePath } = useContentProjectOutletContext();
  const project = data.project;
  const scenes = data.scenes;
  const beatsByScene = data.beatsByScene;

  const [sceneDrafts, setSceneDrafts] = useState<Record<string, { title: string; purpose: string; setting: string; shot: string }>>({});
  const [beatDrafts, setBeatDrafts] = useState<Record<string, { title: string; action: string; dialogue: string; camera: string; duration: string }>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'scene' | 'beat'; id: string; title: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated || scenes.length === 0) return;
    const sDrafts: typeof sceneDrafts = {};
    const bDrafts: typeof beatDrafts = {};
    for (const scene of scenes) {
      sDrafts[scene.id] = { title: scene.title, purpose: scene.purpose ?? '', setting: scene.settingNotes ?? '', shot: scene.shotNotes ?? '' };
      for (const beat of beatsByScene[scene.id] ?? []) {
        bDrafts[beat.id] = { title: beat.title, action: beat.actionDescription ?? '', dialogue: beat.dialogueOrOverlay ?? '', camera: beat.cameraDirection ?? '', duration: beat.durationSeconds?.toString() ?? '' };
      }
    }
    setSceneDrafts((current) => ({ ...sDrafts, ...current }));
    setBeatDrafts((current) => ({ ...bDrafts, ...current }));
    setHydrated(true);
  }, [beatsByScene, hydrated, scenes]);

  const isDraft = project?.status === 'draft';
  const projectId = project?.id ?? '';

  async function run(action: () => Promise<unknown>, message: string) {
    if (!project) return;
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

  function sceneDraft(id: string) {
    return sceneDrafts[id] ?? { title: '', purpose: '', setting: '', shot: '' };
  }
  function beatDraft(id: string) {
    return beatDrafts[id] ?? { title: '', action: '', dialogue: '', camera: '', duration: '' };
  }

  function updateSceneField(id: string, patch: Partial<ReturnType<typeof sceneDraft>>) {
    setSceneDrafts((current) => ({ ...current, [id]: { ...sceneDraft(id), ...patch } }));
  }
  function updateBeatField(id: string, patch: Partial<ReturnType<typeof beatDraft>>) {
    setBeatDrafts((current) => ({ ...current, [id]: { ...beatDraft(id), ...patch } }));
  }

  async function saveScene(scene: ContentSceneRecord) {
    const draft = sceneDraft(scene.id);
    await run(
      () => service.updateScene(scene.id, { title: draft.title, purpose: draft.purpose, settingNotes: draft.setting, shotNotes: draft.shot }, SEED_WS),
      'Scene saved',
    );
  }

  async function saveBeat(beat: ContentBeatRecord) {
    const draft = beatDraft(beat.id);
    const duration = draft.duration.trim() === '' ? null : Number(draft.duration);
    await run(
      () =>
        service.updateBeat(
          beat.id,
          { title: draft.title, actionDescription: draft.action, dialogueOrOverlay: draft.dialogue, cameraDirection: draft.camera, durationSeconds: duration },
          SEED_WS,
        ),
      'Beat saved',
    );
  }

  async function reorderScenes(from: number, delta: number) {
    const ids = scenes.map((scene) => scene.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(from + delta, 0, moved);
    await run(() => service.reorderScenes(projectId, ids, SEED_WS), 'Scene order updated');
  }

  async function reorderBeats(sceneId: string, from: number, delta: number) {
    const beats = beatsByScene[sceneId] ?? [];
    const ids = beats.map((beat) => beat.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(from + delta, 0, moved);
    await run(() => service.reorderBeats(sceneId, ids, SEED_WS), 'Beat order updated');
  }

  async function addScene(atIndex?: number) {
    await run(async () => {
      const created = await service.createScene({ contentProjectId: projectId, title: 'New scene' }, SEED_WS);
      if (atIndex !== undefined) {
        const ids = scenes.map((scene) => scene.id);
        ids.splice(atIndex, 0, created.id);
        await service.reorderScenes(projectId, ids, SEED_WS);
      }
    }, 'Scene added');
  }

  async function addBeat(sceneId: string, atIndex?: number) {
    await run(async () => {
      const created = await service.createBeat({ contentSceneId: sceneId, title: 'New beat' }, SEED_WS);
      if (atIndex !== undefined) {
        const ids = (beatsByScene[sceneId] ?? []).map((beat) => beat.id);
        ids.splice(atIndex, 0, created.id);
        await service.reorderBeats(sceneId, ids, SEED_WS);
      }
    }, 'Beat added');
  }

  async function duplicateScene(scene: ContentSceneRecord) {
    await run(async () => {
      const copy = await service.createScene(
        { contentProjectId: projectId, title: `${scene.title} (copy)`, purpose: scene.purpose ?? undefined, settingNotes: scene.settingNotes ?? undefined, shotNotes: scene.shotNotes ?? undefined },
        SEED_WS,
      );
      for (const beat of beatsByScene[scene.id] ?? []) {
        await service.createBeat(
          {
            contentSceneId: copy.id,
            title: beat.title,
            actionDescription: beat.actionDescription ?? undefined,
            dialogueOrOverlay: beat.dialogueOrOverlay ?? undefined,
            cameraDirection: beat.cameraDirection ?? undefined,
            durationSeconds: beat.durationSeconds ?? undefined,
          },
          SEED_WS,
        );
      }
    }, 'Scene duplicated');
  }

  async function confirmDeleteAction() {
    if (!confirmDelete) return;
    const { kind, id } = confirmDelete;
    setConfirmDelete(null);
    await run(() => (kind === 'scene' ? service.deleteScene(id, SEED_WS) : service.deleteBeat(id, SEED_WS)), kind === 'scene' ? 'Scene deleted' : 'Beat deleted');
  }

  return (
    <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
      <Card>
        <CardBody>
          <div className="lf-envcard__badges">
            <h3 className="lf-envpanel__heading" style={{ margin: 0 }}>Storyboard</h3>
            <Badge tone={isDraft ? 'primary' : 'neutral'}>{project?.status ?? ''}</Badge>
            {!isDraft ? <Badge tone="warning">read-only</Badge> : null}
          </div>
          <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
            {isDraft ? (
              <Button variant="primary" size="sm" onClick={() => void addScene()} disabled={busy}>
                Add scene
              </Button>
            ) : null}
            <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={`${basePath}/review`}>
              Review plan
            </Link>
          </div>
          <details className="lf-sheet__section" style={{ marginTop: 'var(--lf-space-2)' }}>
            <summary style={{ cursor: 'pointer' }}>Brief summary</summary>
            <p className="lf-tile__description">{project?.campaignBrief ?? 'No campaign brief recorded.'}</p>
          </details>
        </CardBody>
      </Card>

      {isDraft ? (
        <Card>
          <CardBody>
            <ContentIntentBar
              label="Describe a storyboard change"
              placeholder="Add a product close-up after the vanity setup, with a slow camera push-in…"
              buttonLabel="Add as direction"
              savedNote="Saved as draft storyboard direction only — no AI transformation is applied yet."
              hasExistingText={(project?.storyboardDirection ?? '').trim() !== ''}
              onApply={(text, mode) =>
                void run(
                  () =>
                    service.updateProjectDraft(
                      projectId,
                      { storyboardDirection: mode === 'append' && (project?.storyboardDirection ?? '').trim() !== '' ? `${project!.storyboardDirection!.trim()} ${text}` : text },
                      SEED_WS,
                    ),
                  'Direction saved to draft',
                )
              }
            />
          </CardBody>
        </Card>
      ) : null}

      {!isDraft ? (
        <p className="lf-library__warning" role="note">
          This plan is {project?.status ?? 'archived'} and is preserved read-only. Create a new draft plan to make
          structural changes.
        </p>
      ) : null}

      {scenes.map((scene, sceneIndex) => {
        const beats = beatsByScene[scene.id] ?? [];
        const draft = sceneDraft(scene.id);
        return (
          <Card key={scene.id}>
            <CardBody>
              <div className="lf-envcard__badges">
                <span className="lf-library__lookitemnum" aria-hidden="true">{scene.sceneOrder + 1}</span>
                <Badge tone="neutral">{beats.length} {beats.length === 1 ? 'beat' : 'beats'}</Badge>
              </div>
              <div className="lf-formstack">
                <Input
                  label={`Scene ${scene.sceneOrder + 1} title`}
                  value={draft.title}
                  onChange={(event) => updateSceneField(scene.id, { title: event.target.value })}
                  disabled={!isDraft || busy}
                />
                <Input
                  label="Purpose"
                  value={draft.purpose}
                  onChange={(event) => updateSceneField(scene.id, { purpose: event.target.value })}
                  disabled={!isDraft || busy}
                />
                <Input
                  label="Setting notes"
                  value={draft.setting}
                  onChange={(event) => updateSceneField(scene.id, { setting: event.target.value })}
                  disabled={!isDraft || busy}
                />
                <Input
                  label="Shot notes"
                  value={draft.shot}
                  onChange={(event) => updateSceneField(scene.id, { shot: event.target.value })}
                  disabled={!isDraft || busy}
                />
              </div>
              {isDraft ? (
                <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void saveScene(scene)}>
                    Save scene
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void addBeat(scene.id)}>
                    Add beat
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy || sceneIndex === 0} onClick={() => void reorderScenes(sceneIndex, -1)}>
                    Move up
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy || sceneIndex === scenes.length - 1} onClick={() => void reorderScenes(sceneIndex, 1)}>
                    Move down
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void duplicateScene(scene)}>
                    Duplicate
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete({ kind: 'scene', id: scene.id, title: scene.title })}>
                    Delete
                  </Button>
                </div>
              ) : null}

              <ol className="lf-library__lookitems">
                {beats.map((beat, beatIndex) => {
                  const bDraft = beatDraft(beat.id);
                  return (
                    <li key={beat.id} className="lf-library__lookitem" style={{ alignItems: 'flex-start' }}>
                      <span className="lf-library__lookitemnum" aria-hidden="true">{beat.beatOrder + 1}</span>
                      <span className="lf-library__lookitembody" style={{ flex: 1 }}>
                        <Input
                          label={`Beat ${beat.beatOrder + 1} title`}
                          value={bDraft.title}
                          onChange={(event) => updateBeatField(beat.id, { title: event.target.value })}
                          disabled={!isDraft || busy}
                        />
                        <Input
                          label="Action description"
                          value={bDraft.action}
                          onChange={(event) => updateBeatField(beat.id, { action: event.target.value })}
                          disabled={!isDraft || busy}
                        />
                        <Input
                          label="Dialogue or overlay"
                          value={bDraft.dialogue}
                          onChange={(event) => updateBeatField(beat.id, { dialogue: event.target.value })}
                          disabled={!isDraft || busy}
                        />
                        <Input
                          label="Camera direction"
                          value={bDraft.camera}
                          onChange={(event) => updateBeatField(beat.id, { camera: event.target.value })}
                          disabled={!isDraft || busy}
                        />
                        <Input
                          label="Duration (seconds)"
                          value={bDraft.duration}
                          onChange={(event) => updateBeatField(beat.id, { duration: event.target.value })}
                          disabled={!isDraft || busy}
                          type="number"
                        />
                        {isDraft ? (
                          <span className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void saveBeat(beat)}>
                              Save beat
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy || beatIndex === 0} onClick={() => void reorderBeats(scene.id, beatIndex, -1)}>
                              Move up
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy || beatIndex === beats.length - 1} onClick={() => void reorderBeats(scene.id, beatIndex, 1)}>
                              Move down
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void addBeat(scene.id, beatIndex)}>
                              + above
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void addBeat(scene.id, beatIndex + 1)}>
                              + below
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete({ kind: 'beat', id: beat.id, title: beat.title })}>
                              Delete
                            </Button>
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ol>

              {isDraft ? (
                <div className="lf-dialogactions" style={{ justifyContent: 'flex-start', marginTop: 'var(--lf-space-2)' }}>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void addBeat(scene.id)}>
                    + Add beat
                  </Button>
                </div>
              ) : null}
            </CardBody>
          </Card>
        );
      })}

      {isDraft ? (
        <div className="lf-dialogactions">
          <Button variant="primary" onClick={() => void addScene()} disabled={busy}>
            Add scene
          </Button>
        </div>
      ) : null}

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={confirmDelete ? `Delete ${confirmDelete.kind} "${confirmDelete.title}"?` : 'Delete'}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void confirmDeleteAction()}>
              Delete
            </Button>
          </div>
        }
      >
        <p>
          {confirmDelete?.kind === 'scene'
            ? 'The scene and all of its beats will be removed from this draft plan. Remaining scenes keep a contiguous order.'
            : 'The beat will be removed and the remaining beats keep a contiguous order.'}
        </p>
      </Modal>

    </div>
  );
}

