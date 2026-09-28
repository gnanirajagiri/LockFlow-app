/**
 * Templates service layer.
 *
 * The single entry point the UI uses for Templates. It owns NOTHING:
 * templates suggest canonical source records but never pin versions, never
 * create job requests, never generate media. Applying a template creates a
 * NEW draft Content Project through the existing Content Studio service —
 * the template itself is never modified.
 */
import type { ContentProjectRecord } from '../domain/content';
import type {
  ApplyTemplateInput,
  ContentTemplateBeatRecord,
  ContentTemplateEventRecord,
  ContentTemplateRecord,
  ContentTemplateSceneRecord,
  ContentTemplateSuggestionRecord,
  CreateContentTemplateInput,
  CreateTemplateSuggestionInput,
} from '../domain/templates';
import {
  validateUpdateTemplateScene,
  validateUpdateTemplateBeat,
  validateUpdateTemplateSuggestion,
  validateCreateContentTemplate,
  validateCreateTemplateBeat,
  validateCreateTemplateScene,
  validateCreateTemplateSuggestion,
  validateReorder,
  validateUpdateContentTemplate,
  assertTemplateEditable,
  assertTemplateApplicable,
  refuseInvalidTemplateTransition,
  suggestionShapeProblem,
} from '../domain/templates';
import type { TemplatesRepository, TemplateSummary } from '../data/templatesRepository';
import type { ContentStudioService } from './contentService';
import { LibraryService } from './libraryService';
import { ModelsService } from './modelsService';
import { EnvironmentsService } from './environmentsService';

/** Bridges so suggestion assets can be verified same-workspace (read-only). */
export interface TemplateBridges {
  library: LibraryService;
  models: ModelsService;
  environments: EnvironmentsService;
}

export class TemplatesService {
  constructor(
    private readonly repo: TemplatesRepository,
    private readonly bridges: TemplateBridges,
  ) {}

  // ── Templates ──────────────────────────────────────────────────────────────

  async listTemplates(workspaceId: string): Promise<TemplateSummary[]> {
    return this.repo.listTemplates(workspaceId);
  }

  async getTemplate(templateId: string, activeWorkspaceId: string): Promise<ContentTemplateRecord> {
    const template = await this.repo.getTemplate(templateId);
    isInWorkspace(template.workspaceId, activeWorkspaceId);
    return template;
  }

  async createTemplate(input: unknown, createdBy: string): Promise<ContentTemplateRecord> {
    const result = validateCreateContentTemplate(input);
    if (!result.ok) throw new Error(`Invalid template: ${result.errors.join('; ')}`);
    const template = await this.repo.createTemplate(result.value, createdBy);
    await this.repo.appendEvent({
      contentTemplateId: template.id,
      eventType: 'created',
      message: 'Template created.',
      metadata: { category: template.category, defaultOutputType: template.defaultOutputType },
    });
    return template;
  }

  async updateTemplate(
    templateId: string,
    patch: unknown,
    activeWorkspaceId: string,
  ): Promise<ContentTemplateRecord> {
    const template = await this.getTemplate(templateId, activeWorkspaceId);
    assertTemplateEditable(template);

    const result = validateUpdateContentTemplate(patch);
    if (!result.ok) throw new Error(`Invalid template update: ${result.errors.join('; ')}`);
    const updated = await this.repo.updateTemplate(templateId, result.value);
    await this.repo.appendEvent({
      contentTemplateId: templateId,
      eventType: 'updated',
      message: 'Template details updated.',
      metadata: { fields: Object.keys(result.value) },
    });
    return updated;
  }

