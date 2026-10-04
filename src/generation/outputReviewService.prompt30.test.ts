/**
 * Prompt 30 — generated-set approval, selection & campaign handoff.
 * Service-boundary tests over the in-memory store:
 *
 *   1. Per-output approve/reject/shortlist with server-decided transitions.
 *   2. Rejected outputs are blocked from selection and handoff.
 *   3. Only approved outputs can be handed off; handoff uses the existing
 *      campaign item rules and preserves generation traceability.
 *   4. Story outputs keep grouping/order through review and handoff.
 *   5. Outputs stay in Gallery — never converted to Library assets.
 *   6. Cross-workspace review/selection/handoff are rejected.
 */
import { describe, expect, it } from 'vitest';
import { OutputReviewService, InMemoryOutputReviewStore } from './outputReviewService';
import type { OutputReviewDependencies } from './outputReviewService';
import { canReviewTransition, isHandoffEligible, isSelectable } from './outputReviewWorkflow';
import type { GalleryOutputRecord } from '../domain/gallery/types';
import type { CampaignItemRecord } from '../domain/campaigns/types';

const WS = '11111111-1111-1111-1111-111111111111';
const OTHER_WS = '22222222-2222-2222-2222-222222222222';
const USER = '44444444-4444-4444-4444-444444444444';
const RUN = 'crun_test-run';
const CAMPAIGN = 'campaign-1';

/** Per-test factory: ids restart at out-1 in every test (deterministic). */
function makeOutputFactory() {
  let outputCounter = 0;
  return function makeOutput(overrides: {
    metadata?: Record<string, unknown>;
    outputType?: GalleryOutputRecord['outputType'];
    outputIndex?: number;
    title?: string;
  }): GalleryOutputRecord {
    outputCounter += 1;
    return buildOutput(outputCounter, overrides);
  };
}

