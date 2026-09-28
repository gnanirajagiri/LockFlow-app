/**
 * Quality domain — provenance snapshot builder.
 *
 * Builds the minimal immutable read models for reviews and correction
 * requests from an output's HISTORICAL provenance (its job's pins and frozen
 * run/output snapshots). Never reads live source versions, never includes
 * signed URLs, secrets, provider payloads or media bytes.
 *
 * Shapes produced:
 *   * expectedContext — per-finding minimal context from pins (name + exact
 *     version + status; scene/beat snapshots for video/story outputs).
 *   * pinSnapshot     — the exact pinned versions (pinType, ids, label,
 *     version number, role, resolvedVia).
 *   * sourceSnapshot  — the parent output/job/project identity plus frozen
 *     scene/beat snapshots where available.
 */
import type { PinProjection, QualityFindingCategory } from './types';
import type { ContentJobPinRecord } from '../domain/content';

export interface ProvenancePinsInput {
  job: {
    id: string;
    name: string;
    contentProjectId: string | null;
    requestedOutputType: string;
  };
  project: { id: string; name: string } | null;
  pins: ContentJobPinRecord[];
  /** Frozen scene/beat snapshots embedded by the video ingestion path. */
  outputMetadata: Record<string, unknown>;
  output: {
    id: string;
    title: string;
    outputType: string;
    outputIndex: number;
    contentSceneId?: string | null;
    contentBeatId?: string | null;
  };
}

function labelForPin(pin: ContentJobPinRecord): string {
  const details = pin.resolvedDetails as Record<string, unknown>;
  const name =
    (details.modelName as string | undefined) ??
    (details.environmentName as string | undefined) ??
    (details.assetName as string | undefined) ??
    pin.sourceRecordId;
  const versionNumber = details.versionNumber as number | undefined;
  return `${name}${versionNumber != null ? ` v${versionNumber}` : ''}`;
}

/** Projects immutable pins into the minimal shape used everywhere downstream. */
export function projectPins(pins: ContentJobPinRecord[]): PinProjection[] {
  return pins.map((pin) => {
    const details = pin.resolvedDetails as Record<string, unknown>;
    return {
      pinType: pin.pinType,
      sourceRecordId: pin.sourceRecordId,
      sourceVersionId: pin.sourceVersionId,
      label: labelForPin(pin),
      versionNumber: (details.versionNumber as number | undefined) ?? null,
      role: pin.role ?? null,
      resolvedVia: (details.resolvedVia as string | undefined) ?? null,
    };
  });
}

function frozenSceneBeat(metadata: Record<string, unknown>): {
  sceneSnapshot: Record<string, unknown> | null;
  beatSnapshot: Record<string, unknown> | null;
} {
  const isVideo = metadata.generation_kind === 'video';
  const sceneSnapshot = (metadata.scene_snapshot as Record<string, unknown> | undefined) ?? null;
  const beatSnapshot = (metadata.beat_snapshot as Record<string, unknown> | undefined) ?? null;
  return { sceneSnapshot, beatSnapshot: isVideo ? beatSnapshot : beatSnapshot };
}

/** Minimal expected-context for one finding category. */
export function buildExpectedContext(
  category: QualityFindingCategory,
  input: ProvenancePinsInput,
): Record<string, unknown> {
  const pins = projectPins(input.pins);
  const { sceneSnapshot, beatSnapshot } = frozenSceneBeat(input.outputMetadata);
  const relevant = pins.filter((pin) => {
    switch (category) {
      case 'model_identity':
      case 'face':
      case 'hairstyle':
      case 'skin_tone':
      case 'body_proportions':
        return pin.pinType === 'model_version';
      case 'environment_layout':
      case 'furniture_anchor':
      case 'lighting':
        return pin.pinType === 'environment_version';
      case 'wardrobe':
      case 'accessory':
      case 'product':
      case 'prop':
      case 'palette_material':
        return pin.pinType === 'library_asset_version' || pin.pinType === 'look_version';
      default:
        return false;
    }
  });

  const context: Record<string, unknown> = {
    captured_from: 'job_pins',
    job_id: input.job.id,
    job_name: input.job.name,
    pinned_versions: relevant.map((pin) => ({
      pin_type: pin.pinType,
      source_record_id: pin.sourceRecordId,
      source_version_id: pin.sourceVersionId,
      label: pin.label,
      version_number: pin.versionNumber,
      version_status: 'locked',
      resolved_via: pin.resolvedVia,
    })),
  };
  if (sceneSnapshot) context.scene_snapshot = sceneSnapshot;
  if (beatSnapshot) context.beat_snapshot = beatSnapshot;
  return context;
}

/** Full pin snapshot (exact versions only — never live source rows). */
export function buildPinSnapshot(pins: ContentJobPinRecord[]): Record<string, unknown> {
  return {
    captured_from: 'job_pins',
    pinned_at: new Date().toISOString(),
    pins: pins.map((pin) => {
      const details = pin.resolvedDetails as Record<string, unknown>;
      return {
        pin_type: pin.pinType,
        source_record_id: pin.sourceRecordId,
        source_version_id: pin.sourceVersionId,
        label: labelForPin(pin),
        version_number: (details.versionNumber as number | undefined) ?? null,
        version_status: (details.versionStatus as string | undefined) ?? null,
        locked_at: (details.lockedAt as string | undefined) ?? null,
        role: pin.role,
        resolved_via: (details.resolvedVia as string | undefined) ?? null,
      };
    }),
  };
}

/**
 * Source snapshot: the parent output/job/project identity plus frozen
 * scene/beat snapshots. Contains ids, names and short text notes only.
 */
export function buildSourceSnapshot(input: ProvenancePinsInput): Record<string, unknown> {
  const { sceneSnapshot, beatSnapshot } = frozenSceneBeat(input.outputMetadata);
  return {
    captured_at: new Date().toISOString(),
    gallery_output: {
      id: input.output.id,
      title: input.output.title,
      output_type: input.output.outputType,
      output_index: input.output.outputIndex,
    },
    content_job_request: {
      id: input.job.id,
      name: input.job.name,
      requested_output_type: input.job.requestedOutputType,
    },
    content_project: input.project ? { id: input.project.id, name: input.project.name } : null,
    content_scene_id: input.output.contentSceneId ?? null,
    content_beat_id: input.output.contentBeatId ?? null,
    scene_snapshot: sceneSnapshot,
    beat_snapshot: beatSnapshot,
  };
}
