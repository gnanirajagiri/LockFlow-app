/**
 * Gallery service layer.
 *
 * The single entry point the UI uses for the Gallery feature. Gallery holds
 * GENERATED content only; it never stores reusable source assets and never
 * edits them. Every output traces back to one content_job_request whose
 * immutable pins + snapshots carry the historic provenance.
 *
 * No provider and no storage integration exist: outputs are placeholders,
 * draft→processing is unreachable from normal UI, and review decisions are
 * the only status changes the UI can drive.
 */
import {
  refuseInvalidGalleryTransition,
  restoreTargetFor,
  statusForReviewDecision,
  validateCreateGalleryCollection,
  validateCreateGalleryOutput,
  validateReorder,
  validateSubmitGalleryReview,
  validateUpdateGalleryOutput,
} from '../domain/gallery';
import type {
  CreateGalleryCollectionInput,
  CreateGalleryOutputInput,
  GalleryCollectionItemRecord,
  GalleryCollectionRecord,
  GalleryOutputEventRecord,
  GalleryOutputRecord,
  GalleryOutputReviewRecord,
  GalleryOutputStatus,
  GalleryOutputTagRecord,
} from '../domain/gallery';
import { ContentStudioService } from './contentService';
import type { GalleryRepository } from '../data/galleryRepository';
import type {
  ContentJobPinRecord,
  ContentJobRequestRecord,
  ContentProjectRecord,
  ContentSceneRecord,
} from '../domain/content';

export interface GalleryProvenance {
  job: ContentJobRequestRecord;
  project: ContentProjectRecord | null;
  scenes: ContentSceneRecord[];
  pins: ContentJobPinRecord[];
}

function isInWorkspace(recordWorkspaceId: string, activeWorkspaceId: string): void {
  if (recordWorkspaceId !== activeWorkspaceId) {
    throw new Error('Cross-workspace access denied.');
  }
}

export class GalleryService {
  constructor(
    private readonly repo: GalleryRepository,
    private readonly content: ContentStudioService,
    /** Development workspace used by seed-level writes (never a second scope). */
    readonly developmentWorkspaceId: string,
  ) {}

  // ── Outputs ───────────────────────────────────────────────────────────────

  /**
   * Workspace-scoped listing with optional UI filters. `outputType`, `status`
   * and `contentProjectId` narrow the set; project filtering resolves via the
   * job → project relationship.
   */
  async listOutputs(
    activeWorkspaceId: string,
    filters: {
      outputType?: GalleryOutputRecord['outputType'];
      status?: GalleryOutputStatus;
      contentProjectId?: string;
      search?: string;
    } = {},
  ): Promise<GalleryOutputRecord[]> {
    let outputs = await this.repo.listOutputs(activeWorkspaceId);
    if (filters.outputType) {
      outputs = outputs.filter((output) => output.outputType === filters.outputType);
    }
    if (filters.status) {
      outputs = outputs.filter((output) => output.status === filters.status);
    }
    if (filters.contentProjectId) {
      const jobs = await this.content.listJobRequests(activeWorkspaceId);
      const jobIds = new Set(
        jobs.filter((job) => job.contentProjectId === filters.contentProjectId).map((job) => job.id),
      );
      outputs = outputs.filter((output) => jobIds.has(output.contentJobRequestId));
    }
    if (filters.search && filters.search.trim() !== '') {
      const needle = filters.search.trim().toLowerCase();
      outputs = outputs.filter((output) => output.title.toLowerCase().includes(needle));
    }
    return outputs;
  }

  async getOutput(outputId: string, activeWorkspaceId: string): Promise<GalleryOutputRecord> {
    const output = await this.repo.getOutput(outputId);
    isInWorkspace(output.workspaceId, activeWorkspaceId);
    return output;
  }

