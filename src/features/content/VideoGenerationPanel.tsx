/**
 * Video generation panel — short-form Phase 1 (4/6/8 s clips for Video and
 * Story plans). Scene/Beat selection is beat-aware; duration and aspect are
 * constrained to the Phase-1 contract; a separate video acknowledgement is
 * required; live status and safe retry follow the image panel's patterns.
 *
 * Calls only the VideoGenerationService — never a provider adapter.
 * Dialogue/overlay text is guidance only; no audio/speech/lip-sync claims.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { useToast } from '../../components/ui/Toast';
import { isDemoMode } from '../../lib/env';
import { createVideoGenerationService, DEMO_GENERATION_CONFIG } from '../../generation/factory';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import { ALLOWED_DURATIONS, ALLOWED_ASPECT_RATIOS } from '../../generation/videoTypes';
import type { AllowedAspectRatio, AllowedDuration } from '../../generation/videoTypes';

const VIDEO_ACKNOWLEDGEMENT =
  'I confirm I have rights to use the selected references and understand this uses my workspace video allowance.';

const STATUS_LABEL: Record<string, string> = {
  created: 'Preparing',
  submitted: 'Queued',
  queued: 'Queued',
  processing: 'Generating',
  review: 'Ready for review',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  draft: 'Draft',
};

export interface VideoGenerationPanelProps {
  jobId: string | null;
  jobStatus: string;
  requestedOutputType: string;
  projectId: string;
  pinsLoaded: boolean;
  onSubmitted: () => void;
}

export function VideoGenerationPanel({
  jobId,
  jobStatus,
  requestedOutputType,
  projectId,
  pinsLoaded,
  onSubmitted,
}: VideoGenerationPanelProps) {
  const { toast } = useToast();
  const { service, repo } = useMemo(() => createVideoGenerationService(), []);

  const [config, setConfig] = useState(DEMO_GENERATION_CONFIG);
  const [scenes, setScenes] = useState<Array<{ id: string; title: string }>>([]);
  const [beatsByScene, setBeatsByScene] = useState<Record<string, Array<{ id: string; title: string }>>>({});
  const [sceneId, setSceneId] = useState('');
  const [beatId, setBeatId] = useState('');
  const [duration, setDuration] = useState<AllowedDuration>(6);
  const [aspect, setAspect] = useState<AllowedAspectRatio>(requestedOutputType === 'story' ? '9:16' : '9:16');
  const [outputCount, setOutputCount] = useState(1);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [outputsReady, setOutputsReady] = useState(0);
  const [blocking, setBlocking] = useState<string[]>([]);
  // Prompt 28 — media flavor (video vs story), prompt bar, story frame plan.
  const [mediaFlavor, setMediaFlavor] = useState<'video' | 'story'>(
    requestedOutputType === 'story' ? 'story' : 'video',
  );
  const [promptText, setPromptText] = useState('');
  const [variantBusy, setVariantBusy] = useState(false);

  useEffect(() => {
    void repo.getConfig().then(setConfig).catch(() => undefined);
  }, [repo]);

  // Scenes/beats for beat-aware selection (project-scoped read).
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const { getContentRepository } = await import('../../data/contentFactory');
        const { ContentStudioService: ContentService } = await import('../../services/contentService');
        const { LibraryService } = await import('../../services/libraryService');
        const { ModelsService } = await import('../../services/modelsService');
        const { EnvironmentsService } = await import('../../services/environmentsService');
        const { getLibraryRepository } = await import('../../data/libraryFactory');
        const { getModelsRepository } = await import('../../data');
        const { getEnvironmentsRepository } = await import('../../data/environmentsFactory');
        const content = new ContentService(getContentRepository(), {
          library: new LibraryService(getLibraryRepository()),
          models: new ModelsService(getModelsRepository()),
          environments: new EnvironmentsService(getEnvironmentsRepository()),
        });
        const sceneRows = await content.listScenes(projectId, SEED_CONTENT_WORKSPACE_ID);
        if (cancelled) return;
        setScenes(sceneRows.map((scene) => ({ id: scene.id, title: `Scene ${scene.sceneOrder}: ${scene.title}` })));
        const beatMap: Record<string, Array<{ id: string; title: string }>> = {};
        for (const scene of sceneRows) {
          const beats = await content.listBeats(scene.id, SEED_CONTENT_WORKSPACE_ID);
          beatMap[scene.id] = beats.map((beat) => ({ id: beat.id, title: `Beat ${beat.beatOrder}: ${beat.title}` }));
        }
        if (!cancelled) setBeatsByScene(beatMap);
      } catch {
        if (!cancelled) setScenes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const refreshStatus = useCallback(async () => {
    if (!jobId) {
      setRunStatus(null);
      return;
    }
    try {
      const status = await service.getRunStatus(jobId, SEED_CONTENT_WORKSPACE_ID);
      setRunStatus(status.run?.status ?? null);
      setOutputsReady(status.outputsReady);
    } catch {
      setRunStatus(null);
    }
  }, [jobId, service]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, jobStatus]);

  const providerConfigured = config.videoGenerationEnabled && config.videoProviderName !== 'none';
  const isRunning = ['created', 'submitted', 'queued', 'processing'].includes(runStatus ?? '');
  const isFailed = runStatus === 'failed' || jobStatus === 'failed';
  const completedInReview = runStatus === 'completed' || jobStatus === 'review' || jobStatus === 'completed';
  const isDraftJob = jobStatus === 'draft' && !isRunning && runStatus !== 'completed';
  const eligibleType = ['video', 'story', 'content_set'].includes(requestedOutputType);
  const buttonLabel = mediaFlavor === 'story' ? `Generate story (${outputCount} frames)` : `Generate clip${outputCount > 1 ? ` (${outputCount})` : ''}`;

  /** Prompt 28 — media variant from the completed run (inherits baseline). */
  async function handleVariant() {
    if (!jobId || variantBusy) return;
    setVariantBusy(true);
    try {
      const result = await service.createMediaVariantJob(jobId, SEED_CONTENT_WORKSPACE_ID, 'demo-user', {});
      if (!result.eligible) {
        toast({ title: 'Variant blocked', description: result.blocking[0], tone: 'error' });
        return;
      }
      toast({
        title: 'Media variant started',
        description: 'The variant inherits the original locked inputs and appears in Gallery when ready.',
        tone: 'success',
      });
      onSubmitted();
    } catch (error) {
      toast({
        title: 'Could not create the variant',
        description: error instanceof Error ? error.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setVariantBusy(false);
    }
  }

  async function handleSubmit(isRetry: boolean) {
    if (!jobId || submitting) return;
    setSubmitting(true);
    try {
      const selection = {
        sceneId: sceneId || null,
        beatId: beatId || null,
        durationSeconds: duration,
        aspectRatio: aspect,
        outputCount,
        // Prompt 28 — story runs derive an ordered frame plan from the count;
        // each frame intent is recorded in the locked snapshot and on the
        // grouped Gallery outputs.
        ...(mediaFlavor === 'story'
          ? {
              mediaFlavor: 'story' as const,
              storyFrames: Array.from({ length: outputCount }, (_, index) => ({
                label: `Frame ${index + 1}`,
                actionDescription: promptText.trim() || 'Follow the brief prompt',
              })),
            }
          : { mediaFlavor: 'video' as const }),
      };
      const result = isRetry
        ? await service.retryVideoGeneration(jobId, SEED_CONTENT_WORKSPACE_ID, 'demo-user')
        : await service.submitVideoGeneration(jobId, SEED_CONTENT_WORKSPACE_ID, 'demo-user', {
            selection,
            prompt: promptText.trim() || 'LockFlow demo video generation run',
          });
      if (!result.eligible) {
        setBlocking(result.blocking);
        toast({ title: 'Clip is not eligible for generation', description: result.blocking[0], tone: 'error' });
        return;
      }
      setBlocking([]);
      toast({
        title: isRetry
          ? 'Media retry submitted'
          : mediaFlavor === 'story'
            ? 'Story generation submitted'
            : 'Video generation submitted',
        description:
          mediaFlavor === 'story'
            ? 'Ordered story frames will appear grouped in Gallery when ingestion completes.'
            : 'Clips will appear in Gallery when ingestion completes.',
        tone: 'success',
      });
      await refreshStatus();
      onSubmitted();
    } catch (error) {
      toast({
        title: 'Could not start video generation',
        description: error instanceof Error ? error.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (!eligibleType) return null;

  return (
    <Card>
      <CardBody>
        <h3 className="lf-envpanel__heading">Generate clip</h3>

        <div className="lf-envcard__badges" style={{ marginBottom: 'var(--lf-space-3)' }}>
          <Badge tone={providerConfigured ? 'success' : 'neutral'}>
            {providerConfigured ? `Video provider: ${config.videoProviderName}` : 'No video provider configured'}
          </Badge>
          <Badge tone="neutral">4 / 6 / 8 s clips</Badge>
          <Badge tone="neutral">Short-form only — no audio or lip sync</Badge>
        </div>

        {!providerConfigured ? (
          <p className="lf-tile__description">
            Video generation is fail-closed: no production provider is configured for this deployment.
            {isDemoMode ? ' Demo mode uses the development fake video provider with clearly marked placeholder clips.' : ''}
          </p>
        ) : null}

        {runStatus && !isDraftJob ? (
          <div className="lf-envref__state" style={{ marginBottom: 'var(--lf-space-3)' }}>
            <Badge tone={isFailed ? 'danger' : completedInReview ? 'success' : 'primary'} dot>
              {completedInReview ? 'Ready for review' : STATUS_LABEL[runStatus] ?? runStatus}
            </Badge>
            {outputsReady > 0 ? (
              <span className="lf-tile__description">{outputsReady} clip(s) ingested — see Gallery.</span>
            ) : null}
          </div>
        ) : null}

        {blocking.length > 0 ? (
          <ul className="lf-alertbox" role="alert" style={{ margin: 0, paddingLeft: '1.2em' }}>
            {blocking.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}

        {isDraftJob && providerConfigured ? (
          <>
            {/* Prompt 28 — media-type selection: standalone video vs story sequence. */}
            <div className="lf-sheet__section" style={{ marginBottom: 'var(--lf-space-3)' }}>
              <label className="lf-field__label" htmlFor="lf-vid-flavor">Media type</label>
              <select
                id="lf-vid-flavor"
                className="lf-input"
                value={mediaFlavor}
                onChange={(event) => setMediaFlavor(event.target.value as 'video' | 'story')}
              >
                <option value="video">Video — standalone clip(s)</option>
                <option value="story">Story — ordered frame sequence (grouped in Gallery)</option>
              </select>
              <span className="lf-field__hint">
                {mediaFlavor === 'story'
                  ? `Story runs produce ${outputCount} ordered frame${outputCount === 1 ? '' : 's'} under one grouped story set.`
                  : 'Video runs produce independent clip(s) with scene/beat provenance.'}
              </span>
            </div>

            {/* Prompt 28 — prompt bar for media intent. */}
            <div className="lf-sheet__section" style={{ marginBottom: 'var(--lf-space-3)' }}>
              <label className="lf-field__label" htmlFor="lf-vid-prompt">Prompt</label>
              <textarea
                id="lf-vid-prompt"
                className="lf-textarea"
                placeholder="Describe the motion, subject and setting…"
                value={promptText}
                onChange={(event) => setPromptText(event.target.value)}
              />
              <span className="lf-field__hint">
                The prompt is kept verbatim and normalized with deterministic, auditable rules; the
                transformation record is stored with the run. Locked model inputs are enforced against
                their Character Sheet identity baseline.
              </span>
            </div>

            <div className="lf-sheet__section">
              <label className="lf-field__label" htmlFor="lf-vid-scene">Scene</label>
              <select
                id="lf-vid-scene"
                className="lf-input"
                value={sceneId}
                onChange={(event) => {
                  setSceneId(event.target.value);
                  setBeatId('');
                }}
              >
                <option value="">No specific scene (single-clip plan)</option>
                {scenes.map((scene) => (
                  <option key={scene.id} value={scene.id}>{scene.title}</option>
                ))}
              </select>
            </div>

            {sceneId && (beatsByScene[sceneId]?.length ?? 0) > 0 ? (
              <div className="lf-sheet__section">
                <label className="lf-field__label" htmlFor="lf-vid-beat">Beat</label>
                <select
                  id="lf-vid-beat"
                  className="lf-input"
                  value={beatId}
                  onChange={(event) => setBeatId(event.target.value)}
                >
                  <option value="">Whole scene</option>
                  {(beatsByScene[sceneId] ?? []).map((beat) => (
                    <option key={beat.id} value={beat.id}>{beat.title}</option>
                  ))}
                </select>
                <span className="lf-field__hint">
                  The scene and beat snapshot is frozen at submission — later storyboard edits never
                  change a submitted clip. Overlay text is guidance only; no speech is generated.
                </span>
              </div>
            ) : null}

            <div className="lf-envcard__badges" style={{ gap: 'var(--lf-space-4)' }}>
              <div className="lf-sheet__section">
                <label className="lf-field__label" htmlFor="lf-vid-duration">Duration</label>
                <select
                  id="lf-vid-duration"
                  className="lf-input"
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value) as AllowedDuration)}
                >
                  {ALLOWED_DURATIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>{seconds} seconds</option>
                  ))}
                </select>
              </div>
              <div className="lf-sheet__section">
                <label className="lf-field__label" htmlFor="lf-vid-aspect">Aspect ratio</label>
                <select
                  id="lf-vid-aspect"
                  className="lf-input"
                  value={aspect}
                  onChange={(event) => setAspect(event.target.value as AllowedAspectRatio)}
                >
                  {ALLOWED_ASPECT_RATIOS.map((ratio) => (
                    <option key={ratio} value={ratio}>{ratio}{ratio === '9:16' ? ' (vertical)' : ratio === '16:9' ? ' (landscape)' : ' (square)'}</option>
                  ))}
                </select>
              </div>
              <div className="lf-sheet__section">
                <label className="lf-field__label" htmlFor="lf-vid-count">Clips</label>
                <select
                  id="lf-vid-count"
                  className="lf-input"
                  value={outputCount}
                  onChange={(event) => setOutputCount(Number(event.target.value))}
                >
                  {Array.from({ length: config.videoMaxOutputsPerJob }, (_, index) => index + 1).map((count) => (
                    <option key={count} value={count}>{count}</option>
                  ))}
                </select>
              </div>
            </div>

            <label className="lf-envlock__rights" htmlFor="lf-vid-ack">
              <input
                id="lf-vid-ack"
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>{VIDEO_ACKNOWLEDGEMENT}</span>
            </label>

            <div className="lf-dialogactions" style={{ justifyContent: 'flex-start', marginTop: 'var(--lf-space-3)' }}>
              <Button
                variant="primary"
                disabled={!acknowledged || submitting || !pinsLoaded}
                onClick={() => void handleSubmit(false)}
              >
                {submitting ? 'Submitting…' : buttonLabel}
              </Button>
            </div>
          </>
        ) : null}

        {isFailed && !isRunning ? (
          <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
            <Button variant="secondary" onClick={() => void handleSubmit(true)} disabled={submitting}>
              {submitting ? 'Retrying…' : 'Retry failed run'}
            </Button>
          </div>
        ) : null}

        {/* Prompt 28 — media variant from a completed run. */}
        {completedInReview && !isRunning ? (
          <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
            <Button variant="secondary" disabled={variantBusy} onClick={() => void handleVariant()}>
              {variantBusy ? 'Creating variant…' : 'Generate variant (inherits locked inputs)'}
            </Button>
          </div>
        ) : null}

        <p className="lf-library__note">
          Clips are private, workspace-scoped media ingested into Gallery with scene/beat provenance —
          never added to the Library. Long-form studio video belongs to a later phase.
        </p>
      </CardBody>
    </Card>
  );
}
