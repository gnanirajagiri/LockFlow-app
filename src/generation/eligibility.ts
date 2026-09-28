/**
 * Pure job-eligibility evaluation for image generation (spec flow step 2).
 *
 * One function, three call sites: the GenerationService pre-check (both mock
 * and Supabase mode), the UI readiness checklist, and — mirrored in SQL — the
 * authoritative security-definer RPC. Inputs are plain data so tests cover
 * every rule without a database.
 *
 * Rules enforced here (all re-verified server-side in real mode):
 *   * provider enabled + configured (fail closed)
 *   * job is draft and image-compatible (photo / content_set)
 *   * every pin resolves to a LOCKED version
 *   * model pins require identity references that are uploaded + rights-confirmed
 *   * library/look pins require rights-confirmed assets that are not archived
 *   * requested outputs within the per-job cap; quotas not exceeded
 *   * no completed outputs on a completed job (nothing to regenerate)
 */
export interface EligibilityPin {
  pinType: 'model' | 'environment' | 'library_asset' | 'look';
  sourceRecordId: string;
  sourceVersionId: string;
  resolvedDetails: {
    versionStatus?: string;
    versionNumber?: number;
    assetName?: string;
    modelName?: string;
    environmentName?: string;
    resolvedVia?: string;
  };
}

export interface EligibilityReference {
  referenceId: string;
  uploadStatus: 'pending' | 'uploaded' | 'failed' | 'deleted' | string;
  rightsStatus?: 'unknown' | 'confirmed' | 'restricted' | string;
  assetRightsStatus?: 'unknown' | 'confirmed' | 'restricted' | string;
}

export interface EligibilityJob {
  id: string;
  status: string;
  requestedOutputType: string;
  requestedVariants: number;
}

export interface EligibilityAsset {
  id: string;
  status: string;
  rightsStatus: 'unknown' | 'confirmed' | 'restricted' | string;
}

export interface EligibilityQuotas {
  maxOutputsPerJob: number;
  maxJobsPerUserPerPeriod: number;
  maxJobsPerWorkspacePerPeriod: number;
  userJobsThisPeriod: number;
  workspaceJobsThisPeriod: number;
}

export interface EligibilityInput {
  job: EligibilityJob;
  config: {
    imageGenerationEnabled: boolean;
    providerName: string;
  };
  pins: EligibilityPin[];
  /** References that belong to the pinned versions (exact version match only). */
  references: EligibilityReference[];
  /** Library assets referenced by the pins (for archived/rights checks). */
  assets: Record<string, EligibilityAsset>;
  quotas: EligibilityQuotas;
  completedOutputsForJob?: number;
}

export interface EligibilityResult {
  eligible: boolean;
  blocking: string[];
  outputsRequested: number;
}

export function evaluateImageJobEligibility(input: EligibilityInput): EligibilityResult {
  const blocking: string[] = [];
  const { job, config, pins, references, assets, quotas } = input;

  // 1) Fail-closed provider configuration.
  if (!config.imageGenerationEnabled || config.providerName === 'none') {
    blocking.push('Image generation is not enabled for this deployment (provider not configured).');
  }

  // 2) Job state.
  if (job.status !== 'draft') {
    blocking.push(`Job status is ${job.status}; only draft jobs can be submitted.`);
  }

  // 3) Image-compatible output request.
  if (job.requestedOutputType !== 'photo' && job.requestedOutputType !== 'content_set') {
    blocking.push(`Output type ${job.requestedOutputType} is not image-compatible in this milestone.`);
  }

  // 4) Pins exist and every pinned version is locked.
  if (pins.length === 0) {
    blocking.push('The job has no pins yet — prepare it from the Review tab first.');
  }
  for (const pin of pins) {
    const status = pin.resolvedDetails?.versionStatus;
    if (status !== 'locked') {
      blocking.push(
        `Pinned ${pin.pinType.replace('_', ' ')} version is ${status ?? 'of unknown status'}; all pins must be locked versions.`,
      );
      continue;
    }

    // 5) Reference availability for model pins: uploads marked pending,
    //    failed or deleted block the job (rule: never submit unavailable
    //    references). Legacy metadata-only placeholder rows are simply
    //    excluded from the provider payload by the resolver.
    if (pin.pinType === 'model') {
      const bad = references.find(
        (reference) =>
          reference.uploadStatus === 'pending' ||
          reference.uploadStatus === 'failed' ||
          reference.uploadStatus === 'deleted',
      );
      if (bad) {
        blocking.push('A model reference upload is pending, failed or removed.');
      }
    }

    // 6) Library/look assets: rights + not archived.
    if (pin.pinType === 'library_asset' || pin.pinType === 'look') {
      const asset = assets[pin.sourceRecordId];
      if (!asset) {
        blocking.push('A pinned library asset could not be resolved.');
      } else {
        if (asset.status === 'archived') {
          blocking.push(`Library asset "${asset.id}" is archived and cannot be used for generation.`);
        }
        if (asset.rightsStatus !== 'confirmed') {
          blocking.push('A pinned library asset has unknown or restricted rights.');
        }
      }
    }
  }

  // 8) Quota guards (server-side authoritative in real mode).
  if (job.requestedVariants > quotas.maxOutputsPerJob) {
    blocking.push(
      `Requested ${job.requestedVariants} outputs exceeds the per-job limit of ${quotas.maxOutputsPerJob}.`,
    );
  }
  if (quotas.userJobsThisPeriod + 1 > quotas.maxJobsPerUserPerPeriod) {
    blocking.push('User generation allowance for this period is exhausted.');
  }
  if (quotas.workspaceJobsThisPeriod + 1 > quotas.maxJobsPerWorkspacePerPeriod) {
    blocking.push('Workspace generation allowance for this period is exhausted.');
  }

  // 9) Nothing to regenerate on an already-completed job with outputs.
  if (job.status === 'completed' && (input.completedOutputsForJob ?? 0) > 0) {
    blocking.push('This job already completed with outputs; retry applies only to failed runs.');
  }

  return {
    eligible: blocking.length === 0,
    blocking,
    outputsRequested: job.requestedVariants,
  };
}
