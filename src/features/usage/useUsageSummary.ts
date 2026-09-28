/**
 * Read-only usage lookup — "where has this reusable input been used?"
 *
 * Composes Content Studio project inputs and Gallery output provenance into
 * a lightweight historical summary for Library / Models / Environments
 * overview panels. It is a READ model only: nothing is created, edited or
 * duplicated here, and Gallery outputs stay in Gallery (linked, never copied
 * into Library records).
 */
import { useEffect, useState } from 'react';
import { ContentStudioService } from '../../services/contentService';
import { GalleryService } from '../../services/galleryService';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { getContentRepository } from '../../data/contentFactory';
import { getGalleryRepository } from '../../data/galleryFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';

export interface UsageSummary {
  /** Content plans that selected this input (canonical selection, not a copy). */
  plans: Array<{ name: string; path: string }>;
  /** Generated outputs whose prepared job pinned this input. */
  outputs: Array<{ id: string; title: string; path: string; status: string }>;
}

function pinMatches(
  pin: { pinType: string; sourceRecordId: string; resolvedDetails: Record<string, unknown> },
  kind: 'model' | 'environment' | 'library_asset' | 'look',
  recordId: string,
): boolean {
  if (kind === 'model') return pin.pinType === 'model_version' && pin.sourceRecordId === recordId;
  if (kind === 'environment') return pin.pinType === 'environment_version' && pin.sourceRecordId === recordId;
  if (kind === 'look') return pin.pinType === 'look_version' && pin.sourceRecordId === recordId;
  // Library asset: direct asset pins plus Look items resolved via a Look.
  if (pin.pinType === 'library_asset_version' && pin.sourceRecordId === recordId) return true;
  return (
    pin.pinType === 'look_version' &&
    Array.isArray(pin.resolvedDetails.lookItems) &&
    (pin.resolvedDetails.lookItems as Array<{ libraryAssetId?: string }>).some(
      (item) => item.libraryAssetId === recordId,
    )
  );
}

/**
 * Resolves usage for one canonical record. `kind` is 'model', 'environment',
 * 'library_asset' or 'look'; `recordId` is the canonical record's id.
 */
export function useUsageSummary(
  kind: 'model' | 'environment' | 'library_asset' | 'look',
  recordId: string | undefined,
): UsageSummary | null {
  const [summary, setSummary] = useState<UsageSummary | null>(null);

  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;
    (async () => {
      try {
        const content = new ContentStudioService(getContentRepository(), {
          library: new LibraryService(getLibraryRepository()),
          models: new ModelsService(getModelsRepository()),
          environments: new EnvironmentsService(getEnvironmentsRepository()),
        });
        const gallery = new GalleryService(
          getGalleryRepository(),
          content,
          SEED_LIBRARY_WORKSPACE_ID,
        );
        const workspaceId = SEED_LIBRARY_WORKSPACE_ID;

        const plans: UsageSummary['plans'] = [];
        const projects = await content.listProjects(workspaceId).catch(() => []);
        for (const project of projects) {
          const inputs = await content.listProjectInputs(project.id, workspaceId).catch(() => []);
          const matches =
            (kind === 'model' && inputs.some((input) => input.inputType === 'model' && input.modelId === recordId)) ||
            (kind === 'environment' &&
              inputs.some((input) => input.inputType === 'environment' && input.environmentId === recordId)) ||
            ((kind === 'library_asset' || kind === 'look') &&
              inputs.some(
                (input) =>
                  input.inputType === (kind === 'look' ? 'look' : 'library_asset') &&
                  input.libraryAssetId === recordId,
              ));
          if (matches) {
            plans.push({ name: project.name, path: `/content-studio/${project.id}` });
          }
        }

        const outputs: UsageSummary['outputs'] = [];
        const galleryOutputs = await gallery.listOutputs(workspaceId).catch(() => []);
        for (const output of galleryOutputs) {
          const provenance = await gallery.resolveProvenance(output.id, workspaceId).catch(() => null);
          if (!provenance) continue;
          const pinned = provenance.pins.some((pin) => pinMatches(pin, kind, recordId));
          if (pinned) {
            outputs.push({
              id: output.id,
              title: output.title,
              path: `/gallery/${output.id}`,
              status: output.status,
            });
          }
        }

        if (!cancelled) setSummary({ plans, outputs });
      } catch {
        if (!cancelled) setSummary({ plans: [], outputs: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, recordId]);

  return summary;
}

/** One-line sentence for the shared usage panels. */
export function usageSentence(summary: UsageSummary | null, noun: string): string {
  if (!summary) return '';
  const planCount = summary.plans.length;
  const outputCount = summary.outputs.length;
  if (planCount === 0 && outputCount === 0) {
    return `Not used in any content plan yet. Plans that select this ${noun} will appear here.`;
  }
  const parts: string[] = [];
  parts.push(
    planCount === 1
      ? `Selected by 1 content plan`
      : `Selected by ${planCount} content plans`,
  );
  parts.push(
    outputCount === 1
      ? `pinned by 1 generated output`
      : outputCount === 0
        ? 'no generated outputs yet'
        : `pinned by ${outputCount} generated outputs`,
  );
  return `${parts.join(', ')}.`;
}