function buildOutput(
  counter: number,
  overrides: {
    metadata?: Record<string, unknown>;
    outputType?: GalleryOutputRecord['outputType'];
    outputIndex?: number;
    title?: string;
  },
): GalleryOutputRecord {
  return {
    id: `out-${counter}`,
    workspaceId: WS,
    contentJobRequestId: 'cjob-1',
    parentGalleryOutputId: null,
    title: overrides.title ?? `Generated ${counter}`,
    outputType: overrides.outputType ?? 'image',
    status: 'ready_for_review',
    mediaStoragePath: 'workspaces/priv/media',
    thumbnailStoragePath: null,
    durationSeconds: null,
    width: 1024,
    height: 1024,
    fileSizeBytes: 1024,
    mimeType: 'image/png',
    outputIndex: overrides.outputIndex ?? counter,
    metadata: {
      provider_generated: true,
      provider_run_id: `run-${Math.ceil(counter / 2)}`,
      campaign_generation_run_id: RUN,
      ...(overrides.metadata ?? {}),
    },
    createdBy: USER,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeDeps() {
  const createdItems: CampaignItemRecord[] = [];
  const deps: OutputReviewDependencies = {
    addCampaignItem: async (input) => {
      // Mirror the existing campaign rule: only approved Gallery outputs pass.
      const status = input.galleryOutputId.includes('rejected') ? 'ready_for_review' : 'approved';
      if (status !== 'approved') throw new Error('Only approved Gallery outputs can be added to a campaign.');
      const item: CampaignItemRecord = {
        id: `item-${createdItems.length + 1}`,
        campaignId: input.campaignId,
        galleryOutputId: input.galleryOutputId,
        status: 'planned',
        plannedChannel: input.plannedChannel ?? null,
        plannedFormat: null,
        plannedPublishAt: null,
        captionDraft: input.captionDraft ?? null,
        callToAction: null,
        notes: input.notes ?? null,
        sortOrder: createdItems.length,
        createdBy: input.createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        removedAt: null,
        plannedTimezone: null,
        planningStatus: null,
      };
      createdItems.push(item);
      return item;
    },
  };
  return { deps, createdItems };
}

async function makeService(outputs: GalleryOutputRecord[]) {
  const store = new InMemoryOutputReviewStore();
  store.seedOutputs(outputs);
  const { deps, createdItems } = makeDeps();
  const service = new OutputReviewService(store, deps);
  return { service, store, createdItems };
}

describe('review transitions are server-decided', () => {
  it('approves, rejects and shortlists individually', async () => {
    const makeOutput = makeOutputFactory();
    const { service } = await makeService([makeOutput({}), makeOutput({}), makeOutput({})]);
    const approved = await service.reviewGeneratedOutput(WS, 'out-1', 'approve', { reviewerId: USER });
    expect(approved.review.reviewStatus).toBe('approved');
    const rejected = await service.reviewGeneratedOutput(WS, 'out-2', 'reject', { reviewerId: USER, notes: 'off-brand' });
    expect(rejected.review.reviewStatus).toBe('rejected');
    expect(rejected.review.reviewNotes).toBe('off-brand');
    await service.reviewGeneratedOutput(WS, 'out-3', 'approve', { reviewerId: USER });
    const picked = await service.reviewGeneratedOutput(WS, 'out-3', 'shortlist', { reviewerId: USER });
    expect(picked.review.reviewStatus).toBe('shortlisted');
  });

  it('pure transition rules reject illegal moves', () => {
    expect(canReviewTransition('handed_off', 'approve').allowed).toBe(false);
    expect(canReviewTransition('selected_for_campaign', 'reject').allowed).toBe(false);
    expect(canReviewTransition('approved', 'approve').allowed).toBe(false);
    expect(canReviewTransition('pending_review', 'approve').allowed).toBe(true);
    expect(isHandoffEligible('approved')).toBe(true);
    expect(isHandoffEligible('shortlisted')).toBe(true);
    expect(isHandoffEligible('rejected')).toBe(false);
    expect(isHandoffEligible('pending_review')).toBe(false);
    expect(isSelectable('rejected')).toBe(false);
    expect(isSelectable('pending_review')).toBe(false);
    expect(isSelectable('approved')).toBe(true);
  });

  it('batch review approves a whole group', async () => {
    const makeOutput = makeOutputFactory();
    const { service } = await makeService([makeOutput({}), makeOutput({})]);
    const results = await service.batchReviewGeneratedOutputs(WS, {
      galleryOutputIds: ['out-1', 'out-2'],
      action: 'approve',
      reviewerId: USER,
    });
    expect(results.every((result) => result.review.reviewStatus === 'approved')).toBe(true);
  });
});

describe('selection gates', () => {
  it('blocks rejected and pending outputs from selections', async () => {
    const makeOutput = makeOutputFactory();
    const { service } = await makeService([makeOutput({}), makeOutput({})]);
    await service.reviewGeneratedOutput(WS, 'out-1', 'approve', { reviewerId: USER });
    await service.reviewGeneratedOutput(WS, 'out-2', 'reject', { reviewerId: USER });

    const selection = await service.createGeneratedOutputSelection(WS, { name: 'Launch picks', createdBy: USER, campaignGenerationRunId: RUN });

    await expect(
      service.addOutputToSelection(WS, selection.id, 'out-2', { actorId: USER }),
    ).rejects.toThrow(/only approved outputs can be added/i);

    await service.addOutputToSelection(WS, selection.id, 'out-1', { actorId: USER, selectionRole: 'hero' });
    const items = await service.listSelectionItems(WS, selection.id);
    expect(items).toHaveLength(1);
    expect(items[0]?.selectionRole).toBe('hero');
  });

  it('supports remove and reorder with audit', async () => {
    const makeOutput = makeOutputFactory();
    const { service, store } = await makeService([makeOutput({}), makeOutput({}), makeOutput({})]);
    for (const id of ['out-1', 'out-2', 'out-3']) {
      await service.reviewGeneratedOutput(WS, id, 'approve', { reviewerId: USER });
    }
    const selection = await service.createGeneratedOutputSelection(WS, { createdBy: USER });
    for (const id of ['out-1', 'out-2', 'out-3']) {
      await service.addOutputToSelection(WS, selection.id, id, { actorId: USER });
    }
    await service.reorderSelectionItems(WS, selection.id, ['out-3', 'out-1', 'out-2'], USER);
    let items = await service.listSelectionItems(WS, selection.id);
    expect(items.map((item) => item.galleryOutputId)).toEqual(['out-3', 'out-1', 'out-2']);

    await service.removeOutputFromSelection(WS, selection.id, 'out-1', USER);
    items = await service.listSelectionItems(WS, selection.id);
    expect(items.map((item) => item.galleryOutputId)).toEqual(['out-3', 'out-2']);

    const events = (await store.listAudit(WS)).map((row) => row.event);
    expect(events).toContain('generated_output_selection_reordered');
    expect(events).toContain('generated_output_removed_from_selection');
  });
});

describe('set review view keeps story grouping and order', () => {
  it('sorts story frames by sequence within their group', async () => {
    const makeOutput = makeOutputFactory();
    const outputs = [
      makeOutput({ outputType: 'story', outputIndex: 5, metadata: { story_group_key: 'story:r1', story_sequence: 2, story_sequence_total: 2, story_frame_label: 'Reveal' } }),
      makeOutput({ outputType: 'story', outputIndex: 4, metadata: { story_group_key: 'story:r1', story_sequence: 1, story_sequence_total: 2, story_frame_label: 'Opening' } }),
      makeOutput({ outputType: 'image', outputIndex: 1 }),
    ];
    const { service } = await makeService(outputs);
    const detail = await service.getGeneratedSetReviewDetail(WS, RUN);
    const storyViews = detail.outputs.filter((view) => view.storyGroupKey === 'story:r1');
    expect(storyViews.map((view) => view.storySequence)).toEqual([1, 2]);
    expect(storyViews[0]?.storyFrameLabel).toBe('Opening');
    expect(detail.outputs.map((view) => view.galleryOutput.outputType)).toEqual(['image', 'story', 'story']);
    expect(detail.counts.pending).toBe(3);
  });
});

describe('campaign handoff', () => {
  it('hands approved outputs off with full traceability and marks them handed_off', async () => {
    const makeOutput = makeOutputFactory();
    const { service, store, createdItems } = await makeService([makeOutput({}), makeOutput({})]);
    await service.reviewGeneratedOutput(WS, 'out-1', 'approve', { reviewerId: USER });
    await service.reviewGeneratedOutput(WS, 'out-2', 'approve', { reviewerId: USER });

    const result = await service.handoffOutputsToCampaign(WS, {
      campaignId: CAMPAIGN,
      galleryOutputIds: ['out-1', 'out-2'],
      plannedChannel: 'instagram',
      actorId: USER,
    });
    expect(result.blocked).toEqual([]);
    expect(result.items).toHaveLength(2);
    expect(result.links).toHaveLength(2);
    expect(createdItems).toHaveLength(2);
    // Traceability: link → source run + generation job.
    expect(result.links.every((link) => link.sourceCampaignGenerationRunId === RUN)).toBe(true);
    expect(result.links.every((link) => link.sourceGenerationJobId !== null)).toBe(true);
    expect(result.links.every((link) => link.campaignItemId !== null)).toBe(true);
    // Workflow state advanced.
    const detail = await service.getGeneratedSetReviewDetail(WS, RUN);
    expect(detail.counts.handedOff).toBe(2);

    const events = (await store.listAudit(WS)).map((row) => row.event);
    expect(events).toContain('generated_output_handoff_requested');
    expect(events).toContain('generated_output_handed_off_to_campaign');
  });

  it('blocks rejected and pending outputs from handoff', async () => {
    const makeOutput = makeOutputFactory();
    const { service, store } = await makeService([makeOutput({}), makeOutput({})]);
    await service.reviewGeneratedOutput(WS, 'out-1', 'reject', { reviewerId: USER });
    // out-2 stays pending_review.

    const result = await service.handoffOutputsToCampaign(WS, {
      campaignId: CAMPAIGN,
      galleryOutputIds: ['out-1', 'out-2'],
      actorId: USER,
    });
    expect(result.items).toHaveLength(0);
    expect(result.blocked).toHaveLength(2);
    expect(result.blocked.join(' ')).toMatch(/approval required|pending review/);

    const blockedEvents = await store.listAudit(WS, { event: 'generated_output_handoff_blocked' });
    expect(blockedEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps outputs in Gallery — nothing becomes a Library asset', async () => {
    const makeOutput = makeOutputFactory();
    const { service } = await makeService([makeOutput({})]);
    await service.reviewGeneratedOutput(WS, 'out-1', 'approve', { reviewerId: USER });
    const result = await service.handoffOutputsToCampaign(WS, {
      campaignId: CAMPAIGN,
      galleryOutputIds: ['out-1'],
      actorId: USER,
    });
    // The campaign item references the SAME Gallery output id — no copy.
    expect(result.items[0]?.galleryOutputId).toBe('out-1');
    const detail = await service.getGeneratedSetReviewDetail(WS, RUN);
    expect(detail.outputs.some((view) => view.galleryOutput.id === 'out-1')).toBe(true);
  });
});

describe('workspace security', () => {
  it('rejects cross-workspace review, selection and handoff', async () => {
    const makeOutput = makeOutputFactory();
    const { service } = await makeService([makeOutput({})]);
    await expect(
      service.reviewGeneratedOutput(OTHER_WS, 'out-1', 'approve', { reviewerId: USER }),
    ).rejects.toThrow(/access to this workspace/);
    const selection = await service.createGeneratedOutputSelection(WS, { createdBy: USER });
    await expect(
      service.addOutputToSelection(OTHER_WS, selection.id, 'out-1', { actorId: USER }),
    ).rejects.toThrow(/access to this workspace/);
    await expect(
      service.handoffOutputsToCampaign(OTHER_WS, { campaignId: CAMPAIGN, galleryOutputIds: ['out-1'], actorId: USER }),
    ).rejects.toThrow(/access to this workspace/);
  });
});
