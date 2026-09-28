/**
 * In-memory Content Studio repository — demo mode.
 *
 * Runs on the development seed data and enforces the same structural rules
 * the Supabase path guarantees (unique slugs, unique scene/beat order per
 * parent, pins immutability, append-only events) so UI behaviour matches.
 */
import type {
  ContentBeatRecord,
  ContentJobEventRecord,
  ContentJobPinRecord,
  ContentJobRequestRecord,
  ContentProjectInputRecord,
  ContentProjectRecord,
  ContentSceneRecord,
  CreateContentProjectInput,
  UpdateContentProjectDraftInput,
} from '../domain/content';
import {
  CONTENT_SEED,
} from '../mock/contentSeed';
import type { ContentRepository } from './contentRepository';

const now = () => new Date().toISOString();

function notFound(what: string, id: string): never {
  throw new Error(`${what} not found: ${id}`);
}

/** Compact (0..n-1) rewrite of an order column from an explicit id order. */
function ordersFromIds(
  rows: Array<{ id: string }>,
  orderedIds: string[],
): Array<{ id: string; sortOrder: number }> {
  const map = new Map(orderedIds.map((id, index) => [id, index]));
  const missing = rows.filter((row) => !map.has(row.id));
  if (missing.length > 0) {
    throw new Error(`Reorder is missing ${missing.length} row(s) — pass the complete order.`);
  }
  if (map.size !== rows.length) {
    throw new Error('Reorder contains unknown rows.');
  }
  return rows.map((row) => ({ id: row.id, sortOrder: map.get(row.id)! }));
}

export class MockContentRepository implements ContentRepository {
  private projects = new Map<string, ContentProjectRecord>();
  private inputs = new Map<string, ContentProjectInputRecord>();
  private scenes = new Map<string, ContentSceneRecord>();
  private beats = new Map<string, ContentBeatRecord>();
  private jobRequests = new Map<string, ContentJobRequestRecord>();
  private jobPins = new Map<string, ContentJobPinRecord[]>(); // key: jobRequestId
  private jobEvents = new Map<string, ContentJobEventRecord[]>(); // key: jobRequestId

  constructor() {
    for (const seed of CONTENT_SEED) {
      this.projects.set(seed.project.id, structuredClone(seed.project));
      for (const input of seed.inputs) this.inputs.set(input.id, structuredClone(input));
      for (const scene of seed.scenes) {
        this.scenes.set(scene.id, structuredClone(scene));
        for (const beat of seed.beats[scene.id] ?? []) this.beats.set(beat.id, structuredClone(beat));
      }
      if (seed.jobRequest) {
        this.jobRequests.set(seed.jobRequest.id, structuredClone(seed.jobRequest));
        this.jobEvents.set(seed.jobRequest.id, seed.jobEvents.map((event) => structuredClone(event)));
        this.jobPins.set(seed.jobRequest.id, []);
      }
    }
  }

  // ── Projects ───────────────────────────────────────────────────────────────

