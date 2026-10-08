/**
 * Compose tab — draft-save flow over the Content Studio service boundary.
 * These cover exactly the mutations [ComposeTab.tsx] performs: prompt +
 * planned-output saving via `updateProjectDraft`, asset add/remove via
 * `addProjectInput` / `removeProjectInput`, and the draft-only edit rule the
 * footer buttons implement.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ContentStudioService } from '../../services/contentService';
import type { ContentStudioBridges } from '../../services/contentService';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import {
  getContentRepository,
  resetContentRepository,
} from '../../data/contentFactory';
import { getLibraryRepository, resetLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository, resetModelsRepository } from '../../data';
import { getEnvironmentsRepository, resetEnvironmentsRepository } from '../../data/environmentsFactory';
import { CONTENT_PROJECT_ID, SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';

let service: ContentStudioService;
let workspaceId: string;

beforeEach(() => {
  resetContentRepository();
  resetLibraryRepository();
  resetModelsRepository();
  resetEnvironmentsRepository();

  const bridges: ContentStudioBridges = {
    library: new LibraryService(getLibraryRepository()),
    models: new ModelsService(getModelsRepository()),
    environments: new EnvironmentsService(getEnvironmentsRepository()),
  };
  service = new ContentStudioService(getContentRepository(), bridges);
  workspaceId = SEED_CONTENT_WORKSPACE_ID;
});

describe('compose prompt → draft (creative direction)', () => {
  it('saves the compose prompt as creative direction on the draft', async () => {
    const prompt = 'A calm morning routine, warm window light, confident hook.';
    const updated = await service.updateProjectDraft(
      CONTENT_PROJECT_ID,
      { creativeDirection: prompt },
      workspaceId,
    );
    expect(updated.creativeDirection).toBe(prompt);
    expect((await service.getProject(CONTENT_PROJECT_ID, workspaceId)).creativeDirection).toBe(prompt);
  });

  it('clears creative direction when the prompt is emptied (ComposeTab sends null)', async () => {
    await service.updateProjectDraft(CONTENT_PROJECT_ID, { creativeDirection: null }, workspaceId);
    expect((await service.getProject(CONTENT_PROJECT_ID, workspaceId)).creativeDirection).toBeNull();
  });

  it('rejects invalid planned-output payloads (the Output format card source)', async () => {
    await expect(
      service.updateProjectDraft(CONTENT_PROJECT_ID, { plannedOutputType: 'billboard' }, workspaceId),
    ).rejects.toThrow(/Invalid project update/);
  });
});

describe('compose asset chips (add/remove via project inputs)', () => {
  it('adds a Library asset as a plan input with the exact active version', async () => {
    const library = new LibraryService(getLibraryRepository());
    const assets = await library.listAssets(workspaceId);
    const prop = assets.find(
      (asset) => ['creator_tool', 'wardrobe', 'accessory', 'product'].includes(asset.assetType)
        && asset.id !== 'lib_luma_serum',
    );
    expect(prop).toBeDefined();

    const input = await service.addProjectInput(
      {
        contentProjectId: CONTENT_PROJECT_ID,
        inputType: 'library_asset',
        libraryAssetId: prop!.id,
        libraryAssetVersionId: prop!.activeVersionId,
        role: prop!.assetType === 'product' ? 'product' : 'other',
      },
      workspaceId,
    );
    expect(input.libraryAssetId).toBe(prop!.id);
    expect(input.libraryAssetVersionId).toBe(prop!.activeVersionId);

    const inputs = await service.listProjectInputs(CONTENT_PROJECT_ID, workspaceId);
    expect(inputs.some((entry) => entry.id === input.id)).toBe(true);
  });

  it('removes an asset chip by input id', async () => {
    await service.removeProjectInput('cinput_serum_v1', workspaceId);
    const inputs = await service.listProjectInputs(CONTENT_PROJECT_ID, workspaceId);
    expect(inputs.some((entry) => entry.id === 'cinput_serum_v1')).toBe(false);
    expect(inputs).toHaveLength(3); // model, environment, look remain
  });

  it('re-adds the Look after removal, pinning the requested version', async () => {
    const library = new LibraryService(getLibraryRepository());
    const look = (await library.listAssets(workspaceId)).find((asset) => asset.assetType === 'look');
    expect(look).toBeDefined();
    const versions = await library.getVersions(look!.id, workspaceId);
    const draftVersion = versions.find((version) => version.status === 'draft');
    const chosen = draftVersion ?? versions[0]; // ComposeTab picks the requested version, drafts allowed while planning

    await service.removeProjectInput('cinput_look_v2', workspaceId);
    await service.addProjectInput(
      {
        contentProjectId: CONTENT_PROJECT_ID,
        inputType: 'look',
        libraryAssetId: look!.id,
        libraryAssetVersionId: chosen.id,
        role: 'look',
      },
      workspaceId,
    );

    const inputs = await service.listProjectInputs(CONTENT_PROJECT_ID, workspaceId);
    const lookInput = inputs.find((entry) => entry.inputType === 'look');
    expect(lookInput?.libraryAssetId).toBe(look!.id);
    expect(lookInput?.libraryAssetVersionId).toBe(chosen.id);
    expect(lookInput?.libraryAssetVersionId).not.toBe('libver_look_v2'); // swapped
  });

  it('keeps the strip honest: removing the last asset leaves an empty plan section', async () => {
    await service.removeProjectInput('cinput_serum_v1', workspaceId);
    const inputs = await service.listProjectInputs(CONTENT_PROJECT_ID, workspaceId);
    expect(inputs.filter((entry) => entry.inputType === 'library_asset')).toHaveLength(0);
  });
});

describe('draft-only editing (footer buttons disabled when not draft)', () => {
  it('refuses prompt and chip edits once the project is archived', async () => {
    await service.archiveProject(CONTENT_PROJECT_ID, workspaceId);

    await expect(
      service.updateProjectDraft(CONTENT_PROJECT_ID, { creativeDirection: 'late edit' }, workspaceId),
    ).rejects.toThrow(/cannot be structurally edited/);
    await expect(
      service.addProjectInput(
        {
          contentProjectId: CONTENT_PROJECT_ID,
          inputType: 'library_asset',
          libraryAssetId: 'lib_luma_serum',
          libraryAssetVersionId: 'libver_serum_v1',
          role: 'product',
        },
        workspaceId,
      ),
    ).rejects.toThrow(/cannot be structurally edited/);
    await expect(
      service.removeProjectInput('cinput_serum_v1', workspaceId),
    ).rejects.toThrow(/cannot be structurally edited/);
  });

  it('still resolves lock states (asset strip badges) for an archived plan', async () => {
    const resolved = await service.resolveProjectInputs(CONTENT_PROJECT_ID, workspaceId);
    expect(resolved.find((entry) => entry.input.inputType === 'model')?.versionStatus).toBe('locked');
    await service.archiveProject(CONTENT_PROJECT_ID, workspaceId);
    const resolvedAfter = await service.resolveProjectInputs(CONTENT_PROJECT_ID, workspaceId);
    expect(resolvedAfter).toHaveLength(resolved.length);
  });
});