  /** Copies template, scenes, beats and suggestions into a new draft template. */
  async duplicateTemplate(
    templateId: string,
    newName: string,
    activeWorkspaceId: string,
  ): Promise<ContentTemplateRecord> {
    const source = await this.getTemplate(templateId, activeWorkspaceId);
    const name = newName.trim();
    if (name.length < 1 || name.length > 80) throw new Error('name must be 1–80 characters');

    const [scenes, suggestions] = await Promise.all([
      this.repo.listScenes(source.id),
      this.repo.listSuggestions(source.id),
    ]);
    const beatsByScene: Record<string, ContentTemplateBeatRecord[]> = {};
    for (const scene of scenes) {
      beatsByScene[scene.id] = await this.repo.listBeats(scene.id);
    }

    const copy: CreateContentTemplateInput = {
      workspaceId: source.workspaceId,
      name,
      category: source.category,
      defaultOutputType: source.defaultOutputType,
      defaultVariants: source.defaultVariants,
      description: source.description ?? undefined,
      briefTemplate: { ...source.briefTemplate },
      creativeDirection: source.creativeDirection ?? undefined,
    };
    const created = await this.repo.createTemplate(copy, source.createdBy);

    const sceneIdMap = new Map<string, string>();
    for (const scene of scenes) {
      const copyScene: Omit<ContentTemplateSceneRecord, 'id' | 'createdAt' | 'updatedAt'> = {
        contentTemplateId: created.id,
        title: scene.title,
        purpose: scene.purpose,
        settingNotes: scene.settingNotes,
        shotNotes: scene.shotNotes,
        sceneOrder: scene.sceneOrder,
      };
      const newScene = await this.repo.addScene(copyScene);
      sceneIdMap.set(scene.id, newScene.id);
      for (const beat of beatsByScene[scene.id] ?? []) {
        const copyBeat: Omit<ContentTemplateBeatRecord, 'id' | 'createdAt' | 'updatedAt'> = {
          contentTemplateSceneId: newScene.id,
          title: beat.title,
          actionDescription: beat.actionDescription,
          dialogueOrOverlay: beat.dialogueOrOverlay,
          cameraDirection: beat.cameraDirection,
          durationSeconds: beat.durationSeconds,
          beatOrder: beat.beatOrder,
        };
        await this.repo.addBeat(copyBeat);
      }
    }
    for (const suggestion of suggestions) {
      await this.repo.addSuggestion({
        contentTemplateId: created.id,
        suggestionType: suggestion.suggestionType,
        suggestedRole: suggestion.suggestedRole,
        suggestedAssetId: suggestion.suggestedAssetId,
        suggestedAssetType: suggestion.suggestedAssetType,
        compatibilityNotes: suggestion.compatibilityNotes,
        sortOrder: suggestion.sortOrder,
      });
    }

    await this.repo.appendEvent({
      contentTemplateId: created.id,
      eventType: 'duplicated',
      message: `Duplicated from ${source.name}.`,
      metadata: { sourceTemplateId: source.id },
    });
    return created;
  }

  async archiveTemplate(templateId: string, activeWorkspaceId: string): Promise<ContentTemplateRecord> {
    const template = await this.getTemplate(templateId, activeWorkspaceId);
    refuseInvalidTemplateTransition(template.status, 'archived');
    const updated = await this.repo.updateTemplateStatus(templateId, 'archived');
    await this.repo.appendEvent({
      contentTemplateId: templateId,
      eventType: 'archived',
      message: 'Template archived (soft archive; nothing deleted).',
      metadata: {},
    });
    return updated;
  }

  async restoreTemplate(templateId: string, activeWorkspaceId: string): Promise<ContentTemplateRecord> {
    const template = await this.getTemplate(templateId, activeWorkspaceId);
    refuseInvalidTemplateTransition(template.status, 'draft');
    const updated = await this.repo.updateTemplateStatus(templateId, 'draft');
    await this.repo.appendEvent({
      contentTemplateId: templateId,
      eventType: 'restored',
      message: 'Template restored to draft.',
      metadata: {},
    });
    return updated;
  }

  // ── Scenes ─────────────────────────────────────────────────────────────────

  async listScenes(templateId: string, activeWorkspaceId: string): Promise<ContentTemplateSceneRecord[]> {
    await this.getTemplate(templateId, activeWorkspaceId);
    return this.repo.listScenes(templateId);
  }

  async createScene(input: unknown, activeWorkspaceId: string): Promise<ContentTemplateSceneRecord> {
    const result = validateCreateTemplateScene(input);
    if (!result.ok) throw new Error(`Invalid template scene: ${result.errors.join('; ')}`);

    const template = await this.getTemplate(result.value.contentTemplateId, activeWorkspaceId);
    assertTemplateEditable(template);

    const created = await this.repo.addScene({
      contentTemplateId: result.value.contentTemplateId,
      title: result.value.title,
      purpose: result.value.purpose ?? null,
      sceneOrder: (await this.repo.listScenes(result.value.contentTemplateId)).length,
      settingNotes: result.value.settingNotes ?? null,
      shotNotes: result.value.shotNotes ?? null,
    });
    await this.touchUpdated(result.value.contentTemplateId, `Scene added: ${created.title}`);
    return created;
  }

  async updateScene(sceneId: string, patch: unknown, activeWorkspaceId: string): Promise<ContentTemplateSceneRecord> {
    const scene = await this.repo.getScene(sceneId);
    const template = await this.getTemplate(scene.contentTemplateId, activeWorkspaceId);
    assertTemplateEditable(template);

    const result = validateUpdateTemplateScene(patch);
    if (!result.ok) throw new Error(`Invalid scene update: ${result.errors.join('; ')}`);
    const updated = await this.repo.updateScene(sceneId, result.value);
    await this.touchUpdated(scene.contentTemplateId, `Scene updated: ${updated.title}`);
    return updated;
  }