  async listProjects(workspaceId: string): Promise<ContentProjectRecord[]> {
    return [...this.projects.values()]
      .filter((project) => project.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((project) => structuredClone(project));
  }

  async getProject(projectId: string): Promise<ContentProjectRecord> {
    const project = this.projects.get(projectId);
    if (!project) notFound('Content project', projectId);
    return structuredClone(project);
  }

  async assertSlugAvailable(workspaceId: string, slug: string): Promise<void> {
    for (const project of this.projects.values()) {
      if (project.workspaceId === workspaceId && project.slug === slug) {
        throw new Error(`Slug "${slug}" is already used in this workspace.`);
      }
    }
  }

  async createProject(input: CreateContentProjectInput, createdBy: string): Promise<ContentProjectRecord> {
    await this.assertSlugAvailable(input.workspaceId, input.slug ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    const stamp = now();
    const record: ContentProjectRecord = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      slug: input.slug ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      status: 'draft',
      campaignBrief: input.campaignBrief ?? null,
      objective: input.objective ?? null,
      audience: input.audience ?? null,
      brandVoice: input.brandVoice ?? null,
      plannedOutputType: input.plannedOutputType ?? null,
      requestedVariants: input.requestedVariants ?? 1,
      creativeDirection: null,
      storyboardDirection: null,
      createdBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.projects.set(record.id, record);
    return structuredClone(record);
  }

  async updateProjectDraft(
    projectId: string,
    patch: UpdateContentProjectDraftInput,
  ): Promise<ContentProjectRecord> {
    const project = await this.getProject(projectId);
    const next = { ...project, ...patch, updatedAt: now() };
    this.projects.set(projectId, next);
    return structuredClone(next);
  }

  async archiveProject(projectId: string): Promise<ContentProjectRecord> {
    const project = await this.getProject(projectId);
    if (project.status === 'archived') return project;
    if (project.status !== 'draft' && project.status !== 'ready') {
      throw new Error(`Archive is a soft status change only (current status: ${project.status}).`);
    }
    const next = { ...project, status: 'archived' as const, updatedAt: now() };
    this.projects.set(projectId, next);
    return structuredClone(next);
  }

  // ── Project inputs ─────────────────────────────────────────────────────────

  async listInputs(contentProjectId: string): Promise<ContentProjectInputRecord[]> {
    return [...this.inputs.values()]
      .filter((input) => input.contentProjectId === contentProjectId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((input) => structuredClone(input));
  }

  async getInput(inputId: string): Promise<ContentProjectInputRecord> {
    const input = this.inputs.get(inputId);
    if (!input) notFound('Project input', inputId);
    return structuredClone(input);
  }

  async addInput(
    input: Omit<ContentProjectInputRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentProjectInputRecord> {
    const existing = await this.listInputs(input.contentProjectId);
    const stamp = now();
    const row: ContentProjectInputRecord = {
      ...input,
      sortOrder: existing.length,
      id: crypto.randomUUID(),
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.inputs.set(row.id, row);
    return structuredClone(row);
  }

  async removeInput(inputId: string): Promise<void> {
    const input = await this.getInput(inputId);
    this.inputs.delete(inputId);
    // Compact remaining order so it stays contiguous.
    const remaining = await this.listInputs(input.contentProjectId);
    for (const [index, row] of remaining.entries()) {
      this.inputs.set(row.id, { ...row, sortOrder: index, updatedAt: now() });
    }
  }

  async reorderInputs(contentProjectId: string, orderedIds: string[]): Promise<void> {
    const rows = await this.listInputs(contentProjectId);
    for (const { id, sortOrder } of ordersFromIds(rows, orderedIds)) {
      this.inputs.set(id, { ...(await this.getInput(id)), sortOrder, updatedAt: now() });
    }
  }

  // ── Scenes ─────────────────────────────────────────────────────────────────

  async listScenes(contentProjectId: string): Promise<ContentSceneRecord[]> {
    return [...this.scenes.values()]
      .filter((scene) => scene.contentProjectId === contentProjectId)
      .sort((a, b) => a.sceneOrder - b.sceneOrder)
      .map((scene) => structuredClone(scene));
  }

  async getScene(sceneId: string): Promise<ContentSceneRecord> {
    const scene = this.scenes.get(sceneId);
    if (!scene) notFound('Content scene', sceneId);
    return structuredClone(scene);
  }

  async addScene(
    input: Omit<ContentSceneRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentSceneRecord> {
    const existing = await this.listScenes(input.contentProjectId);
    const stamp = now();
    const row: ContentSceneRecord = {
      ...input,
      sceneOrder: existing.length,
      id: crypto.randomUUID(),
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.scenes.set(row.id, row);
    return structuredClone(row);
  }

  async updateScene(sceneId: string, patch: Record<string, unknown>): Promise<ContentSceneRecord> {
    const scene = await this.getScene(sceneId);
    const next = { ...scene, ...patch, updatedAt: now() };
    this.scenes.set(sceneId, next);
    return structuredClone(next);
  }

  async deleteScene(sceneId: string): Promise<void> {
    const scene = await this.getScene(sceneId);
    this.scenes.delete(sceneId);
    // Cascade beats (mirrors ON DELETE CASCADE in Postgres).
    for (const [beatId, beat] of [...this.beats]) {
      if (beat.contentSceneId === sceneId) this.beats.delete(beatId);
    }
    // Compact sibling scene order.
    const remaining = await this.listScenes(scene.contentProjectId);
    for (const [index, row] of remaining.entries()) {
      this.scenes.set(row.id, { ...row, sceneOrder: index, updatedAt: now() });
    }
  }

  async reorderScenes(contentProjectId: string, orderedIds: string[]): Promise<void> {
    const rows = await this.listScenes(contentProjectId);
    for (const { id, sortOrder } of ordersFromIds(rows, orderedIds)) {
      this.scenes.set(id, { ...(await this.getScene(id)), sceneOrder: sortOrder, updatedAt: now() });
    }
  }

  // ── Beats ──────────────────────────────────────────────────────────────────

  async listBeats(contentSceneId: string): Promise<ContentBeatRecord[]> {
    return [...this.beats.values()]
      .filter((beat) => beat.contentSceneId === contentSceneId)
      .sort((a, b) => a.beatOrder - b.beatOrder)
      .map((beat) => structuredClone(beat));
  }

  async getBeat(beatId: string): Promise<ContentBeatRecord> {
    const beat = this.beats.get(beatId);
    if (!beat) notFound('Content beat', beatId);
    return structuredClone(beat);
  }

  async addBeat(
    input: Omit<ContentBeatRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentBeatRecord> {
    const existing = await this.listBeats(input.contentSceneId);
    const stamp = now();
    const row: ContentBeatRecord = {
      ...input,
      beatOrder: existing.length,
      id: crypto.randomUUID(),
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.beats.set(row.id, row);
    return structuredClone(row);
  }

  async updateBeat(beatId: string, patch: Record<string, unknown>): Promise<ContentBeatRecord> {
    const beat = await this.getBeat(beatId);
    const next = { ...beat, ...patch, updatedAt: now() };
    this.beats.set(beatId, next);
    return structuredClone(next);
  }

  async deleteBeat(beatId: string): Promise<void> {
    const beat = await this.getBeat(beatId);
    this.beats.delete(beatId);
    const remaining = await this.listBeats(beat.contentSceneId);
    for (const [index, row] of remaining.entries()) {
      this.beats.set(row.id, { ...row, beatOrder: index, updatedAt: now() });
    }
  }

  async reorderBeats(contentSceneId: string, orderedIds: string[]): Promise<void> {
    const rows = await this.listBeats(contentSceneId);
    for (const { id, sortOrder } of ordersFromIds(rows, orderedIds)) {
      this.beats.set(id, { ...(await this.getBeat(id)), beatOrder: sortOrder, updatedAt: now() });
    }
  }

  // ── Job requests ───────────────────────────────────────────────────────────

  async listJobRequests(workspaceId: string): Promise<ContentJobRequestRecord[]> {
    return [...this.jobRequests.values()]
      .filter((job) => job.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((job) => structuredClone(job));
  }

  async getJobRequest(jobRequestId: string): Promise<ContentJobRequestRecord> {
    const job = this.jobRequests.get(jobRequestId);
    if (!job) notFound('Content job request', jobRequestId);
    return structuredClone(job);
  }

  async createJobRequest(
    input: Omit<ContentJobRequestRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentJobRequestRecord> {
    const stamp = now();
    const row: ContentJobRequestRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.jobRequests.set(row.id, row);
    this.jobEvents.set(row.id, []);
    this.jobPins.set(row.id, []);
    return structuredClone(row);
  }

  async updateJobRequestStatus(
    jobRequestId: string,
    status: ContentJobRequestRecord['status'],
  ): Promise<ContentJobRequestRecord> {
    const job = await this.getJobRequest(jobRequestId);
    const next = { ...job, status, updatedAt: now() };
    this.jobRequests.set(jobRequestId, next);
    return structuredClone(next);
  }

  // ── Job pins ───────────────────────────────────────────────────────────────

  async listJobPins(contentJobRequestId: string): Promise<ContentJobPinRecord[]> {
    return (this.jobPins.get(contentJobRequestId) ?? []).map((pin) => structuredClone(pin));
  }

  async createJobPins(
    pins: Array<Omit<ContentJobPinRecord, 'id' | 'createdAt'>>,
  ): Promise<ContentJobPinRecord[]> {
    const job = await this.getJobRequest(pins[0]?.contentJobRequestId ?? '');
    if (job.status !== 'draft') {
      throw new Error(`Job pins are immutable while the job is ${job.status}.`);
    }
    const created = pins.map((pin) => ({ ...pin, id: crypto.randomUUID(), createdAt: now() }));
    this.jobPins.set(job.id, [...(this.jobPins.get(job.id) ?? []), ...created]);
    return structuredClone(created);
  }

  async removeJobPins(contentJobRequestId: string): Promise<void> {
    const job = await this.getJobRequest(contentJobRequestId);
    if (job.status !== 'draft') {
      throw new Error(`Job pins are immutable while the job is ${job.status}.`);
    }
    this.jobPins.set(contentJobRequestId, []);
  }

  // ── Job events ─────────────────────────────────────────────────────────────

  async listJobEvents(contentJobRequestId: string): Promise<ContentJobEventRecord[]> {
    return (this.jobEvents.get(contentJobRequestId) ?? []).map((event) => structuredClone(event));
  }

  async appendJobEvent(event: Omit<ContentJobEventRecord, 'id' | 'createdAt'>): Promise<ContentJobEventRecord> {
    const row: ContentJobEventRecord = { ...event, id: crypto.randomUUID(), createdAt: now() };
    this.jobEvents.set(row.contentJobRequestId, [
      ...(this.jobEvents.get(row.contentJobRequestId) ?? []),
      row,
    ]);
    return structuredClone(row);
  }
}
