/**
 * Prompt 30 — OutputReviewService: workspace-scoped review, selection and
 * campaign-handoff workflows over generated outputs.
 *
 * Uses the existing seams only:
 *   * Gallery outputs stay in Gallery (no Library duplication, no copies);
 *   * Campaign handoff creates real campaign items through the existing
 *     CampaignsService.addItem rules (approved-status eligibility, channel
 *     planning, provenance) plus a traceability link row back to the source
 *     generation job / campaign run;
 *   * All state transitions and eligibility decisions are server-side.
 */
import {
  canReviewTransition,
  isHandoffEligible,
  isSelectable,
} from './outputReviewWorkflow';
import type {
  CampaignOutputLinkRecord,
  GeneratedOutputAuditEvent,
  GeneratedOutputAuditRow,
  GeneratedOutputReviewAction,
  GeneratedOutputReviewRecord,
  GeneratedOutputReviewStatus,
  GeneratedOutputSelectionItemRecord,
  GeneratedOutputSelectionRecord,
  SetReviewOutputView,
} from './outputReviewWorkflow';
import type { GalleryOutputRecord } from '../domain/gallery/types';
import type { CampaignItemRecord } from '../domain/campaigns/types';

// ── Store contract ───────────────────────────────────────────────────────────

export interface OutputReviewStore {
  getReviewByOutput(galleryOutputId: string): Promise<GeneratedOutputReviewRecord | null>;
  ensureReview(input: {
    workspaceId: string;
    galleryOutputId: string;
    generationJobId: string | null;
    campaignGenerationRunId: string | null;
  }): Promise<GeneratedOutputReviewRecord>;
  updateReview(
    reviewId: string,
    patch: Partial<Pick<GeneratedOutputReviewRecord, 'reviewStatus' | 'reviewNotes' | 'reviewedBy' | 'reviewedAt'>>,
  ): Promise<GeneratedOutputReviewRecord>;
  listReviewsForRun(campaignGenerationRunId: string): Promise<GeneratedOutputReviewRecord[]>;
  getOutput(galleryOutputId: string): Promise<GalleryOutputRecord>;
  listOutputsForJob(generationJobId: string): Promise<GalleryOutputRecord[]>;
  listOutputsForRun(campaignGenerationRunId: string): Promise<GalleryOutputRecord[]>;
  /** Every generated output in the workspace (handoff-candidate source). */
  listWorkspaceOutputs(workspaceId: string): Promise<GalleryOutputRecord[]>;
  createSelection(input: {
    workspaceId: string;
    campaignGenerationRunId: string | null;
    name: string | null;
    createdBy: string;
  }): Promise<GeneratedOutputSelectionRecord>;
  getSelection(selectionId: string): Promise<GeneratedOutputSelectionRecord | null>;
  updateSelection(
    selectionId: string,
    patch: Partial<Pick<GeneratedOutputSelectionRecord, 'selectionStatus' | 'name'>>,
  ): Promise<GeneratedOutputSelectionRecord>;
  listSelectionItems(selectionId: string): Promise<GeneratedOutputSelectionItemRecord[]>;
  addSelectionItem(input: {
    workspaceId: string;
    selectionId: string;
    galleryOutputId: string;
    selectionRole: string | null;
    outputOrder: number;
  }): Promise<GeneratedOutputSelectionItemRecord>;
  removeSelectionItem(selectionId: string, galleryOutputId: string): Promise<void>;
  reorderSelectionItems(selectionId: string, orderedGalleryOutputIds: string[]): Promise<void>;
  createCampaignLink(input: {
    workspaceId: string;
    campaignId: string;
    campaignItemId: string | null;
    galleryOutputId: string;
    sourceGenerationJobId: string | null;
    sourceCampaignGenerationRunId: string | null;
    linkedBy: string;
  }): Promise<CampaignOutputLinkRecord>;
  listCampaignLinks(campaignId: string): Promise<CampaignOutputLinkRecord[]>;
  findLinkByOutput(galleryOutputId: string): Promise<CampaignOutputLinkRecord | null>;
  appendAudit(row: Omit<GeneratedOutputAuditRow, 'id' | 'createdAt'>): Promise<void>;
  listAudit(workspaceId: string, filter?: { event?: GeneratedOutputAuditEvent }): Promise<GeneratedOutputAuditRow[]>;
}