  /**
   * Creates a PLACEHOLDER output bound to a same-workspace job. This is the
   * development/seed path only — it never generates media and always marks
   * the record as a placeholder.
   */
  async createPlaceholderOutput(
    input: unknown,
    createdBy: string,
    activeWorkspaceId: string,
  ): Promise<GalleryOutputRecord> {
    const result = validateCreateGalleryOutput(input);
    if (!result.ok) throw new Error(`Invalid gallery output: ${result.errors.join('; ')}`);
    const value = result.value as CreateGalleryOutputInput;

    // Rule: the output must belong to a same-workspace job.
    const job = await this.content.getJobRequest(value.contentJobRequestId, activeWorkspaceId);
    isInWorkspace(job.workspaceId, activeWorkspaceId);
    if (value.workspaceId !== job.workspaceId) {
      throw new Error('Gallery outputs must belong to the same workspace as their job.');
    }
    if (value.parentGalleryOutputId) {
      const parent = await this.repo.getOutput(value.parentGalleryOutputId);
      isInWorkspace(parent.workspaceId, activeWorkspaceId);
    }

    const created = await this.repo.createOutput(
      {
        ...value,
        // Draft is the only status a create flow may set; anything else
        // arrives exclusively through development seed data.
        status: 'draft',
        outputIndex: value.outputIndex ?? (await this.repo.nextOutputIndex(value.contentJobRequestId)),
        metadata: { ...(value.metadata ?? {}), placeholder: true, provider: null },
      },
      createdBy,
    );
    await this.appendEvent(created.id, 'output_created', `Placeholder output "${created.title}" registered against the job.`, {
      placeholder: true,
      contentJobRequestId: created.contentJobRequestId,
    });
    return created;
  }

  /** Permitted metadata updates only — never status, never provenance. */
  async updateOutputMetadata(
    outputId: string,
    patch: unknown,
    activeWorkspaceId: string,
  ): Promise<GalleryOutputRecord> {
    const output = await this.getOutput(outputId, activeWorkspaceId);
    const result = validateUpdateGalleryOutput(patch);
    if (!result.ok) throw new Error(`Invalid output update: ${result.errors.join('; ')}`);
    const updated = await this.repo.updateOutputMetadata(outputId, result.value);
    void output;
    return updated;
  }

  /**
   * Guarded status transition. Normal UI cannot move draft → processing (no
   * provider); archive/restore are soft-state changes only.
   */
  async transitionOutput(
    outputId: string,
    to: GalleryOutputStatus,
    activeWorkspaceId: string,
    options: { note?: string } = {},
  ): Promise<GalleryOutputRecord> {
    const output = await this.getOutput(outputId, activeWorkspaceId);

    // Restore path: leaving archived goes to the prior reviewable status only.
    if (output.status === 'archived') {
      const target = restoreTargetFor(output);
      if (to !== target) {
        throw new Error(
          `An archived output can only be restored to its prior reviewable status (${target}).`,
        );
      }
      const restored = await this.repo.updateOutputStatus(outputId, to, null);
      await this.appendEvent(outputId, 'restored', `Output restored to ${to}.`, { from: 'archived', to });
      return restored;
    }

    refuseInvalidGalleryTransition(output.status, to);

    // Provider boundary: no provider exists, so outputs cannot be processed.
    if (to === 'processing') {
      throw new Error('No provider integration exists — outputs cannot move to processing yet.');
    }

    if (to === 'archived') {
      const archived = await this.repo.updateOutputStatus(outputId, 'archived', output.status);
      await this.appendEvent(outputId, 'archived', `Output archived from ${output.status}.`, {
        from: output.status,
      });
      return archived;
    }

    const updated = await this.repo.updateOutputStatus(outputId, to);
    await this.appendEvent(
      outputId,
      'status_changed',
      options.note ?? `Status moved from ${output.status} to ${to}.`,
      { from: output.status, to },
    );
    return updated;
  }

  async archiveOutput(outputId: string, activeWorkspaceId: string): Promise<GalleryOutputRecord> {
    return this.transitionOutput(outputId, 'archived', activeWorkspaceId);
  }

