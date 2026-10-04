/**
 * Campaign content-set generation panel — prompt 29.
 *
 * One campaign brief → one coordinated multi-format generation run: the user
 * reviews the planned mix ("2 Images, 1 Video, 1 Story"), the shared locked
 * baseline (model version + Character Sheet constraints + environment/assets)
 * and any explicit variation rules before submitting. Child image/video/story
 * jobs run through the existing media services; progress, partial success and
 * retry are tracked on the parent run.
 *
 * This component talks ONLY to the CampaignRunService (never providers,
 * never Storage).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { useToast } from '../../components/ui/Toast';
import { LockIcon } from '../../components/icons';
import { CampaignRunService, InMemoryCampaignRunStore } from '../../generation/campaignRunService';
import type { CampaignGenerationRunRecord, CampaignRunJobRecord } from '../../generation/campaignRunService';
import { describePlanMix } from '../../generation/campaignOrchestration';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import type { ContentJobPinRecord } from '../../domain/content';

const RUN_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  validating: 'Validating',
  blocked: 'Blocked',
  planning: 'Planning',
  queued: 'Queued',
  running: 'Running',
  partially_completed: 'Partially completed',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const JOB_STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Shared store so run state survives remounts (same pattern as generation). */
let storeInstance: InMemoryCampaignRunStore | null = null;
function getStore(): InMemoryCampaignRunStore {
  if (!storeInstance) storeInstance = new InMemoryCampaignRunStore();
  return storeInstance;
}

export interface CampaignContentSetPanelProps {
  campaignId: string;
  /** Resolved job pins (model/environment/asset versions) for the baseline. */
  pins: ContentJobPinRecord[];
  /** Model/environment/asset ids to resolve into the shared baseline. */
  modelId: string | null;
  modelVersionId: string | null;
  environmentId: string | null;
  environmentVersionId: string | null;
  assetIds: string[];
}

