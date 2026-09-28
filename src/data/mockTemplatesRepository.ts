/**
 * In-memory Templates repository — demo mode.
 *
 * Runs on the dev seed templates and enforces the same structural rules the
 * Supabase path guarantees (unique slugs, unique scene/beat/suggestion order
 * per parent, append-only events) so UI behaviour matches.
 */
import type {
  ContentTemplateBeatRecord,
  ContentTemplateEventRecord,
  ContentTemplateRecord,
  ContentTemplateSceneRecord,
  ContentTemplateSuggestionRecord,
  CreateContentTemplateInput,
  TemplateStatus,
  UpdateContentTemplateInput,
  UpdateTemplateBeatInput,
  UpdateTemplateSceneInput,
  UpdateTemplateSuggestionInput,
} from '../domain/templates';
import { TEMPLATES_SEED } from '../mock/templatesSeed';
import type { TemplatesRepository, TemplateSummary } from './templatesRepository';

const now = () => new Date().toISOString();

function notFound(what: string, id: string): never {
  throw new Error(`${what} not found: ${id}`);
}

/** Compact (0..n-1) rewrite of an order column from an explicit id order. */
function ordersFromIds(
  rows: Array<{ id: string }>,
  orderedIds: string[],
): Array<{ id: string; order: number }> {
  const map = new Map(orderedIds.map((id, index) => [id, index]));
  const missing = rows.filter((row) => !map.has(row.id));
  if (missing.length > 0) {
    throw new Error(`Reorder is missing ${missing.length} row(s) — pass the complete order.`);
  }
  if (map.size !== rows.length) {
    throw new Error('Reorder contains unknown rows.');
  }
  return rows.map((row) => ({ id: row.id, order: map.get(row.id)! }));
}

export class MockTemplatesRepository implements TemplatesRepository {
  private templates = new Map<string, ContentTemplateRecord>();
  private scenes = new Map<string, ContentTemplateSceneRecord>();
  private beats = new Map<string, ContentTemplateBeatRecord>();
  private suggestions = new Map<string, ContentTemplateSuggestionRecord>();
  private events = new Map<string, ContentTemplateEventRecord[]>(); // key: templateId

  constructor() {
    for (const seed of TEMPLATES_SEED) {
      this.templates.set(seed.template.id, structuredClone(seed.template));
      for (const scene of seed.scenes) {
        this.scenes.set(scene.id, structuredClone(scene));
        for (const beat of seed.beats[scene.id] ?? []) this.beats.set(beat.id, structuredClone(beat));
      }
      for (const suggestion of seed.suggestions) this.suggestions.set(suggestion.id, structuredClone(suggestion));
      this.events.set(seed.template.id, seed.events.map((event) => structuredClone(event)));
    }
  }

  // ── Templates ──────────────────────────────────────────────────────────────

  async listTemplates(workspaceId: string): Promise<TemplateSummary[]> {
    const summaries: TemplateSummary[] = [];
    for (const template of this.templates.values()) {
      if (template.workspaceId !== workspaceId) continue;
      const sceneList = [...this.scenes.values()].filter((s) => s.contentTemplateId === template.id);
      let beatCount = 0;
      for (const scene of sceneList) {
        beatCount += [...this.beats.values()].filter((b) => b.contentTemplateSceneId === scene.id).length;
      }
      const suggestionCount = [...this.suggestions.values()].filter((s) => s.contentTemplateId === template.id).length;
      summaries.push({ template: structuredClone(template), sceneCount: sceneList.length, beatCount, suggestionCount });
    }
    return summaries.sort((a, b) => b.template.updatedAt.localeCompare(a.template.updatedAt));
  }

  async getTemplate(templateId: string): Promise<ContentTemplateRecord> {
    const template = this.templates.get(templateId);
    if (!template) notFound('Template', templateId);
    return structuredClone(template);
  }

  async assertSlugAvailable(workspaceId: string, slug: string): Promise<void> {
    for (const template of this.templates.values()) {
      if (template.workspaceId === workspaceId && template.slug === slug) {
        throw new Error(`Slug "${slug}" is already used in this workspace.`);
      }
    }
  }