  async deleteScene(sceneId: string, activeWorkspaceId: string): Promise<void> {
    const scene = await this.repo.getScene(sceneId);
    const template = await this.getTemplate(scene.contentTemplateId, activeWorkspaceId);
    assertTemplateEditable(template);
    await this.repo.deleteScene(sceneId); // beats cascade; sibling order compacts
    await this.touchUpdated(scene.contentTemplateId, `Scene removed: ${scene.title}`);
  }

  async reorderScenes(templateId: string, order: unknown, activeWorkspaceId: string): Promise<void> {
    const template = await this.getTemplate(templateId, activeWorkspaceId);
    assertTemplateEditable(template);
    const result = validateReorder(order);
    if (!result.ok) throw new Error(`Invalid scene reorder: ${result.errors.join('; ')}`);
    await this.repo.reorderScenes(templateId, result.value);
    await this.touchUpdated(templateId, 'Scene order updated.');
  }

  // ── Beats ──────────────────────────────────────────────────────────────────

  async listBeats(sceneId: string, activeWorkspaceId: string): Promise<ContentTemplateBeatRecord[]> {
    const scene = await this.repo.getScene(sceneId);
    await this.getTemplate(scene.contentTemplateId, activeWorkspaceId);
    return this.repo.listBeats(sceneId);
  }

  async createBeat(input: unknown, activeWorkspaceId: string): Promise<ContentTemplateBeatRecord> {
    const result = validateCreateTemplateBeat(input);
    if (!result.ok) throw new Error(`Invalid template beat: ${result.errors.join('; ')}`);

    const scene = await this.repo.getScene(result.value.contentTemplateSceneId);
    const template = await this.getTemplate(scene.contentTemplateId, activeWorkspaceId);
    assertTemplateEditable(template);

    const created = await this.repo.addBeat({
      contentTemplateSceneId: result.value.contentTemplateSceneId,
      title: result.value.title,
      beatOrder: (await this.repo.listBeats(result.value.contentTemplateSceneId)).length,
      actionDescription: result.value.actionDescription ?? null,
      dialogueOrOverlay: result.value.dialogueOrOverlay ?? null,
      cameraDirection: result.value.cameraDirection ?? null,
      durationSeconds: result.value.durationSeconds ?? null,
    });
    await this.touchUpdated(scene.contentTemplateId, `Beat added to ${scene.title}: ${created.title}`);
    return created;
  }

  async updateBeat(beatId: string, patch: unknown, activeWorkspaceId: string): Promise<ContentTemplateBeatRecord> {
    const beat = await this.repo.getBeat(beatId);
    const scene = await this.repo.getScene(beat.contentTemplateSceneId);
    const template = await this.getTemplate(scene.contentTemplateId, activeWorkspaceId);
    assertTemplateEditable(template);

    const result = validateUpdateTemplateBeat(patch);
    if (!result.ok) throw new Error(`Invalid beat update: ${result.errors.join('; ')}`);
    const updated = await this.repo.updateBeat(beatId, result.value);
    await this.touchUpdated(scene.contentTemplateId, `Beat updated: ${updated.title}`);
    return updated;
  }

  async deleteBeat(beatId: string, activeWorkspaceId: string): Promise<void> {
    const beat = await this.repo.getBeat(beatId);
    const scene = await this.repo.getScene(beat.contentTemplateSceneId);
    const template = await this.getTemplate(scene.contentTemplateId, activeWorkspaceId);
    assertTemplateEditable(template);
    await this.repo.deleteBeat(beatId);
    await this.touchUpdated(scene.contentTemplateId, `Beat removed: ${beat.title}`);
  }

  async reorderBeats(sceneId: string, order: unknown, activeWorkspaceId: string): Promise<void> {
    const scene = await this.repo.getScene(sceneId);
    const template = await this.getTemplate(scene.contentTemplateId, activeWorkspaceId);
    assertTemplateEditable(template);
    const result = validateReorder(order);
    if (!result.ok) throw new Error(`Invalid beat reorder: ${result.errors.join('; ')}`);
    await this.repo.reorderBeats(sceneId, result.value);
    await this.touchUpdated(scene.contentTemplateId, 'Beat order updated.');
  }

  // ── Suggestions (non-binding) ──────────────────────────────────────────────