  async restoreOutput(outputId: string, activeWorkspaceId: string): Promise<GalleryOutputRecord> {
    const output = await this.getOutput(outputId, activeWorkspaceId);
    return this.transitionOutput(outputId, restoreTargetFor(output), activeWorkspaceId);
  }

  // ── Reviews ───────────────────────────────────────────────────────────────

  async listReviews(outputId: string, activeWorkspaceId: string): Promise<GalleryOutputReviewRecord[]> {
    await this.getOutput(outputId, activeWorkspaceId);
    return this.repo.listReviews(outputId);
  }

  /**
   * Submits a review decision: appends immutable review history and moves the
   * output through the guarded state machine. Never touches job pins.
   */
  async submitReview(
    input: unknown,
    activeWorkspaceId: string,
  ): Promise<{ review: GalleryOutputReviewRecord; output: GalleryOutputRecord }> {
    const result = validateSubmitGalleryReview(input);
    if (!result.ok) throw new Error(`Invalid review: ${result.errors.join('; ')}`);
    const value = result.value;

    const output = await this.getOutput(value.galleryOutputId, activeWorkspaceId);
    if (output.status !== 'ready_for_review') {
      throw new Error(
        `Reviews are only accepted on outputs that are ready for review (current status: ${output.status}).`,
      );
    }
    const target = statusForReviewDecision(value.decision);
    refuseInvalidGalleryTransition(output.status, target);

    const review = await this.repo.addReview({
      galleryOutputId: value.galleryOutputId,
      reviewerId: value.reviewerId,
      decision: value.decision,
      feedback: value.feedback ?? null,
    });
    const updated = await this.repo.updateOutputStatus(value.galleryOutputId, target);
    await this.appendEvent(
      value.galleryOutputId,
      value.decision === 'approved' ? 'approved' : value.decision === 'rejected' ? 'rejected' : 'review_submitted',
      `Review submitted: ${value.decision}.`,
      { reviewerId: value.reviewerId, decision: value.decision },
    );
    void updated;
    return { review, output: await this.repo.getOutput(value.galleryOutputId) };
  }

  // ── Tags ──────────────────────────────────────────────────────────────────

  async listTagsForOutput(outputId: string, activeWorkspaceId: string): Promise<GalleryOutputTagRecord[]> {
    await this.getOutput(outputId, activeWorkspaceId);
    return this.repo.listTagsForOutput(outputId);
  }

  async addTagToOutput(
    outputId: string,
    name: string,
    activeWorkspaceId: string,
  ): Promise<GalleryOutputTagRecord> {
    await this.getOutput(outputId, activeWorkspaceId);
    return this.repo.addTagToOutput({ galleryOutputId: outputId, name }, activeWorkspaceId);
  }

  async removeTagFromOutput(
    outputId: string,
    tagId: string,
    activeWorkspaceId: string,
  ): Promise<void> {
    await this.getOutput(outputId, activeWorkspaceId);
    return this.repo.removeTagFromOutput(outputId, tagId);
  }

  // ── Collections ───────────────────────────────────────────────────────────

  async listCollections(activeWorkspaceId: string): Promise<GalleryCollectionRecord[]> {
    return this.repo.listCollections(activeWorkspaceId);
  }

  async getCollection(
    collectionId: string,
    activeWorkspaceId: string,
  ): Promise<GalleryCollectionRecord> {
    const collection = await this.repo.getCollection(collectionId);
    isInWorkspace(collection.workspaceId, activeWorkspaceId);
    return collection;
  }

  async createCollection(
    input: unknown,
    createdBy: string,
    activeWorkspaceId: string,
  ): Promise<GalleryCollectionRecord> {
    const result = validateCreateGalleryCollection(input);
    if (!result.ok) throw new Error(`Invalid collection: ${result.errors.join('; ')}`);
    const value = result.value as CreateGalleryCollectionInput;
    isInWorkspace(value.workspaceId, activeWorkspaceId);
    return this.repo.createCollection(value, createdBy);
  }