/** Bridges to the domain services the workflow composes. */
export interface OutputReviewDependencies {
  /** Creates the campaign item (existing approved-output eligibility rules). */
  addCampaignItem(input: {
    campaignId: string;
    galleryOutputId: string;
    plannedChannel?: string;
    plannedFormat?: string;
    captionDraft?: string;
    notes?: string;
    createdBy: string;
    workspaceId: string;
  }): Promise<CampaignItemRecord>;
  /** Optionally transitions the Gallery output itself to approved. */
  approveGalleryOutput?(galleryOutputId: string, workspaceId: string): Promise<unknown>;
}

/** In-memory store mirroring the SQL shape (demo mode + tests). */
export class InMemoryOutputReviewStore implements OutputReviewStore {
  readonly reviews = new Map<string, GeneratedOutputReviewRecord>();
  readonly selections = new Map<string, GeneratedOutputSelectionRecord>();
  readonly selectionItems: GeneratedOutputSelectionItemRecord[] = [];
  readonly campaignLinks: CampaignOutputLinkRecord[] = [];
  readonly auditRows: GeneratedOutputAuditRow[] = [];

  private outputs = new Map<string, GalleryOutputRecord>();

  /** Seeds resolved Gallery outputs (the host's workspace listing). */
  get outputCount(): number {
    return this.outputs.size;
  }

  /** Registers outputs (the host seeds resolved Gallery records). */
  seedOutputs(outputs: GalleryOutputRecord[]): void {
    for (const output of outputs) this.outputs.set(output.id, structuredClone(output));
  }

  async getReviewByOutput(galleryOutputId: string): Promise<GeneratedOutputReviewRecord | null> {
    for (const review of this.reviews.values()) {
      if (review.galleryOutputId === galleryOutputId) return structuredClone(review);
    }
    return null;
  }