  async createTemplate(input: CreateContentTemplateInput, createdBy: string): Promise<ContentTemplateRecord> {
    const slug = input.slug ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await this.assertSlugAvailable(input.workspaceId, slug);
    const stamp = now();
    const record: ContentTemplateRecord = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      slug,
      description: input.description ?? null,
      category: input.category,
      status: 'draft',
      defaultOutputType: input.defaultOutputType,
      defaultVariants: input.defaultVariants ?? 1,
      briefTemplate: {
        objective: input.briefTemplate?.objective ?? null,
        audience: input.briefTemplate?.audience ?? null,
        brandVoice: input.briefTemplate?.brandVoice ?? null,
        campaignBrief: input.briefTemplate?.campaignBrief ?? null,
      },
      creativeDirection: input.creativeDirection ?? null,
      createdBy,
      createdAt: stamp,
      updatedAt: stamp,
      archivedAt: null,
    };
    this.templates.set(record.id, record);
    return structuredClone(record);
  }

  async updateTemplate(templateId: string, patch: UpdateContentTemplateInput): Promise<ContentTemplateRecord> {
    const template = await this.getTemplate(templateId);
    const briefPatch = patch.briefTemplate
      ? { ...template.briefTemplate, ...Object.fromEntries(Object.entries(patch.briefTemplate).filter(([, v]) => v !== undefined)) }
      : template.briefTemplate;
    const next: ContentTemplateRecord = {
      ...template,
      ...Object.fromEntries(Object.entries(patch).filter(([key, value]) => value !== undefined && key !== 'briefTemplate')),
      briefTemplate: briefPatch,
      updatedAt: now(),
    };
    this.templates.set(templateId, next);
    return structuredClone(next);
  }

  async updateTemplateStatus(templateId: string, status: TemplateStatus): Promise<ContentTemplateRecord> {
    const template = await this.getTemplate(templateId);
    const next: ContentTemplateRecord = {
      ...template,
      status,
      archivedAt: status === 'archived' ? now() : null,
      updatedAt: now(),
    };
    this.templates.set(templateId, next);
    return structuredClone(next);
  }

  // ── Scenes ─────────────────────────────────────────────────────────────────

  async listScenes(contentTemplateId: string): Promise<ContentTemplateSceneRecord[]> {
    return [...this.scenes.values()]
      .filter((scene) => scene.contentTemplateId === contentTemplateId)
      .sort((a, b) => a.sceneOrder - b.sceneOrder)
      .map((scene) => structuredClone(scene));
  }

  async getScene(sceneId: string): Promise<ContentTemplateSceneRecord> {
    const scene = this.scenes.get(sceneId);
    if (!scene) notFound('Template scene', sceneId);
    return structuredClone(scene);
  }

  async addScene(
    input: Omit<ContentTemplateSceneRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentTemplateSceneRecord> {
    const stamp = now();
    const record: ContentTemplateSceneRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.scenes.set(record.id, record);
    return structuredClone(record);
  }

  async updateScene(sceneId: string, patch: UpdateTemplateSceneInput): Promise<ContentTemplateSceneRecord> {
    const scene = await this.getScene(sceneId);
    const next = { ...scene, ...patch, updatedAt: now() };
    this.scenes.set(sceneId, next);
    return structuredClone(next);
  }

  async deleteScene(sceneId: string): Promise<void> {
    const scene = await this.getScene(sceneId);
    this.scenes.delete(sceneId);
    for (const [beatId, beat] of [...this.beats]) {
      if (beat.contentTemplateSceneId === sceneId) this.beats.delete(beatId);
    }
    const remaining = await this.listScenes(scene.contentTemplateId);
    for (const [index, row] of remaining.entries()) {
      this.scenes.set(row.id, { ...row, sceneOrder: index, updatedAt: now() });
    }
  }

  async reorderScenes(contentTemplateId: string, orderedIds: string[]): Promise<void> {
    const rows = await this.listScenes(contentTemplateId);
    for (const { id, order } of ordersFromIds(rows, orderedIds)) {
      this.scenes.set(id, { ...(await this.getScene(id)), sceneOrder: order, updatedAt: now() });
    }
  }

  // ── Beats ──────────────────────────────────────────────────────────────────

  async listBeats(contentTemplateSceneId: string): Promise<ContentTemplateBeatRecord[]> {
    return [...this.beats.values()]
      .filter((beat) => beat.contentTemplateSceneId === contentTemplateSceneId)
      .sort((a, b) => a.beatOrder - b.beatOrder)
      .map((beat) => structuredClone(beat));
  }

  async getBeat(beatId: string): Promise<ContentTemplateBeatRecord> {
    const beat = this.beats.get(beatId);
    if (!beat) notFound('Template beat', beatId);
    return structuredClone(beat);
  }

  async addBeat(
    input: Omit<ContentTemplateBeatRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentTemplateBeatRecord> {
    const stamp = now();
    const record: ContentTemplateBeatRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.beats.set(record.id, record);
    return structuredClone(record);
  }

  async updateBeat(beatId: string, patch: UpdateTemplateBeatInput): Promise<ContentTemplateBeatRecord> {
    const beat = await this.getBeat(beatId);
    const next = { ...beat, ...patch, updatedAt: now() };
    this.beats.set(beatId, next);
    return structuredClone(next);
  }

  async deleteBeat(beatId: string): Promise<void> {
    const beat = await this.getBeat(beatId);
    this.beats.delete(beatId);
    const remaining = await this.listBeats(beat.contentTemplateSceneId);
    for (const [index, row] of remaining.entries()) {
      this.beats.set(row.id, { ...row, beatOrder: index, updatedAt: now() });
    }
  }

  async reorderBeats(contentTemplateSceneId: string, orderedIds: string[]): Promise<void> {
    const rows = await this.listBeats(contentTemplateSceneId);
    for (const { id, order } of ordersFromIds(rows, orderedIds)) {
      this.beats.set(id, { ...(await this.getBeat(id)), beatOrder: order, updatedAt: now() });
    }
  }

  // ── Suggestions ────────────────────────────────────────────────────────────

  async listSuggestions(contentTemplateId: string): Promise<ContentTemplateSuggestionRecord[]> {
    return [...this.suggestions.values()]
      .filter((suggestion) => suggestion.contentTemplateId === contentTemplateId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((suggestion) => structuredClone(suggestion));
  }

  async getSuggestion(suggestionId: string): Promise<ContentTemplateSuggestionRecord> {
    const suggestion = this.suggestions.get(suggestionId);
    if (!suggestion) notFound('Template suggestion', suggestionId);
    return structuredClone(suggestion);
  }

  async addSuggestion(
    input: Omit<ContentTemplateSuggestionRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentTemplateSuggestionRecord> {
    const existing = await this.listSuggestions(input.contentTemplateId);
    const stamp = now();
    const record: ContentTemplateSuggestionRecord = {
      ...input,
      sortOrder: existing.length,
      id: crypto.randomUUID(),
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.suggestions.set(record.id, record);
    return structuredClone(record);
  }

  async updateSuggestion(suggestionId: string, patch: UpdateTemplateSuggestionInput): Promise<ContentTemplateSuggestionRecord> {
    const suggestion = await this.getSuggestion(suggestionId);
    const next = { ...suggestion, ...patch, updatedAt: now() };
    this.suggestions.set(suggestionId, next);
    return structuredClone(next);
  }

  async removeSuggestion(suggestionId: string): Promise<void> {
    const suggestion = await this.getSuggestion(suggestionId);
    this.suggestions.delete(suggestionId);
    const remaining = await this.listSuggestions(suggestion.contentTemplateId);
    for (const [index, row] of remaining.entries()) {
      this.suggestions.set(row.id, { ...row, sortOrder: index, updatedAt: now() });
    }
  }

  async reorderSuggestions(contentTemplateId: string, orderedIds: string[]): Promise<void> {
    const rows = await this.listSuggestions(contentTemplateId);
    for (const { id, order } of ordersFromIds(rows, orderedIds)) {
      this.suggestions.set(id, { ...(await this.getSuggestion(id)), sortOrder: order, updatedAt: now() });
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  async listEvents(contentTemplateId: string): Promise<ContentTemplateEventRecord[]> {
    return (this.events.get(contentTemplateId) ?? []).map((event) => structuredClone(event));
  }

  async appendEvent(event: Omit<ContentTemplateEventRecord, 'id' | 'createdAt'>): Promise<ContentTemplateEventRecord> {
    const row: ContentTemplateEventRecord = { ...event, id: crypto.randomUUID(), createdAt: now() };
    this.events.set(row.contentTemplateId, [...(this.events.get(row.contentTemplateId) ?? []), row]);
    return structuredClone(row);
  }
}