  async archiveCollection(
    collectionId: string,
    activeWorkspaceId: string,
  ): Promise<GalleryCollectionRecord> {
    await this.getCollection(collectionId, activeWorkspaceId);
    return this.repo.archiveCollection(collectionId);
  }

  /**
   * Ordered collection contents. Only Gallery outputs may belong — the
   * repository ids are resolved to output records here, so a Library asset
   * id can never enter a collection.
   */
  async listCollectionItems(
    collectionId: string,
    activeWorkspaceId: string,
  ): Promise<Array<{ item: GalleryCollectionItemRecord; output: GalleryOutputRecord }>> {
    await this.getCollection(collectionId, activeWorkspaceId);
    const items = await this.repo.listCollectionItems(collectionId);
    const resolved: Array<{ item: GalleryCollectionItemRecord; output: GalleryOutputRecord }> = [];
    for (const item of items) {
      const output = await this.repo.getOutput(item.galleryOutputId); // throws if not an output
      isInWorkspace(output.workspaceId, activeWorkspaceId);
      resolved.push({ item, output });
    }
    return resolved;
  }

  async addCollectionItem(
    collectionId: string,
    outputId: string,
    activeWorkspaceId: string,
  ): Promise<GalleryCollectionItemRecord> {
    await this.getCollection(collectionId, activeWorkspaceId);
    await this.getOutput(outputId, activeWorkspaceId); // outputs only, same workspace
    return this.repo.addCollectionItem(collectionId, outputId);
  }

  async removeCollectionItem(
    collectionId: string,
    itemId: string,
    activeWorkspaceId: string,
  ): Promise<void> {
    await this.getCollection(collectionId, activeWorkspaceId);
    return this.repo.removeCollectionItem(itemId); // removes the membership, not the output
  }

  async reorderCollectionItems(
    collectionId: string,
    order: unknown,
    activeWorkspaceId: string,
  ): Promise<void> {
    await this.getCollection(collectionId, activeWorkspaceId);
    const result = validateReorder(order);
    if (!result.ok) throw new Error(`Invalid reorder: ${result.errors.join('; ')}`);
    return this.repo.reorderCollectionItems(collectionId, result.value);
  }

  // ── Provenance (historical, read-only) ────────────────────────────────────

  async listEvents(outputId: string, activeWorkspaceId: string): Promise<GalleryOutputEventRecord[]> {
    await this.getOutput(outputId, activeWorkspaceId);
    return this.repo.listEvents(outputId);
  }

  /**
   * Resolves the immutable provenance for an output: its job, project,
   * scenes, and the exact pinned versions recorded at job-preparation time.
   * A read-only model — later source-version changes never alter it.
   */
  async resolveProvenance(
    outputId: string,
    activeWorkspaceId: string,
  ): Promise<GalleryProvenance> {
    const output = await this.getOutput(outputId, activeWorkspaceId);
    const job = await this.content.getJobRequest(output.contentJobRequestId, activeWorkspaceId);
    if (job.workspaceId !== output.workspaceId) {
      throw new Error('Gallery output and content job must share a workspace.');
    }
    const project = job.contentProjectId
      ? await this.content
          .getProject(job.contentProjectId, activeWorkspaceId)
          .catch(() => null)
      : null;
    const scenes = job.contentProjectId
      ? await this.content.listScenes(job.contentProjectId, activeWorkspaceId).catch(() => [])
      : [];
    const pins = await this.content.listJobPins(job.id, activeWorkspaceId).catch(() => []);
    return { job, project, scenes, pins };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async appendEvent(
    outputId: string,
    eventType: string,
    message: string,
    metadata: Record<string, unknown> = {},
  ): Promise<GalleryOutputEventRecord> {
    return this.repo.appendEvent({ galleryOutputId: outputId, eventType, message, metadata });
  }
}

export type { GalleryOutputStatus };
