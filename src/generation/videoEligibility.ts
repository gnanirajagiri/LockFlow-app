/**
 * Pure video job-eligibility evaluation (Phase-1 constraints). Mirrored in
 * SQL by evaluate_video_job_eligibility; inputs are plain data so tests cover
 * every rule without a database.
 */
import type { AllowedAspectRatio, AllowedDuration } from './videoTypes';
import { ALLOWED_ASPECT_RATIOS, ALLOWED_DURATIONS } from './videoTypes';
import type { EligibilityPin, EligibilityReference, EligibilityAsset } from './eligibility';

export interface VideoEligibilityJob {
  id: string;
  status: string;
  requestedOutputType: string;
  /** Ids of scenes on this job's plan (for beat-aware association checks). */
  sceneIds?: string[];
  /** Number of beats on the selected scene, when a scene is selected. */
  beatCountForSelectedScene?: number;
}

export interface VideoQuotas {
  maxOutputsPerJob: number;
  maxJobsPerUserPerPeriod: number;
  maxJobsPerWorkspacePerPeriod: number;
  maxSecondsPerUserPerPeriod: number;
  maxSecondsPerWorkspacePerPeriod: number;
  userJobsThisPeriod: number;
  workspaceJobsThisPeriod: number;
  userSecondsThisPeriod: number;
  workspaceSecondsThisPeriod: number;
}

export interface VideoEligibilityInput {
  job: VideoEligibilityJob;
  config: {
    videoGenerationEnabled: boolean;
    videoProviderName: string;
  };
  pins: EligibilityPin[];
  references: EligibilityReference[];
  assets: Record<string, EligibilityAsset>;
  quotas: VideoQuotas;
  selection: {
    sceneId: string | null;
    beatId: string | null;
    durationSeconds: number;
    aspectRatio: string;
    outputCount: number;
  };
}

export interface VideoEligibilityResult {
  eligible: boolean;
  blocking: string[];
  secondsRequested: number;
}

export function evaluateVideoJobEligibility(input: VideoEligibilityInput): VideoEligibilityResult {
  const blocking: string[] = [];
  const { job, config, pins, references, assets, quotas, selection } = input;

  // 1) Fail-closed provider configuration.
  if (!config.videoGenerationEnabled || config.videoProviderName === 'none') {
    blocking.push('Video generation is not configured for this workspace.');
  }

  // 2) Video-compatible output type (image flow handles photo).
  if (!['video', 'story', 'content_set'].includes(job.requestedOutputType)) {
    blocking.push(`Output type ${job.requestedOutputType} is not a video-compatible output.`);
  }

  // 3) Job must be draft (retry resets a failed job first).
  if (job.status !== 'draft') {
    blocking.push(`Job status is ${job.status}; only draft jobs can be submitted.`);
  }

  // 4) Phase-1 duration contract: exactly 4, 6 or 8 seconds.
  if (!(ALLOWED_DURATIONS as readonly number[]).includes(selection.durationSeconds)) {
    blocking.push('Your requested clip duration must be 4, 6 or 8 seconds.');
  }

  // 5) Phase-1 aspect ratios.
  if (!(ALLOWED_ASPECT_RATIOS as readonly string[]).includes(selection.aspectRatio)) {
    blocking.push('Aspect ratio must be 9:16, 1:1 or 16:9.');
  }

  // 6) Output count cap.
  if (selection.outputCount < 1 || selection.outputCount > quotas.maxOutputsPerJob) {
    blocking.push(`Output count must be between 1 and ${quotas.maxOutputsPerJob}.`);
  }

  // 7) Beat-aware association: a beat requires its scene; both must belong to
  //    the plan. A scene alone is allowed (single-clip allowance).
  if (selection.beatId && !selection.sceneId) {
    blocking.push('Selecting a beat requires selecting its scene.');
  }
  if (
    selection.sceneId &&
    job.sceneIds &&
    job.sceneIds.length > 0 &&
    !job.sceneIds.includes(selection.sceneId)
  ) {
    blocking.push('The selected scene does not belong to this plan.');
  }

  // 8) Pins: at least one, all locked, references available, assets rights-ok.
  if (pins.length === 0) {
    blocking.push('The job has no pins yet — prepare it from the Review tab first.');
  }
  for (const pin of pins) {
    if (pin.resolvedDetails?.versionStatus !== 'locked') {
      if (pin.pinType === 'model') {
        blocking.push('Select a locked Model version before preparing this clip.');
      } else if (pin.pinType === 'environment') {
        blocking.push('The selected environment version is still a draft.');
      } else {
        blocking.push('A pinned library/look version is not locked.');
      }
      continue;
    }
    if (pin.pinType === 'model') {
      const bad = references.find(
        (reference) =>
          reference.uploadStatus === 'pending' ||
          reference.uploadStatus === 'failed' ||
          reference.uploadStatus === 'deleted',
      );
      if (bad) {
        blocking.push('This reference has not finished uploading.');
      }
    }
    if (pin.pinType === 'library_asset' || pin.pinType === 'look') {
      const asset = assets[pin.sourceRecordId];
      if (asset) {
        if (asset.status === 'archived') {
          blocking.push(`Library asset "${asset.id}" is archived and cannot be used for clips.`);
        }
        if (asset.rightsStatus !== 'confirmed') {
          blocking.push('A pinned library asset has unknown or restricted rights.');
        }
      }
    }
  }

  // 9) Separate video quotas: jobs AND total seconds, both scopes.
  const secondsRequested = selection.durationSeconds * selection.outputCount;
  if (quotas.userJobsThisPeriod + 1 > quotas.maxJobsPerUserPerPeriod) {
    blocking.push('Your video allowance has been reached.');
  }
  if (quotas.userSecondsThisPeriod + secondsRequested > quotas.maxSecondsPerUserPerPeriod) {
    blocking.push('Your requested clip seconds exceed your remaining video allowance.');
  }
  if (quotas.workspaceJobsThisPeriod + 1 > quotas.maxJobsPerWorkspacePerPeriod) {
    blocking.push('Your workspace video allowance has been reached.');
  }
  if (quotas.workspaceSecondsThisPeriod + secondsRequested > quotas.maxSecondsPerWorkspacePerPeriod) {
    blocking.push('Your workspace requested seconds exceed the remaining video allowance.');
  }

  return { eligible: blocking.length === 0, blocking, secondsRequested };
}

/** Narrow helper for validating raw UI selection values. */
export function isAllowedDuration(value: number): value is AllowedDuration {
  return (ALLOWED_DURATIONS as readonly number[]).includes(value);
}

export function isAllowedAspectRatio(value: string): value is AllowedAspectRatio {
  return (ALLOWED_ASPECT_RATIOS as readonly string[]).includes(value);
}
