/**
 * Templates service rules — the product contracts, tested at the service
 * boundary over fresh mock repositories (reset per test for isolation).
 *
 * Covers the 14 required cases: workspace scoping, cross-workspace denial,
 * no pins/runs/media, suggestion shape rules, apply purity and ordering,
 * reorder validity, honest prompt-bar behaviour, archived read-only,
 * append-only audit events and non-binding Content Studio integration.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { TemplatesService, TemplateApplicationService } from './templatesService';
import type { TemplateBridges } from './templatesService';
import { ContentStudioService } from './contentService';
import { LibraryService } from './libraryService';
import { ModelsService } from './modelsService';
import { EnvironmentsService } from './environmentsService';
import {
  getTemplatesRepository,
  resetTemplatesRepository,
} from '../data/templatesFactory';
import {
  getContentRepository,
  resetContentRepository,
} from '../data/contentFactory';
import { getLibraryRepository, resetLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository, resetModelsRepository } from '../data';
import { getEnvironmentsRepository, resetEnvironmentsRepository } from '../data/environmentsFactory';
import { TEMPLATE_IDS } from '../mock/templatesSeed';
import { SEED_LIBRARY_OTHER_WORKSPACE_ID, SEED_LIBRARY_WORKSPACE_ID } from '../mock/librarySeed';
import { CONTENT_PROJECT_ID } from '../mock/contentSeed';
import type { ContentProjectRecord } from '../domain/content';

let templates: TemplatesService;
let apply: TemplateApplicationService;
let workspaceId: string;

beforeEach(() => {
  resetTemplatesRepository();
  resetContentRepository();
  resetLibraryRepository();
  resetModelsRepository();
  resetEnvironmentsRepository();

  const bridges: TemplateBridges = {
    library: new LibraryService(getLibraryRepository()),
    models: new ModelsService(getModelsRepository()),
    environments: new EnvironmentsService(getEnvironmentsRepository()),
  };
  templates = new TemplatesService(getTemplatesRepository(), bridges);
  apply = new TemplateApplicationService(
    getTemplatesRepository(),
    new ContentStudioService(getContentRepository(), bridges),
  );
  workspaceId = SEED_LIBRARY_WORKSPACE_ID;
});

describe('rule 1 — templates, scenes, beats, suggestions and events are workspace-scoped', () => {
  it('lists only the active workspace\u2019s templates', async () => {
    const list = await templates.listTemplates(workspaceId);
    expect(list.length).toBeGreaterThan(0);
    for (const summary of list) {
      expect(summary.template.workspaceId).toBe(workspaceId);
    }
    const other = await templates.listTemplates(SEED_LIBRARY_OTHER_WORKSPACE_ID);
    expect(other.map((entry) => entry.template.id)).toEqual([TEMPLATE_IDS.otherWorkspace]);
  });

  it('scenes, beats and suggestions resolve through a workspace-checked parent', async () => {
    await expect(
      templates.listScenes(TEMPLATE_IDS.morningLaunch, SEED_LIBRARY_OTHER_WORKSPACE_ID),
    ).rejects.toThrow(/Cross-workspace access denied/);
    await expect(
      templates.listSuggestions(TEMPLATE_IDS.morningLaunch, SEED_LIBRARY_OTHER_WORKSPACE_ID),
    ).rejects.toThrow(/Cross-workspace access denied/);
  });
});

describe('rule 2 — cross-workspace access, apply and suggested asset references are denied', () => {
  it('refuses reading a template from another workspace', async () => {
    await expect(
      templates.getTemplate(TEMPLATE_IDS.otherWorkspace, workspaceId),
    ).rejects.toThrow(/Cross-workspace access denied/);
  });

  it('refuses applying a template from another workspace', async () => {
    await expect(
      apply.applyTemplate(
        TEMPLATE_IDS.otherWorkspace,
        { projectName: 'Sneaky plan' },
        'tester',
        workspaceId,
      ),
    ).rejects.toThrow(/Cross-workspace access denied/);
  });

  it('refuses a concrete suggestion pointing at another workspace\u2019s asset', async () => {
    await expect(
      templates.addSuggestion(
        {
          contentTemplateId: TEMPLATE_IDS.calmTutorial,
          suggestionType: 'library_asset',
          suggestedRole: 'prop',
          suggestedAssetId: 'lib_other_ws_prop',
        },
        workspaceId,
      ),
    ).rejects.toThrow(/Cross-workspace access denied/);
  });
});

describe('rule 3 — templates cannot contain job pins, provider runs or gallery outputs', () => {
  it('the template domain carries no pin/run/output record types', async () => {
    // Structural check at the boundary: the repository contract exposes only
    // template/scene/beat/suggestion/event operations — no pins, runs or media.
    const repo = getTemplatesRepository();
    for (const key of Object.keys(repo)) {
      expect(key).not.toMatch(/pin|run|output|media|provider/i);
    }
  });
});

describe('rule 4 — concrete suggested assets must belong to the same workspace', () => {
  it('accepts a suggestion on a same-workspace canonical asset', async () => {
    const suggestion = await templates.addSuggestion(
      {
        contentTemplateId: TEMPLATE_IDS.calmTutorial,
        suggestionType: 'library_asset',
        suggestedRole: 'product',
        suggestedAssetId: 'lib_luma_serum',
      },
      workspaceId,
    );
    expect(suggestion.suggestedAssetId).toBe('lib_luma_serum');
    expect(suggestion.suggestedRole).toBe('product');
  });

  it('refuses an unknown asset id', async () => {
    await expect(
      templates.addSuggestion(
        {
          contentTemplateId: TEMPLATE_IDS.calmTutorial,
          suggestionType: 'model',
          suggestedRole: 'primary_model',
          suggestedAssetId: 'model_missing',
        },
        workspaceId,
      ),
    ).rejects.toThrow();
  });
});

describe('rule 5 — suggestions cannot store an exact version id', () => {
  it('the suggestion payload has no version field; category suggestions refuse assets', async () => {
    const suggestion = await templates.addSuggestion(
      {
        contentTemplateId: TEMPLATE_IDS.calmTutorial,
        suggestionType: 'library_asset_category',
        suggestedRole: 'prop',
      },
      workspaceId,
    );
    const record = JSON.parse(JSON.stringify(suggestion));
    const keys = Object.keys(record);
    for (const key of keys) {
      expect(key.toLowerCase()).not.toContain('version');
    }
    await expect(
      templates.addSuggestion(
        {
          contentTemplateId: TEMPLATE_IDS.calmTutorial,
          suggestionType: 'library_asset_category',
          suggestedRole: 'prop',
          suggestedAssetId: 'lib_luma_serum',
        },
        workspaceId,
      ),
    ).rejects.toThrow(/category suggestions must not reference a concrete asset/);
  });
});

describe('rule 6 — application creates a new draft project without modifying the template', () => {
  it('creates a draft project and leaves the template untouched', async () => {
    const before = await templates.getTemplate(TEMPLATE_IDS.morningLaunch, workspaceId);
    const result = await apply.applyTemplate(
      TEMPLATE_IDS.morningLaunch,
      { projectName: 'Autumn launch — week 1' },
      'tester',
      workspaceId,
    );
    const after = await templates.getTemplate(TEMPLATE_IDS.morningLaunch, workspaceId);

    expect(after).toEqual(before);
    expect(result.project.status).toBe('draft');
    expect(result.project.name).toBe('Autumn launch — week 1');
    expect(result.project.sourceTemplateId).toBe(TEMPLATE_IDS.morningLaunch);
    expect(result.project.sourceTemplateName).toBe(before.name);
  });

  it('does not overwrite an existing content project', async () => {
    const result = await apply.applyTemplate(
      TEMPLATE_IDS.morningLaunch,
      { projectName: CONTENT_PROJECT_ID },
      'tester',
      workspaceId,
    );
    expect(result.project.id).not.toBe(CONTENT_PROJECT_ID);
  });
});

describe('rule 7 — application copies brief, scenes and beats in order', () => {
  it('copies ordered structure and brief fields into the new project', async () => {
    const result = await apply.applyTemplate(
      TEMPLATE_IDS.morningLaunch,
      { projectName: 'Ordered copy' },
      'tester',
      workspaceId,
    );
    const content = new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });

    const scenes = await content.listScenes(result.project.id, workspaceId);
    expect(scenes.map((scene) => scene.title)).toEqual([
      'Morning setup',
      'Product moment',
      'Routine wrap-up',
    ]);
    expect(scenes.map((scene) => scene.sceneOrder)).toEqual([0, 1, 2]);

    const beats = await content.listBeats(scenes[0].id, workspaceId);
    expect(beats.map((beat) => beat.beatOrder)).toEqual([0, 1]);
    expect(beats[0].dialogueOrOverlay).toContain('the 7 a.m. routine');

    expect(result.project.objective).toContain('morning skincare line');
    expect(result.project.requestedVariants).toBe(3);
  });

  it('honours brief and variant overrides', async () => {
    const result = await apply.applyTemplate(
      TEMPLATE_IDS.morningLaunch,
      { projectName: 'Overridden', campaignBriefOverride: 'Custom brief', requestedVariantsOverride: 2 },
      'tester',
      workspaceId,
    );
    expect(result.project.campaignBrief).toBe('Custom brief');
    expect(result.project.requestedVariants).toBe(2);
  });
});

describe('rule 8 — applied project scenes/beats remain editable draft records', () => {
  it('edits a copied scene via the normal Content Studio path', async () => {
    const result = await apply.applyTemplate(
      TEMPLATE_IDS.morningLaunch,
      { projectName: 'Editable copy' },
      'tester',
      workspaceId,
    );
    const content = new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
    const scenes = await content.listScenes(result.project.id, workspaceId);
    const updated = await content.updateScene(scenes[0].id, { title: 'Opening reworked' }, workspaceId);
    expect(updated.title).toBe('Opening reworked');
  });
});

describe('rule 9 — application creates no job request, pin, provider run or media', () => {
  it('the workspace has no new job requests after applying', async () => {
    const content = new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
    const before = (await content.listJobRequests(workspaceId)).length;
    await apply.applyTemplate(
      TEMPLATE_IDS.morningLaunch,
      { projectName: 'No jobs please' },
      'tester',
      workspaceId,
    );
    const after = (await content.listJobRequests(workspaceId)).length;
    expect(after).toBe(before);
  });
});

describe('rule 10 — scene and beat reorder keeps a valid unique order', () => {
  it('reorders scenes and keeps order contiguous', async () => {
    const scenes = await templates.listScenes(TEMPLATE_IDS.morningLaunch, workspaceId);
    const reversed = scenes.map((scene) => scene.id).reverse();
    await templates.reorderScenes(TEMPLATE_IDS.morningLaunch, reversed, workspaceId);
    const after = await templates.listScenes(TEMPLATE_IDS.morningLaunch, workspaceId);
    expect(after.map((scene) => scene.sceneOrder)).toEqual([0, 1, 2]);
    expect(after[0].title).toBe('Routine wrap-up');
  });

  it('refuses incomplete reorder payloads', async () => {
    const scenes = await templates.listScenes(TEMPLATE_IDS.morningLaunch, workspaceId);
    await expect(
      templates.reorderScenes(TEMPLATE_IDS.morningLaunch, [scenes[0].id], workspaceId),
    ).rejects.toThrow(/missing|unknown|complete/i);
  });
});

describe('rule 11 — prompt bars only save local direction text', () => {
  it('appends direction text without any provider involvement', async () => {
    const before = await templates.getTemplate(TEMPLATE_IDS.calmTutorial, workspaceId);
    const next = `${before.creativeDirection ?? ''}Slow camera, calm voice.`.trim();
    const updated = await templates.updateTemplate(
      TEMPLATE_IDS.calmTutorial,
      { creativeDirection: next },
      workspaceId,
    );
    expect(updated.creativeDirection).toContain('Slow camera, calm voice.');
    // The only mutated field is the direction text.
    expect({ ...updated, creativeDirection: null, updatedAt: before.updatedAt }).toEqual({
      ...before,
      creativeDirection: null,
      updatedAt: before.updatedAt,
    });
  });
});

describe('rule 12 — archived templates are read-only and cannot be applied', () => {
  it('refuses edits and apply while archived; restores then applies', async () => {
    await templates.archiveTemplate(TEMPLATE_IDS.calmTutorial, workspaceId);
    await expect(
      templates.updateTemplate(TEMPLATE_IDS.calmTutorial, { name: 'Renamed' }, workspaceId),
    ).rejects.toThrow(/archived and read-only/);
    await expect(
      apply.applyTemplate(TEMPLATE_IDS.calmTutorial, { projectName: 'Nope' }, 'tester', workspaceId),
    ).rejects.toThrow(/archived/);
    await expect(
      templates.createScene(
        { contentTemplateId: TEMPLATE_IDS.calmTutorial, title: 'New scene' },
        workspaceId,
      ),
    ).rejects.toThrow(/archived/);

    await templates.restoreTemplate(TEMPLATE_IDS.calmTutorial, workspaceId);
    const result = await apply.applyTemplate(
      TEMPLATE_IDS.calmTutorial,
      { projectName: 'After restore' },
      'tester',
      workspaceId,
    );
    expect(result.project.status).toBe('draft');
  });

  it('refuses invalid status transitions (active → draft)', async () => {
    await expect(
      templates.restoreTemplate(TEMPLATE_IDS.morningLaunch, workspaceId),
    ).rejects.toThrow(/cannot move from active to draft/);
  });
});

describe('rule 13 — audit events are append-only with safe metadata', () => {
  it('records created/updated/applied events with identifier-only metadata', async () => {
    const result = await apply.applyTemplate(
      TEMPLATE_IDS.morningLaunch,
      { projectName: 'Audited plan' },
      'tester',
      workspaceId,
    );
    const events = await templates.listEvents(TEMPLATE_IDS.morningLaunch, workspaceId);
    const applied = events.filter((event) => event.eventType === 'applied');
    expect(applied.length).toBe(1);
    const metadata = JSON.stringify(applied[0].metadata);
    expect(metadata).toContain(result.project.id);
    // No secrets, URLs or media paths in the audit trail.
    for (const event of events) {
      const text = JSON.stringify(event);
      expect(text).not.toMatch(/https?:\/\//);
      expect(text).not.toMatch(/secret|token|key|sign|\.mp4|\.jpg|\.png/i);
    }
  });
});

describe('rule 14 — Content Studio treats template inputs as non-binding suggestions', () => {
  it('copying a project does not create inputs from suggestions', async () => {
    const content = new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
    const result = await apply.applyTemplate(
      TEMPLATE_IDS.morningLaunch,
      { projectName: 'No silent inputs' },
      'tester',
      workspaceId,
    );
    const inputs = await content.listProjectInputs(result.project.id, workspaceId);
    expect(inputs).toEqual([]);
    // Provenance is informational only.
    expect(result.project.sourceTemplateId).toBe(TEMPLATE_IDS.morningLaunch);
  });
});

describe('template duplication', () => {
  it('copies structure and suggestions into a new draft', async () => {
    const copy = await templates.duplicateTemplate(
      TEMPLATE_IDS.morningLaunch,
      'Launch set (copy)',
      workspaceId,
    );
    expect(copy.id).not.toBe(TEMPLATE_IDS.morningLaunch);
    expect(copy.status).toBe('draft');
    const scenes = await templates.listScenes(copy.id, workspaceId);
    expect(scenes).toHaveLength(3);
    const suggestions = await templates.listSuggestions(copy.id, workspaceId);
    expect(suggestions).toHaveLength(4);
  });
});

describe('content project type helper', () => {
  it('keeps a typed project shape', async () => {
    const result = await apply.applyTemplate(
      TEMPLATE_IDS.morningLaunch,
      { projectName: 'Typed' },
      'tester',
      workspaceId,
    );
    const project: ContentProjectRecord = result.project;
    expect(project.plannedOutputType).toBe('content_set');
  });
});