  async ensureReview(input: {
    workspaceId: string;
    galleryOutputId: string;
    generationJobId: string | null;
    campaignGenerationRunId: string | null;
  }): Promise<GeneratedOutputReviewRecord> {
    const existing = await this.getReviewByOutput(input.galleryOutputId);
    if (existing) return existing;
    const stamp = new Date().toISOString();
    const record: GeneratedOutputReviewRecord = {
      id: `rev_${crypto.randomUUID()}`,
      workspaceId: input.workspaceId,
      galleryOutputId: input.galleryOutputId,
      generationJobId: input.generationJobId,
      campaignGenerationRunId: input.campaignGenerationRunId,
      reviewStatus: 'pending_review',
      reviewNotes: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.reviews.set(record.id, record);
    return structuredClone(record);
  }

  async updateReview(
    reviewId: string,
    patch: Partial<Pick<GeneratedOutputReviewRecord, 'reviewStatus' | 'reviewNotes' | 'reviewedBy' | 'reviewedAt'>>,
  ): Promise<GeneratedOutputReviewRecord> {
    const review = this.reviews.get(reviewId);
    if (!review) throw new Error(`Review record not found: ${reviewId}`);
    const next = { ...review, ...patch, updatedAt: new Date().toISOString() };
    this.reviews.set(reviewId, next);
    return structuredClone(next);
  }

  async listReviewsForRun(campaignGenerationRunId: string): Promise<GeneratedOutputReviewRecord[]> {
    return [...this.reviews.values()]
      .filter((review) => review.campaignGenerationRunId === campaignGenerationRunId)
      .map((review) => structuredClone(review));
  }

  async getOutput(galleryOutputId: string): Promise<GalleryOutputRecord> {
    const output = this.outputs.get(galleryOutputId);
    if (!output) throw new Error(`Gallery output not found: ${galleryOutputId}`);
    return structuredClone(output);
  }

  async listOutputsForJob(generationJobId: string): Promise<GalleryOutputRecord[]> {
    return [...this.outputs.values()]
      .filter((output) => (output.metadata as Record<string, unknown>)['provider_run_id'] === generationJobId)
      .map((output) => structuredClone(output));
  }

  async listOutputsForRun(campaignGenerationRunId: string): Promise<GalleryOutputRecord[]> {
    // Outputs of a run = outputs whose content job belongs to one of the
    // run's child media jobs. The host resolves the run → job → outputs path;
    // the in-memory store matches on the run id recorded in metadata.
    return [...this.outputs.values()]
      .filter((output) => (output.metadata as Record<string, unknown>)['campaign_generation_run_id'] === campaignGenerationRunId)
      .map((output) => structuredClone(output));
  }

  async listWorkspaceOutputs(workspaceId: string): Promise<GalleryOutputRecord[]> {
    return [...this.outputs.values()]
      .filter((output) => output.workspaceId === workspaceId)
      .map((output) => structuredClone(output));
  }

  async createSelection(input: {
    workspaceId: string;
    campaignGenerationRunId: string | null;
    name: string | null;
    createdBy: string;
  }): Promise<GeneratedOutputSelectionRecord> {
    const stamp = new Date().toISOString();
    const record: GeneratedOutputSelectionRecord = {
      id: `sel_${crypto.randomUUID()}`,
      workspaceId: input.workspaceId,
      campaignGenerationRunId: input.campaignGenerationRunId,
      name: input.name,
      selectionStatus: 'draft',
      createdBy: input.createdBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.selections.set(record.id, record);
    return structuredClone(record);
  }

  async getSelection(selectionId: string): Promise<GeneratedOutputSelectionRecord | null> {
    const selection = this.selections.get(selectionId);
    return selection ? structuredClone(selection) : null;
  }

  async updateSelection(
    selectionId: string,
    patch: Partial<Pick<GeneratedOutputSelectionRecord, 'selectionStatus' | 'name'>>,
  ): Promise<GeneratedOutputSelectionRecord> {
    const selection = this.selections.get(selectionId);
    if (!selection) throw new Error(`Selection not found: ${selectionId}`);
    const next = { ...selection, ...patch, updatedAt: new Date().toISOString() };
    this.selections.set(selectionId, next);
    return structuredClone(next);
  }

  async listSelectionItems(selectionId: string): Promise<GeneratedOutputSelectionItemRecord[]> {
    return this.selectionItems
      .filter((item) => item.selectionId === selectionId)
      .sort((a, b) => a.outputOrder - b.outputOrder)
      .map((item) => structuredClone(item));
  }

  async addSelectionItem(input: {
    workspaceId: string;
    selectionId: string;
    galleryOutputId: string;
    selectionRole: string | null;
    outputOrder: number;
  }): Promise<GeneratedOutputSelectionItemRecord> {
    const record: GeneratedOutputSelectionItemRecord = {
      id: `selitem_${crypto.randomUUID()}`,
      workspaceId: input.workspaceId,
      selectionId: input.selectionId,
      galleryOutputId: input.galleryOutputId,
      selectionRole: input.selectionRole,
      outputOrder: input.outputOrder,
      createdAt: new Date().toISOString(),
    };
    this.selectionItems.push(record);
    return structuredClone(record);
  }

  async removeSelectionItem(selectionId: string, galleryOutputId: string): Promise<void> {
    const index = this.selectionItems.findIndex(
      (item) => item.selectionId === selectionId && item.galleryOutputId === galleryOutputId,
    );
    if (index >= 0) this.selectionItems.splice(index, 1);
  }

  async reorderSelectionItems(selectionId: string, orderedGalleryOutputIds: string[]): Promise<void> {
    for (const [index, galleryOutputId] of orderedGalleryOutputIds.entries()) {
      const item = this.selectionItems.find(
        (candidate) => candidate.selectionId === selectionId && candidate.galleryOutputId === galleryOutputId,
      );
      if (item) item.outputOrder = index;
    }
  }

  async createCampaignLink(input: {
    workspaceId: string;
    campaignId: string;
    campaignItemId: string | null;
    galleryOutputId: string;
    sourceGenerationJobId: string | null;
    sourceCampaignGenerationRunId: string | null;
    linkedBy: string;
  }): Promise<CampaignOutputLinkRecord> {
    const stamp = new Date().toISOString();
    const record: CampaignOutputLinkRecord = {
      id: `link_${crypto.randomUUID()}`,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      campaignItemId: input.campaignItemId,
      galleryOutputId: input.galleryOutputId,
      sourceGenerationJobId: input.sourceGenerationJobId,
      sourceCampaignGenerationRunId: input.sourceCampaignGenerationRunId,
      handoffStatus: 'linked',
      linkedBy: input.linkedBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.campaignLinks.push(record);
    return structuredClone(record);
  }

  async listCampaignLinks(campaignId: string): Promise<CampaignOutputLinkRecord[]> {
    return this.campaignLinks
      .filter((link) => link.campaignId === campaignId)
      .map((link) => structuredClone(link));
  }

  async findLinkByOutput(galleryOutputId: string): Promise<CampaignOutputLinkRecord | null> {
    const link = this.campaignLinks.find((candidate) => candidate.galleryOutputId === galleryOutputId);
    return link ? structuredClone(link) : null;
  }

  async appendAudit(row: Omit<GeneratedOutputAuditRow, 'id' | 'createdAt'>): Promise<void> {
    this.auditRows.push({ ...row, id: `audit_${crypto.randomUUID()}`, createdAt: new Date().toISOString() });
  }

  async listAudit(workspaceId: string, filter?: { event?: GeneratedOutputAuditEvent }): Promise<GeneratedOutputAuditRow[]> {
    return this.auditRows
      .filter((row) => row.workspaceId === workspaceId)
      .filter((row) => !filter?.event || row.event === filter.event)
      .map((row) => structuredClone(row));
  }
}

export interface ReviewActionResult {
  review: GeneratedOutputReviewRecord;
  output: GalleryOutputRecord;
}

export class OutputReviewService {
  constructor(
    private readonly store: OutputReviewStore,
    private readonly deps: OutputReviewDependencies,
  ) {}

  /** Reviews one output (approve / reject / shortlist / unshortlist / reset). */
  async reviewGeneratedOutput(
    workspaceId: string,
    galleryOutputId: string,
    action: GeneratedOutputReviewAction,
    options: { reviewerId: string; notes?: string },
  ): Promise<ReviewActionResult> {
    const output = await this.store.getOutput(galleryOutputId);
    if (output.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }

    const review = await this.store.ensureReview({
      workspaceId,
      galleryOutputId,
      generationJobId: ((output.metadata as Record<string, unknown>)['provider_run_id'] as string) ?? null,
      campaignGenerationRunId:
        ((output.metadata as Record<string, unknown>)['campaign_generation_run_id'] as string) ?? null,
    });

    const transition = canReviewTransition(review.reviewStatus, action);
    if (!transition.allowed) {
      await this.store.appendAudit({
        workspaceId,
        galleryOutputId,
        event: 'generated_output_handoff_blocked',
        detail: transition.reason ?? 'Review action not allowed.',
      });
      throw new Error(transition.reason ?? 'Review action not allowed.');
    }

    const statusByAction: Record<GeneratedOutputReviewAction, GeneratedOutputReviewStatus> = {
      approve: 'approved',
      reject: 'rejected',
      shortlist: 'shortlisted',
      unshortlist: 'approved',
      reset: 'pending_review',
    };
    const stamp = new Date().toISOString();
    const updated = await this.store.updateReview(review.id, {
      reviewStatus: statusByAction[action],
      reviewNotes: options.notes ?? review.reviewNotes,
      reviewedBy: options.reviewerId,
      reviewedAt: stamp,
    });

    // Approving flips the Gallery output itself so the existing campaign
    // eligibility (approved status) and publishing rules keep working.
    if (action === 'approve' && output.status !== 'approved' && this.deps.approveGalleryOutput) {
      await this.deps.approveGalleryOutput(galleryOutputId, workspaceId).catch(() => undefined);
    }

    const auditEvent: GeneratedOutputAuditEvent =
      action === 'approve'
        ? 'generated_output_approved'
        : action === 'reject'
          ? 'generated_output_rejected'
          : action === 'shortlist'
            ? 'generated_output_shortlisted'
            : 'generated_output_selection_reordered'; // unshortlist/reset: neutral event
    await this.store.appendAudit({
      workspaceId,
      galleryOutputId,
      event: auditEvent,
      detail: `Review state → ${updated.reviewStatus}${options.notes ? `: ${options.notes}` : ''}.`,
    });

    return { review: updated, output };
  }

  /** Batch review (e.g. approve an entire story group). */
  async batchReviewGeneratedOutputs(
    workspaceId: string,
    input: { galleryOutputIds: string[]; action: GeneratedOutputReviewAction; reviewerId: string; notes?: string },
  ): Promise<ReviewActionResult[]> {
    const results: ReviewActionResult[] = [];
    for (const galleryOutputId of input.galleryOutputIds) {
      results.push(
        await this.reviewGeneratedOutput(workspaceId, galleryOutputId, input.action, {
          reviewerId: input.reviewerId,
          notes: input.notes,
        }),
      );
    }
    return results;
  }

  /** The coordinated set-review view: outputs + reviews + story provenance. */
  async getGeneratedSetReviewDetail(
    workspaceId: string,
    campaignGenerationRunId: string,
  ): Promise<{
    outputs: SetReviewOutputView[];
    counts: { approved: number; rejected: number; shortlisted: number; pending: number; handedOff: number };
  }> {
    const outputs = await this.store.listOutputsForRun(campaignGenerationRunId);
    const views: SetReviewOutputView[] = [];
    for (const output of outputs) {
      if (output.workspaceId !== workspaceId) {
        throw new Error('You do not have access to this workspace.');
      }
      const review =
        (await this.store.getReviewByOutput(output.id)) ??
        (await this.store.ensureReview({
          workspaceId,
          galleryOutputId: output.id,
          generationJobId: ((output.metadata as Record<string, unknown>)['provider_run_id'] as string) ?? null,
          campaignGenerationRunId,
        }));
      const metadata = output.metadata as Record<string, unknown>;
      views.push({
        galleryOutput: output,
        review,
        storyGroupKey: (metadata['story_group_key'] as string) ?? null,
        storySequence: (metadata['story_sequence'] as number) ?? null,
        storySequenceTotal: (metadata['story_sequence_total'] as number) ?? null,
        storyFrameLabel: (metadata['story_frame_label'] as string) ?? null,
      });
    }
    views.sort((a, b) => {
      // Story frames keep sequence order; other types sort by output index.
      if (a.storyGroupKey && a.storyGroupKey === b.storyGroupKey) {
        return (a.storySequence ?? 0) - (b.storySequence ?? 0);
      }
      return a.galleryOutput.outputIndex - b.galleryOutput.outputIndex;
    });
    return {
      outputs: views,
      counts: {
        approved: views.filter((view) => ['approved', 'shortlisted', 'selected_for_campaign'].includes(view.review.reviewStatus)).length,
        rejected: views.filter((view) => view.review.reviewStatus === 'rejected').length,
        shortlisted: views.filter((view) => view.review.reviewStatus === 'shortlisted').length,
        pending: views.filter((view) => view.review.reviewStatus === 'pending_review').length,
        handedOff: views.filter((view) => view.review.reviewStatus === 'handed_off').length,
      },
    };
  }

  // ── Selections ─────────────────────────────────────────────────────────────

  async createGeneratedOutputSelection(
    workspaceId: string,
    input: { name?: string; campaignGenerationRunId?: string | null; createdBy: string },
  ): Promise<GeneratedOutputSelectionRecord> {
    const selection = await this.store.createSelection({
      workspaceId,
      campaignGenerationRunId: input.campaignGenerationRunId ?? null,
      name: input.name ?? null,
      createdBy: input.createdBy,
    });
    await this.store.appendAudit({
      workspaceId,
      galleryOutputId: null,
      event: 'generated_output_selection_created',
      detail: `Selection created${input.name ? `: ${input.name}` : ''}.`,
    });
    return selection;
  }

  /** Adds an output to a selection — selectable states only (never rejected). */
  async addOutputToSelection(
    workspaceId: string,
    selectionId: string,
    galleryOutputId: string,
    options: { selectionRole?: string; actorId: string },
  ): Promise<GeneratedOutputSelectionItemRecord> {
    const selection = await this.store.getSelection(selectionId);
    if (!selection) throw new Error(`Selection not found: ${selectionId}`);
    if (selection.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }
    const output = await this.store.getOutput(galleryOutputId);
    if (output.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }
    const review = await this.store.ensureReview({
      workspaceId,
      galleryOutputId,
      generationJobId: ((output.metadata as Record<string, unknown>)['provider_run_id'] as string) ?? null,
      campaignGenerationRunId: selection.campaignGenerationRunId,
    });
    if (!isSelectable(review.reviewStatus)) {
      await this.store.appendAudit({
        workspaceId,
        galleryOutputId,
        event: 'generated_output_handoff_blocked',
        detail: `Output is ${review.reviewStatus} — not selectable.`,
      });
      throw new Error(`Output is ${review.reviewStatus.replace('_', ' ')} — only approved outputs can be added to a selection.`);
    }

    const existing = await this.store.listSelectionItems(selectionId);
    const item = await this.store.addSelectionItem({
      workspaceId,
      selectionId,
      galleryOutputId,
      selectionRole: options.selectionRole ?? null,
      outputOrder: existing.length,
    });
    await this.store.appendAudit({
      workspaceId,
      galleryOutputId,
      event: 'generated_output_added_to_selection',
      detail: `Added to selection ${selectionId}.`,
    });
    return item;
  }

  async removeOutputFromSelection(
    workspaceId: string,
    selectionId: string,
    galleryOutputId: string,
    actorId: string,
  ): Promise<void> {
    const selection = await this.store.getSelection(selectionId);
    if (!selection || selection.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }
    await this.store.removeSelectionItem(selectionId, galleryOutputId);
    await this.store.appendAudit({
      workspaceId,
      galleryOutputId,
      event: 'generated_output_removed_from_selection',
      detail: `Removed from selection ${selectionId}.`,
    });
    void actorId;
  }

  async reorderSelectionItems(
    workspaceId: string,
    selectionId: string,
    orderedGalleryOutputIds: string[],
    actorId: string,
  ): Promise<void> {
    const selection = await this.store.getSelection(selectionId);
    if (!selection || selection.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }
    await this.store.reorderSelectionItems(selectionId, orderedGalleryOutputIds);
    await this.store.appendAudit({
      workspaceId,
      galleryOutputId: null,
      event: 'generated_output_selection_reordered',
      detail: `Selection ${selectionId} reordered (${orderedGalleryOutputIds.length} items).`,
    });
    void actorId;
  }

  async listSelectionItems(workspaceId: string, selectionId: string) {
    const selection = await this.store.getSelection(selectionId);
    if (!selection || selection.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }
    return this.store.listSelectionItems(selectionId);
  }

  // ── Campaign handoff ───────────────────────────────────────────────────────

  /**
   * Hands approved outputs into a campaign: creates real campaign items via
   * the existing eligibility rules and records a traceability link
   * (source generation job + campaign generation run) per output.
   */
  async handoffOutputsToCampaign(
    workspaceId: string,
    input: {
      campaignId: string;
      galleryOutputIds: string[];
      plannedChannel?: string;
      plannedFormat?: string;
      captionDraft?: string;
      actorId: string;
    },
  ): Promise<{ links: CampaignOutputLinkRecord[]; items: CampaignItemRecord[]; blocked: string[] }> {
    const links: CampaignOutputLinkRecord[] = [];
    const items: CampaignItemRecord[] = [];
    const blocked: string[] = [];

    await this.store.appendAudit({
      workspaceId,
      galleryOutputId: null,
      event: 'generated_output_handoff_requested',
      detail: `${input.galleryOutputIds.length} output(s) → campaign ${input.campaignId}.`,
    });

    for (const galleryOutputId of input.galleryOutputIds) {
      const output = await this.store.getOutput(galleryOutputId);
      if (output.workspaceId !== workspaceId) {
        throw new Error('You do not have access to this workspace.');
      }
      const review = await this.store.getReviewByOutput(galleryOutputId);
      const status = review?.reviewStatus ?? 'pending_review';
      if (!isHandoffEligible(status)) {
        await this.store.appendAudit({
          workspaceId,
          galleryOutputId,
          event: 'generated_output_handoff_blocked',
          detail: `Output is ${status} — only approved outputs can be handed off.`,
        });
        blocked.push(`${output.title}: ${status.replace('_', ' ')} — approval required before handoff.`);
        continue;
      }

      // Create the campaign item through the EXISTING campaign rules. This
      // re-checks approved status, workspace, channel planning and provenance.
      try {
        const item = await this.deps.addCampaignItem({
          campaignId: input.campaignId,
          galleryOutputId,
          plannedChannel: input.plannedChannel,
          plannedFormat: input.plannedFormat,
          captionDraft: input.captionDraft,
          notes: `Handed off from generated set${review?.campaignGenerationRunId ? ` (run ${review.campaignGenerationRunId})` : ''}.`,
          createdBy: input.actorId,
          workspaceId,
        });
        const link = await this.store.createCampaignLink({
          workspaceId,
          campaignId: input.campaignId,
          campaignItemId: item.id,
          galleryOutputId,
          sourceGenerationJobId:
            ((output.metadata as Record<string, unknown>)['provider_run_id'] as string) ?? null,
          sourceCampaignGenerationRunId: review?.campaignGenerationRunId ?? null,
          linkedBy: input.actorId,
        });
        items.push(item);
        links.push(link);

        // Mark the workflow state: selected → handed off.
        if (review && review.reviewStatus !== 'handed_off') {
          await this.store.updateReview(review.id, {
            reviewStatus: 'handed_off',
            reviewedBy: input.actorId,
            reviewedAt: new Date().toISOString(),
          });
        }
        await this.store.appendAudit({
          workspaceId,
          galleryOutputId,
          event: 'generated_output_handed_off_to_campaign',
          detail: `Linked to campaign ${input.campaignId} (item ${item.id}).`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Handoff failed.';
        await this.store.appendAudit({
          workspaceId,
          galleryOutputId,
          event: 'generated_output_handoff_blocked',
          detail: message,
        });
        blocked.push(`${output.title}: ${message}`);
      }
    }

    return { links, items, blocked };
  }

  /** Candidates for handoff: approved-family outputs in the workspace. */
  async listCampaignHandoffCandidates(
    workspaceId: string,
    filters: { campaignGenerationRunId?: string } = {},
  ): Promise<Array<{ output: GalleryOutputRecord; review: GeneratedOutputReviewRecord; link: CampaignOutputLinkRecord | null }>> {
    const outputs = filters.campaignGenerationRunId
      ? await this.store.listOutputsForRun(filters.campaignGenerationRunId)
      : await this.store.listWorkspaceOutputs(workspaceId);
    const candidates: Array<{ output: GalleryOutputRecord; review: GeneratedOutputReviewRecord; link: CampaignOutputLinkRecord | null }> = [];
    for (const output of outputs) {
      if (output.workspaceId !== workspaceId) continue;
      const review = await this.store.getReviewByOutput(output.id);
      if (!review || !isHandoffEligible(review.reviewStatus)) continue;
      candidates.push({ output, review, link: await this.store.findLinkByOutput(output.id) });
    }
    return candidates;
  }

  /** Campaign-side visibility: links with their Gallery outputs. */
  async listCampaignLinks(workspaceId: string, campaignId: string): Promise<CampaignOutputLinkRecord[]> {
    const links = await this.store.listCampaignLinks(campaignId);
    return links.filter((link) => link.workspaceId === workspaceId);
  }

  async listAudit(workspaceId: string, filter?: { event?: GeneratedOutputAuditEvent }) {
    return this.store.listAudit(workspaceId, filter);
  }
}
