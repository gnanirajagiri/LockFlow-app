/**
 * Prompt 30 — shared module-level CampaignRunService for the campaign
 * content-set panels.
 *
 * Prompt 29's panel previously constructed its own service/store per mount,
 * so the prompt-30 review panel could never see the runs (or their outputs).
 * Both panels now share ONE store/service instance (same remount-survival
 * pattern as every other factory in the app).
 *
 * Demo ingestion is honest: child jobs are created as real draft content-job
 * requests through the Content Studio, and each completed child run becomes a
 * real generated Gallery output via GalleryService.createGeneratedOutput —
 * stamped with `provider_run_id` + `campaign_generation_run_id` metadata so
 * review/handoff stays traceable to the orchestration run and the locked
 * baseline. Nothing is added to the Library. No secrets, no signed URLs.
 */
import { CampaignRunService, InMemoryCampaignRunStore } from '../../generation/campaignRunService';
import { InMemoryOutputReviewStore } from '../../generation/outputReviewService';
import { getContentService, getGalleryService } from './campaignServiceRefs';

let storeInstance: InMemoryCampaignRunStore | null = null;

/** The shared run store (same pattern as the rest of the app). */
export function getRunStore(): InMemoryCampaignRunStore {
  if (!storeInstance) storeInstance = new InMemoryCampaignRunStore();
  return storeInstance;
}

let reviewStoreInstance: InMemoryOutputReviewStore | null = null;

/** Shared output-review store (reviews/selections/links survive remounts). */
export function getReviewStore(): InMemoryOutputReviewStore {
  if (!reviewStoreInstance) reviewStoreInstance = new InMemoryOutputReviewStore();
  return reviewStoreInstance;
}

let serviceInstance: CampaignRunService | null = null;

/** Shared CampaignRunService over the shared store (demo media deps). */
export function getRunService(): CampaignRunService {
  if (serviceInstance) return serviceInstance;
  const gallery = getGalleryService();
  const content = getContentService();
  serviceInstance = new CampaignRunService(getRunStore(), {
    content: {
      createDraftJobRequest: (input, createdBy, workspaceId) =>
        content.createDraftJobRequest(input, createdBy, workspaceId),
    },
    submitImageRun: async ({ jobId, workspaceId, userId, prompt }) => {
      const runId = `run_${crypto.randomUUID()}`;
      await gallery.createGeneratedOutput(
        {
          workspaceId,
          contentJobRequestId: jobId,
          title: `Campaign image — ${prompt.slice(0, 40) || 'generated set'}`,
          outputType: 'image',
          status: 'ready_for_review',
          mediaStoragePath: 'workspaces/priv/media/generated',
          width: 1024,
          height: 1024,
          fileSizeBytes: 1024,
          mimeType: 'image/png',
          metadata: { provider_generated: true, provider_run_id: runId, demo: true },
        },
        userId,
        workspaceId,
      );
      return { run: demoProviderRun(runId, workspaceId, jobId), eligible: true, blocking: [] };
    },
    submitVideoRun: async ({ jobId, workspaceId, userId, prompt, selection }) => {
      const runId = `run_${crypto.randomUUID()}`;
      void prompt;
      const isStory = selection.mediaFlavor === 'story';
      const frames = isStory ? Math.max(1, selection.storyFrames?.length ?? 1) : 1;
      for (let frame = 1; frame <= frames; frame += 1) {
        await gallery.createGeneratedOutput(
          {
            workspaceId,
            contentJobRequestId: jobId,
            title: isStory ? `Campaign story frame ${frame}/${frames}` : 'Campaign video',
            outputType: isStory ? 'story' : 'video',
            status: 'ready_for_review',
            mediaStoragePath: 'workspaces/priv/media/generated',
            width: isStory ? 1080 : 1920,
            height: isStory ? 1920 : 1080,
            fileSizeBytes: 1024,
            mimeType: isStory ? 'image/png' : 'video/mp4',
            outputIndex: frame,
            metadata: {
              provider_generated: true,
              provider_run_id: runId,
              demo: true,
              ...(isStory
                ? {
                    story_group_key: `story:${runId}`,
                    story_sequence: frame,
                    story_sequence_total: frames,
                    story_frame_label: selection.storyFrames?.[frame - 1]?.label ?? `Frame ${frame}`,
                  }
                : {}),
            },
          },
          userId,
          workspaceId,
        );
      }
      return { run: demoProviderRun(runId, workspaceId, jobId), eligible: true, blocking: [] };
    },
    resolveBaseline: async () => null,
  });
  return serviceInstance;
}

/**
 * A minimal completed provider-run record (demo only — no real provider).
 * Mirrors the GenerationProviderRunRecord shape the run service expects.
 */
function demoProviderRun(runId: string, workspaceId: string, jobId: string) {
  return {
    id: runId,
    workspaceId,
    contentJobRequestId: jobId,
    createdBy: 'demo-user',
    providerName: 'development-fake',
    providerRequestId: null,
    idempotencyKey: `k_${crypto.randomUUID()}`,
    status: 'completed' as const,
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
  };
}

/**
 * Stamps the campaign-run provenance onto every output of a submitted run.
 * A demo output belongs to this run when its `provider_run_id` matches one of
 * the run's child media jobs. Idempotent — already-stamped outputs are left
 * alone so retries never re-stamp.
 */
export async function stampRunOutputs(runId: string, workspaceId: string): Promise<void> {
  const gallery = getGalleryService();
  const jobs = await getRunStore().listJobs(runId);
  const jobIds = new Set(jobs.map((job) => job.mediaGenerationJobId).filter(Boolean) as string[]);
  if (jobIds.size === 0) return;
  const outputs = await gallery.listOutputs(workspaceId);
  for (const output of outputs) {
    const metadata = (output.metadata ?? {}) as Record<string, unknown>;
    if (metadata['campaign_generation_run_id'] === runId) continue;
    const providerRunId = metadata['provider_run_id'];
    if (typeof providerRunId === 'string' && jobIds.has(providerRunId)) {
      await gallery.updateOutputMetadata(
        output.id,
        { metadata: { ...metadata, campaign_generation_run_id: runId } },
        workspaceId,
      );
    }
  }
}