export function CampaignContentSetPanel({
  campaignId,
  pins,
  modelId,
  modelVersionId,
  environmentId,
  environmentVersionId,
  assetIds,
}: CampaignContentSetPanelProps) {
  const { toast } = useToast();
  const service = useMemo(
    () =>
      new CampaignRunService(getStore(), {
        content: {
          createDraftJobRequest: async (input, createdBy, workspaceId) => ({
            id: `cjob_${crypto.randomUUID()}`,
            ...(input as Record<string, never>),
            createdBy,
            workspaceId,
          }),
        },
        // In demo mode the child runs are stubbed as instantly-completed
        // image/video runs; real deployments wire the GenerationService and
        // VideoGenerationService here (same contracts as prompts 27/28).
        submitImageRun: async ({ jobId }) => ({
          run: {
            id: `run_${crypto.randomUUID()}`,
            workspaceId: SEED_CONTENT_WORKSPACE_ID,
            contentJobRequestId: jobId,
            createdBy: 'demo-user',
            providerName: 'development-fake',
            providerRequestId: null,
            idempotencyKey: `k_${crypto.randomUUID()}`,
            status: 'completed',
            requestSnapshot: {},
            responseSnapshot: null,
            providerCostMetadata: null,
            errorCode: null,
            errorMessage: null,
            attemptNumber: 1,
            startedAt: null,
            completedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          eligible: true,
          blocking: [],
        }),
        submitVideoRun: async ({ jobId }) => ({
          run: {
            id: `run_${crypto.randomUUID()}`,
            workspaceId: SEED_CONTENT_WORKSPACE_ID,
            contentJobRequestId: jobId,
            createdBy: 'demo-user',
            providerName: 'development-fake-video',
            providerRequestId: null,
            idempotencyKey: `k_${crypto.randomUUID()}`,
            status: 'completed',
            requestSnapshot: {},
            responseSnapshot: null,
            providerCostMetadata: null,
            errorCode: null,
            errorMessage: null,
            attemptNumber: 1,
            startedAt: null,
            completedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          eligible: true,
          blocking: [],
        }),
        resolveBaseline: async () => {
          const modelPins = pins.filter((pin) => pin.pinType === 'model_version');
          const environmentPins = pins.filter((pin) => pin.pinType === 'environment_version');
          if (modelPins.length === 0 && environmentPins.length === 0 && assetIds.length === 0) {
            return null;
          }
          const details = modelPins[0]?.resolvedDetails as { modelName?: string; versionNumber?: number } | undefined;
          return {
            source: { model: null, characterSheet: null, environment: null, assets: [], references: [] },
            snapshot: {
              prompt: { userPrompt: '', cleanedPrompt: '' },
              aspectRatio: '1:1',
              outputCount: 1,
              lockedInputs: [
                ...modelPins.map((pin) => ({
                  kind: 'model_version' as const,
                  id: pin.sourceVersionId,
                  label: `${details?.modelName ?? pin.sourceRecordId} v${details?.versionNumber ?? 1}`,
                  versionNumber: details?.versionNumber ?? 1,
                  resolvedVia: 'campaign brief model pin',
                })),
                ...environmentPins.map((pin) => ({
                  kind: 'environment_version' as const,
                  id: pin.sourceVersionId,
                  label: pin.sourceRecordId,
                  versionNumber: (pin.resolvedDetails as { versionNumber?: number }).versionNumber ?? 1,
                  resolvedVia: 'campaign brief environment pin',
                })),
                ...assetIds.map((assetId) => ({
                  kind: 'library_asset' as const,
                  id: assetId,
                  label: assetId,
                  versionNumber: null,
                  resolvedVia: 'campaign brief asset pin',
                })),
              ],
              characterSheetConstraints: modelPins.map((pin) => ({
                modelId: pin.sourceRecordId,
                modelVersionId: pin.sourceVersionId,
                characterSheetId: `cs:${pin.sourceVersionId}`,
                protectedTraitKeys: [],
                protectedTraitCount: 0,
              })),
              referencePlan: [],
              assembledAt: new Date().toISOString(),
            },
            identityTraits: {},
            modelPinIds: modelPins.map((pin) => pin.sourceRecordId),
          };
        },
      }),
    // Recreated when the resolved inputs change so the baseline stays honest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaignId, modelId, modelVersionId, environmentId, environmentVersionId, assetIds.join(',')],
  );

  const [briefText, setBriefText] = useState('');
  const [images, setImages] = useState(2);
  const [videos, setVideos] = useState(1);
  const [stories, setStories] = useState(1);
  const [storyFrames, setStoryFrames] = useState(2);
  const [allowStyleVariation, setAllowStyleVariation] = useState(false);
  const [run, setRun] = useState<CampaignGenerationRunRecord | null>(null);
  const [jobs, setJobs] = useState<CampaignRunJobRecord[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const runs = await service.listRuns(SEED_CONTENT_WORKSPACE_ID);
    const latest = runs.find((candidate) => candidate.campaignId === campaignId) ?? null;
    setRun(latest);
    setJobs(latest ? await (service as unknown as { store: { listJobs(runId: string): Promise<CampaignRunJobRecord[]> } }).store.listJobs(latest.id) : []);
  }, [service, campaignId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const plannedMix = describePlanMix({
    jobs: [],
    totals: { images, videos, stories, jobs: images + videos + stories },
    sharedBaseline: true,
    variations: { allowStyleVariation, allowPlacementVariation: false, notes: '' },
    rulesApplied: [],
    plannedAt: '',
  });
  const modelPins = pins.filter((pin) => pin.pinType === 'model_version');

  async function handleGenerate() {
    if (busy) return;
    setBusy(true);
    try {
      const created = await service.createCampaignGenerationRun(SEED_CONTENT_WORKSPACE_ID, 'demo-user', {
        briefText,
        mediaPlan: { images, videos, stories, storyFrames },
        variations: { allowStyleVariation, notes: allowStyleVariation ? 'Style may vary per child; identity and environment stay locked.' : undefined },
        campaignId,
        modelId,
        modelVersionId,
        environmentId,
        environmentVersionId,
        assetIds,
      });
      if (!created.eligible) {
        toast({ title: 'Content set blocked', description: created.blocking[0], tone: 'error' });
        await refresh();
        return;
      }
      const submitted = await service.submitCampaignGenerationRun(created.run.id, SEED_CONTENT_WORKSPACE_ID, 'demo-user');
      if (submitted.blocking.length > 0) {
        toast({
          title: 'Content set partially completed',
          description: `${submitted.run.completedJobsCount} of ${submitted.run.totalJobsCount} child jobs succeeded.`,
          tone: 'error',
        });
      } else {
        toast({
          title: 'Content set generated',
          description: `${plannedMix} — outputs are in Gallery, traceable to this run.`,
          tone: 'success',
        });
      }
      await refresh();
    } catch (error) {
      toast({
        title: 'Could not run the content set',
        description: error instanceof Error ? error.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry() {
    if (!run || busy) return;
    setBusy(true);
    try {
      await service.retryFailedRunJobs(SEED_CONTENT_WORKSPACE_ID, run.id, 'demo-user');
      toast({ title: 'Retry finished', description: 'Failed child jobs were resubmitted under the same run.', tone: 'success' });
      await refresh();
    } catch (error) {
      toast({
        title: 'Retry not available',
        description: error instanceof Error ? error.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <h3 className="lf-envpanel__heading">Generate full content set</h3>
        <p className="lf-tile__description">
          One brief → one coordinated multi-format run. Images, videos and stories share one locked
          baseline (model version, Character Sheet identity, environment and assets) so the whole set
          stays consistent.
        </p>

        {/* Brief input */}
        <div className="lf-sheet__section" style={{ marginTop: 'var(--lf-space-3)' }}>
          <label className="lf-field__label" htmlFor="lf-cset-brief">Campaign brief</label>
          <textarea
            id="lf-cset-brief"
            className="lf-textarea"
            placeholder="Objective, theme, scene, audience…"
            value={briefText}
            onChange={(event) => setBriefText(event.target.value)}
          />
        </div>

        {/* Structured media plan */}
        <div className="lf-envcard__badges" style={{ gap: 'var(--lf-space-4)', marginTop: 'var(--lf-space-3)' }}>
          <div className="lf-sheet__section">
            <label className="lf-field__label" htmlFor="lf-cset-images">Images</label>
            <select id="lf-cset-images" className="lf-input" value={images} onChange={(event) => setImages(Number(event.target.value))}>
              {[0, 1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </div>
          <div className="lf-sheet__section">
            <label className="lf-field__label" htmlFor="lf-cset-videos">Videos</label>
            <select id="lf-cset-videos" className="lf-input" value={videos} onChange={(event) => setVideos(Number(event.target.value))}>
              {[0, 1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </div>
          <div className="lf-sheet__section">
            <label className="lf-field__label" htmlFor="lf-cset-stories">Stories</label>
            <select id="lf-cset-stories" className="lf-input" value={stories} onChange={(event) => setStories(Number(event.target.value))}>
              {[0, 1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </div>
          {stories > 0 ? (
            <div className="lf-sheet__section">
              <label className="lf-field__label" htmlFor="lf-cset-frames">Frames per story</label>
              <select id="lf-cset-frames" className="lf-input" value={storyFrames} onChange={(event) => setStoryFrames(Number(event.target.value))}>
                {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </div>
          ) : null}
        </div>

        {/* Reviewable plan + locked baseline summary */}
        <div className="lf-sheet__section" style={{ marginTop: 'var(--lf-space-3)' }}>
          <h4 style={{ margin: '0 0 var(--lf-space-2)' }}>Planned output mix</h4>
          <div className="lf-envcard__badges">
            <Badge tone="primary" dot>{plannedMix}</Badge>
            <Badge tone="neutral">One shared locked baseline</Badge>
          </div>
          <p className="lf-field__hint" style={{ marginTop: 'var(--lf-space-2)' }}>
            <LockIcon size={12} />{' '}
            {modelPins.length > 0
              ? `Model pins (${modelPins.map((pin) => (pin.resolvedDetails as { modelName?: string }).modelName ?? pin.sourceRecordId).join(', ')}) are enforced against their Character Sheet identity baseline in every child job.`
              : 'No model pinned — the set runs on brief + environment/assets only.'}
            {environmentId ? ' Environment and asset versions stay pinned for the whole set.' : ''}
          </p>
          <label className="lf-envlock__rights" htmlFor="lf-cset-var">
            <input
              id="lf-cset-var"
              type="checkbox"
              checked={allowStyleVariation}
              onChange={(event) => setAllowStyleVariation(event.target.checked)}
            />
            <span>
              Allow controlled style variation per child job (identity, environment and locked assets
              never vary)
            </span>
          </label>
        </div>

        <div className="lf-dialogactions" style={{ justifyContent: 'flex-start', marginTop: 'var(--lf-space-3)' }}>
          <Button
            variant="primary"
            disabled={busy || briefText.trim().length === 0 || images + videos + stories === 0}
            onClick={() => void handleGenerate()}
          >
            {busy ? 'Running…' : `Generate content set (${images + videos + stories} jobs)`}
          </Button>
        </div>

        {/* Run progress */}
        {run ? (
          <div className="lf-sheet__section" style={{ marginTop: 'var(--lf-space-4)' }}>
            <h4 style={{ margin: '0 0 var(--lf-space-2)' }}>Run progress</h4>
            <div className="lf-envcard__badges" style={{ marginBottom: 'var(--lf-space-2)' }}>
              <Badge tone={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'primary'} dot>
                {RUN_STATUS_LABEL[run.status] ?? run.status}
              </Badge>
              <Badge tone="neutral">
                {run.completedJobsCount}/{run.totalJobsCount} completed
              </Badge>
              {run.failedJobsCount > 0 ? <Badge tone="danger">{run.failedJobsCount} failed</Badge> : null}
            </div>
            <ul className="lf-sheet__trait-list" style={{ margin: 0 }}>
              {jobs.map((job) => (
                <li key={job.id} className={`lf-sheet__trait-row${job.status === 'failed' ? ' is-protected' : ''}`}>
                  <span className="lf-sheet__trait-key">
                    {job.mediaType} — {job.plannedRole}
                  </span>
                  <span className="lf-sheet__trait-value">{JOB_STATUS_LABEL[job.status] ?? job.status}</span>
                </li>
              ))}
            </ul>
            {run.failedJobsCount > 0 ? (
              <div className="lf-dialogactions" style={{ justifyContent: 'flex-start', marginTop: 'var(--lf-space-2)' }}>
                <Button variant="secondary" disabled={busy} onClick={() => void handleRetry()}>
                  {busy ? 'Retrying…' : 'Retry failed child jobs'}
                </Button>
              </div>
            ) : null}
            <p className="lf-library__note" style={{ marginTop: 'var(--lf-space-2)' }}>
              Outputs are ingested into Gallery as one coordinated content set, traceable to this run
              ({run.id.slice(0, 12)}…) — never added to the Library.
            </p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