  async listSuggestions(templateId: string, activeWorkspaceId: string): Promise<ContentTemplateSuggestionRecord[]> {
    await this.getTemplate(templateId, activeWorkspaceId);
    return this.repo.listSuggestions(templateId);
  }

  /**
   * Adds a NON-BINDING suggestion. Concrete asset references are verified to
   * belong to the same workspace (canonical records, read-only) and never
   * carry or resolve a version.
   */
  async addSuggestion(payload: unknown, activeWorkspaceId: string): Promise<ContentTemplateSuggestionRecord> {
    const result = validateCreateTemplateSuggestion(payload);
    if (!result.ok) throw new Error(`Invalid suggestion: ${result.errors.join('; ')}`);
    const value = result.value;

    const template = await this.getTemplate(value.contentTemplateId, activeWorkspaceId);
    assertTemplateEditable(template);

    if (value.suggestedAssetId) {
      await this.assertSuggestionAsset(value.suggestionType, value.suggestedAssetId, activeWorkspaceId);
    }

    const record = await this.repo.addSuggestion({
      contentTemplateId: value.contentTemplateId,
      suggestionType: value.suggestionType,
      suggestedRole: value.suggestedRole,
      suggestedAssetId: value.suggestedAssetId ?? null,
      suggestedAssetType: value.suggestedAssetType ?? null,
      compatibilityNotes: value.compatibilityNotes ?? null,
      sortOrder: (await this.repo.listSuggestions(value.contentTemplateId)).length,
    });
    const problem = suggestionShapeProblem(record);
    if (problem) throw new Error(`Invalid suggestion: ${problem}`);
    await this.touchUpdated(value.contentTemplateId, `Input suggestion added (${value.suggestionType}).`);
    return record;
  }

  async updateSuggestion(suggestionId: string, patch: unknown, activeWorkspaceId: string): Promise<ContentTemplateSuggestionRecord> {
    const suggestion = await this.repo.getSuggestion(suggestionId);
    const template = await this.getTemplate(suggestion.contentTemplateId, activeWorkspaceId);
    assertTemplateEditable(template);

    const result = validateUpdateTemplateSuggestion(patch);
    if (!result.ok) throw new Error(`Invalid suggestion update: ${result.errors.join('; ')}`);
    return this.repo.updateSuggestion(suggestionId, result.value);
  }

  async removeSuggestion(suggestionId: string, activeWorkspaceId: string): Promise<void> {
    const suggestion = await this.repo.getSuggestion(suggestionId);
    const template = await this.getTemplate(suggestion.contentTemplateId, activeWorkspaceId);
    assertTemplateEditable(template);
    await this.repo.removeSuggestion(suggestionId);
    await this.touchUpdated(suggestion.contentTemplateId, 'Input suggestion removed.');
  }

  async reorderSuggestions(templateId: string, order: unknown, activeWorkspaceId: string): Promise<void> {
    const template = await this.getTemplate(templateId, activeWorkspaceId);
    assertTemplateEditable(template);
    const result = validateReorder(order);
    if (!result.ok) throw new Error(`Invalid suggestion reorder: ${result.errors.join('; ')}`);
    await this.repo.reorderSuggestions(templateId, result.value);
  }

  async listEvents(templateId: string, activeWorkspaceId: string): Promise<ContentTemplateEventRecord[]> {
    await this.getTemplate(templateId, activeWorkspaceId);
    return this.repo.listEvents(templateId);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async assertSuggestionAsset(
    suggestionType: CreateTemplateSuggestionInput['suggestionType'],
    assetId: string,
    activeWorkspaceId: string,
  ): Promise<void> {
    if (suggestionType === 'model') {
      const model = await this.bridges.models.getModel(assetId, activeWorkspaceId);
      isInWorkspace(model.workspaceId, activeWorkspaceId);
      return;
    }
    if (suggestionType === 'environment') {
      const environment = await this.bridges.environments.getEnvironment(assetId, activeWorkspaceId);
      isInWorkspace(environment.workspaceId, activeWorkspaceId);
      return;
    }
    if (suggestionType === 'look' || suggestionType === 'library_asset') {
      const asset = await this.bridges.library.getAsset(assetId, activeWorkspaceId);
      isInWorkspace(asset.workspaceId, activeWorkspaceId);
      if (suggestionType === 'look' && asset.assetType !== 'look') {
        throw new Error('Look suggestions must reference a look-type Library asset.');
      }
      return;
    }
    throw new Error('Category suggestions must not reference a concrete asset.');
  }

  /** Record a template "updated" audit event after structural edits. */
  private async touchUpdated(templateId: string, message: string): Promise<void> {
    await this.repo.appendEvent({
      contentTemplateId: templateId,
      eventType: 'updated',
      message,
      metadata: {},
    });
  }
}



// ── Application service ─────────────────────────────────────────────────────

export interface ApplyTemplateResult {
  project: ContentProjectRecord;
  template: ContentTemplateRecord;
  copiedScenes: number;
  copiedBeats: number;
  /** Non-binding suggestions shown in Content Studio's Inputs step panel. */
  suggestions: ContentTemplateSuggestionRecord[];
}

export class TemplateApplicationService {
  constructor(
    private readonly templatesRepo: TemplatesRepository,
    private readonly content: ContentStudioService,
  ) {}

  /**
   * Rule — applying a template creates a NEW draft Content Project. The
   * template is never modified, no job request or pin is created, nothing is
   * generated, and no suggestion becomes a project input or version pin.
   */
  async applyTemplate(
    templateId: string,
    input: ApplyTemplateInput,
    createdBy: string,
    activeWorkspaceId: string,
  ): Promise<ApplyTemplateResult> {
    const template = await this.templatesRepo.getTemplate(templateId);
    isInWorkspace(template.workspaceId, activeWorkspaceId);
    assertTemplateApplicable(template);

    const projectName = input.projectName.trim();
    if (projectName.length < 1 || projectName.length > 80) {
      throw new Error('projectName must be 1–80 characters');
    }

    const [scenes, suggestions] = await Promise.all([
      this.templatesRepo.listScenes(template.id),
      this.templatesRepo.listSuggestions(template.id),
    ]);
    const beatsByScene: Record<string, ContentTemplateBeatRecord[]> = {};
    let beatTotal = 0;
    for (const scene of scenes) {
      beatsByScene[scene.id] = await this.templatesRepo.listBeats(scene.id);
      beatTotal += beatsByScene[scene.id].length;
    }

    // 1. New draft project — user-provided name, copied brief/plan defaults,
//    plus write-once provenance so Content Studio can show "created from".
    const project = await this.content.createProject(
      {
        workspaceId: activeWorkspaceId,
        name: projectName,
        campaignBrief: input.campaignBriefOverride?.trim() || template.briefTemplate.campaignBrief || undefined,
        objective: template.briefTemplate.objective ?? undefined,
        audience: template.briefTemplate.audience ?? undefined,
        brandVoice: template.briefTemplate.brandVoice ?? undefined,
        plannedOutputType: template.defaultOutputType,
        requestedVariants: input.requestedVariantsOverride ?? template.defaultVariants,
        sourceTemplateId: template.id,
        sourceTemplateName: template.name,
      },
      createdBy,
    );

    // 2. Copy creative direction via the normal draft-update path.
    if (template.creativeDirection) {
      await this.content.updateProjectDraft(
        project.id,
        { creativeDirection: template.creativeDirection },
        activeWorkspaceId,
      );
    }

    // 3. Copy scenes and beats preserving order — fully editable drafts.
    for (const scene of scenes) {
      const newScene = await this.content.createScene(
        {
          contentProjectId: project.id,
          title: scene.title,
          purpose: scene.purpose ?? undefined,
          settingNotes: scene.settingNotes ?? undefined,
          shotNotes: scene.shotNotes ?? undefined,
        },
        activeWorkspaceId,
      );
      for (const beat of beatsByScene[scene.id] ?? []) {
        await this.content.createBeat(
          {
            contentSceneId: newScene.id,
            title: beat.title,
            actionDescription: beat.actionDescription ?? undefined,
            dialogueOrOverlay: beat.dialogueOrOverlay ?? undefined,
            cameraDirection: beat.cameraDirection ?? undefined,
            durationSeconds: beat.durationSeconds ?? undefined,
          },
          activeWorkspaceId,
        );
      }
    }

    // 4. Safe audit metadata only: new project identifier + name.
    await this.templatesRepo.appendEvent({
      contentTemplateId: template.id,
      eventType: 'applied',
      message: `Applied — created the "${project.name}" content plan draft.`,
      metadata: {
        contentProjectId: project.id,
        contentProjectName: project.name,
        sceneCount: scenes.length,
        beatCount: beatTotal,
      },
    });

    return { project, template, copiedScenes: scenes.length, copiedBeats: beatTotal, suggestions };
  }
}

function isInWorkspace(recordWorkspaceId: string, activeWorkspaceId: string): void {
  if (recordWorkspaceId !== activeWorkspaceId) {
    throw new Error('Cross-workspace access denied.');
  }
}
