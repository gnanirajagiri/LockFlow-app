/**
 * Campaigns domain — validation schemas.
 *
 * Dependency-free `ValidationResult<T>` validators (no zod), mirroring the
 * Content Studio / Templates conventions. All copy is fictional-safe; no
 * provider, OAuth or media fields exist to validate.
 */
import type {
  CampaignChannelIntent,
  CampaignChannelKey,
  CampaignEventRecord,
  CampaignItemFormat,
  CampaignItemStatus,
  CreateCampaignChannelInput,
  CreateCampaignInput,
  CreateCampaignItemInput,
  CreateCampaignItemVariantInput,
  UpdateCampaignChannelInput,
  UpdateCampaignInput,
  UpdateCampaignItemInput,
  UpdateCampaignItemVariantInput,
} from './types';
import { planningDateProblem } from './guards';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, errors: [error] };
}

const CHANNEL_KEYS: CampaignChannelKey[] = [
  'instagram', 'tiktok', 'youtube', 'facebook', 'linkedin', 'x', 'pinterest',
  'website', 'email', 'paid_social', 'other',
];

const INTENTS: CampaignChannelIntent[] = ['organic', 'paid', 'both'];

const ITEM_FORMATS: CampaignItemFormat[] = [
  'feed_post', 'story', 'reel', 'short_video', 'ad_creative', 'website', 'email', 'other',
];

const ITEM_STATUSES: CampaignItemStatus[] = ['planned', 'ready', 'blocked', 'removed'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) return undefined;
  return trimmed;
}

/** Minimal audit-safe metadata shape: flat string/number/boolean values only. */
function safeMetadata(value: unknown): Record<string, string | number | boolean> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/** Audit events are append-only and carry minimal, safe metadata. */
export function sanitizeEventMetadata(
  event: Omit<CampaignEventRecord, 'id' | 'createdAt'>,
): Omit<CampaignEventRecord, 'id' | 'createdAt'> {
  return { ...event, metadata: safeMetadata(event.metadata) ?? {} };
}

export function validateCreateCampaign(input: unknown): ValidationResult<CreateCampaignInput> {
  if (!input || typeof input !== 'object') return fail('Body must be an object.');
  const v = input as Record<string, unknown>;

  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (name.length < 1 || name.length > 120) return fail('name must be 1–120 characters');

  const workspaceId = typeof v.workspaceId === 'string' && v.workspaceId.trim() !== ''
    ? v.workspaceId.trim()
    : undefined;
  if (!workspaceId) return fail('workspaceId is required');

  const startDate = optionalText(v.startDate, 10);
  if (startDate !== undefined && startDate !== null && !DATE_RE.test(startDate)) {
    return fail('startDate must be a YYYY-MM-DD date');
  }
  const endDate = optionalText(v.endDate, 10);
  if (endDate !== undefined && endDate !== null && !DATE_RE.test(endDate)) {
    return fail('endDate must be a YYYY-MM-DD date');
  }
  const dateProblem = planningDateProblem(startDate ?? null, endDate ?? null);
  if (dateProblem) return fail(dateProblem);

  return ok({
    workspaceId,
    name,
    description: optionalText(v.description, 600) ?? undefined,
    objective: optionalText(v.objective, 600) ?? undefined,
    audience: optionalText(v.audience, 400) ?? undefined,
    keyMessage: optionalText(v.keyMessage, 400) ?? undefined,
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined,
  });
}

export function validateUpdateCampaign(input: unknown): ValidationResult<UpdateCampaignInput> {
  if (!input || typeof input !== 'object') return fail('Body must be an object.');
  const v = input as Record<string, unknown>;

  const out: UpdateCampaignInput = {};
  if (v.name !== undefined) {
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    if (name.length < 1 || name.length > 120) return fail('name must be 1–120 characters');
    out.name = name;
  }
  const startDate = optionalText(v.startDate, 10);
  if (startDate !== undefined && startDate !== null && !DATE_RE.test(startDate)) {
    return fail('startDate must be a YYYY-MM-DD date');
  }
  const endDate = optionalText(v.endDate, 10);
  if (endDate !== undefined && endDate !== null && !DATE_RE.test(endDate)) {
    return fail('endDate must be a YYYY-MM-DD date');
  }
  const dateProblem = planningDateProblem(startDate ?? null, endDate ?? null);
  if (dateProblem) return fail(dateProblem);

  out.startDate = startDate;
  out.endDate = endDate;
  out.description = optionalText(v.description, 600);
  out.objective = optionalText(v.objective, 600);
  out.audience = optionalText(v.audience, 400);
  out.keyMessage = optionalText(v.keyMessage, 400);
  return ok(out);
}

export function validateCreateCampaignChannel(
  input: unknown,
): ValidationResult<CreateCampaignChannelInput> {
  if (!input || typeof input !== 'object') return fail('Body must be an object.');
  const v = input as Record<string, unknown>;

  const campaignId = typeof v.campaignId === 'string' && v.campaignId.trim() !== ''
    ? v.campaignId.trim()
    : undefined;
  if (!campaignId) return fail('campaignId is required');
  if (!CHANNEL_KEYS.includes(v.channel as CampaignChannelKey)) {
    return fail('channel is not a recognised planning channel');
  }
  if (!INTENTS.includes(v.intent as CampaignChannelIntent)) {
    return fail('intent must be organic, paid or both');
  }

  const notes = optionalText(v.notes, 400);
  return ok({
    campaignId,
    channel: v.channel as CampaignChannelKey,
    intent: v.intent as CampaignChannelIntent,
    ...(notes !== undefined ? { notes: notes ?? undefined } : {}),
  });
}

export function validateUpdateCampaignChannel(
  input: unknown,
): ValidationResult<UpdateCampaignChannelInput> {
  if (!input || typeof input !== 'object') return fail('Body must be an object.');
  const v = input as Record<string, unknown>;
  if (v.intent !== undefined && !INTENTS.includes(v.intent as CampaignChannelIntent)) {
    return fail('intent must be organic, paid or both');
  }
  const out: UpdateCampaignChannelInput = {};
  if (v.intent !== undefined) out.intent = v.intent as CampaignChannelIntent;
  const notes = optionalText(v.notes, 400);
  if (notes !== undefined) out.notes = notes;
  return ok(out);
}

export function validateCreateCampaignItem(
  input: unknown,
): ValidationResult<CreateCampaignItemInput> {
  if (!input || typeof input !== 'object') return fail('Body must be an object.');
  const v = input as Record<string, unknown>;

  const campaignId = typeof v.campaignId === 'string' && v.campaignId.trim() !== ''
    ? v.campaignId.trim()
    : undefined;
  if (!campaignId) return fail('campaignId is required');

  const galleryOutputId = typeof v.galleryOutputId === 'string' && v.galleryOutputId.trim() !== ''
    ? v.galleryOutputId.trim()
    : undefined;
  if (!galleryOutputId) return fail('galleryOutputId is required');

  if (v.plannedChannel !== undefined && v.plannedChannel !== null) {
    if (typeof v.plannedChannel !== 'string' || v.plannedChannel.trim() === '') {
      return fail('plannedChannel must be a channel key');
    }
  }
  if (
    v.plannedFormat !== undefined &&
    v.plannedFormat !== null &&
    !ITEM_FORMATS.includes(v.plannedFormat as CampaignItemFormat)
  ) {
    return fail('plannedFormat is not a recognised format');
  }
  if (v.plannedPublishAt !== undefined && v.plannedPublishAt !== null) {
    if (typeof v.plannedPublishAt !== 'string' || Number.isNaN(Date.parse(v.plannedPublishAt))) {
      return fail('plannedPublishAt must be an ISO date-time');
    }
  }

  return ok({
    campaignId,
    galleryOutputId,
    plannedChannel:
      v.plannedChannel === undefined || v.plannedChannel === null
        ? null
        : (v.plannedChannel as string).trim(),
    plannedFormat:
      v.plannedFormat === undefined || v.plannedFormat === null
        ? null
        : (v.plannedFormat as CampaignItemFormat),
    plannedPublishAt:
      v.plannedPublishAt === undefined || v.plannedPublishAt === null
        ? null
        : (v.plannedPublishAt as string),
    captionDraft: optionalText(v.captionDraft, 2200) ?? undefined,
    callToAction: optionalText(v.callToAction, 200) ?? undefined,
    notes: optionalText(v.notes, 1000) ?? undefined,
  });
}

export function validateUpdateCampaignItem(
  input: unknown,
): ValidationResult<UpdateCampaignItemInput> {
  if (!input || typeof input !== 'object') return fail('Body must be an object.');
  const v = input as Record<string, unknown>;

  const out: UpdateCampaignItemInput = {};
  if (v.status !== undefined) {
    if (!ITEM_STATUSES.includes(v.status as CampaignItemStatus)) {
      return fail('status is not a recognised item status');
    }
    out.status = v.status as CampaignItemStatus;
  }
  if (v.plannedChannel !== undefined) {
    if (v.plannedChannel !== null && (typeof v.plannedChannel !== 'string' || v.plannedChannel.trim() === '')) {
      return fail('plannedChannel must be a channel key or null');
    }
    out.plannedChannel = v.plannedChannel === null ? null : (v.plannedChannel as string).trim();
  }
  if (v.plannedFormat !== undefined) {
    if (v.plannedFormat !== null && !ITEM_FORMATS.includes(v.plannedFormat as CampaignItemFormat)) {
      return fail('plannedFormat is not a recognised format');
    }
    out.plannedFormat = v.plannedFormat as CampaignItemFormat | null;
  }
  if (v.plannedPublishAt !== undefined) {
    if (
      v.plannedPublishAt !== null &&
      (typeof v.plannedPublishAt !== 'string' || Number.isNaN(Date.parse(v.plannedPublishAt)))
    ) {
      return fail('plannedPublishAt must be an ISO date-time or null');
    }
    out.plannedPublishAt = v.plannedPublishAt as string | null;
  }
  out.captionDraft = optionalText(v.captionDraft, 2200);
  out.callToAction = optionalText(v.callToAction, 200);
  out.notes = optionalText(v.notes, 1000);
  return ok(out);
}

export function validateCreateItemVariant(
  input: unknown,
): ValidationResult<CreateCampaignItemVariantInput> {
  if (!input || typeof input !== 'object') return fail('Body must be an object.');
  const v = input as Record<string, unknown>;

  const label = typeof v.label === 'string' ? v.label.trim() : '';
  if (label.length < 1 || label.length > 120) return fail('label must be 1–120 characters');

  if (
    v.formatOverride !== undefined &&
    v.formatOverride !== null &&
    !ITEM_FORMATS.includes(v.formatOverride as CampaignItemFormat)
  ) {
    return fail('formatOverride is not a recognised format');
  }

  return ok({
    label,
    captionDraft: optionalText(v.captionDraft, 2200) ?? undefined,
    callToAction: optionalText(v.callToAction, 200) ?? undefined,
    formatOverride: v.formatOverride === undefined ? undefined : (v.formatOverride as CampaignItemFormat | null),
    plannedChannelOverride:
      v.plannedChannelOverride === undefined || v.plannedChannelOverride === null
        ? undefined
        : (v.plannedChannelOverride as string).trim() || null,
    notes: optionalText(v.notes, 1000) ?? undefined,
  });
}

export function validateUpdateItemVariant(
  input: unknown,
): ValidationResult<UpdateCampaignItemVariantInput> {
  if (!input || typeof input !== 'object') return fail('Body must be an object.');
  const v = input as Record<string, unknown>;

  const out: UpdateCampaignItemVariantInput = {};
  if (v.label !== undefined) {
    const label = typeof v.label === 'string' ? v.label.trim() : '';
    if (label.length < 1 || label.length > 120) return fail('label must be 1–120 characters');
    out.label = label;
  }
  if (
    v.formatOverride !== undefined &&
    v.formatOverride !== null &&
    !ITEM_FORMATS.includes(v.formatOverride as CampaignItemFormat)
  ) {
    return fail('formatOverride is not a recognised format');
  }
  out.captionDraft = optionalText(v.captionDraft, 2200);
  out.callToAction = optionalText(v.callToAction, 200);
  out.notes = optionalText(v.notes, 1000);
  if (v.formatOverride !== undefined) out.formatOverride = v.formatOverride as CampaignItemFormat | null;
  if (v.plannedChannelOverride !== undefined) {
    out.plannedChannelOverride =
      v.plannedChannelOverride === null
        ? null
        : (v.plannedChannelOverride as string).trim() || null;
  }
  return ok(out);
}

/** Reorder payloads: every current id, exactly once, in the new order. */
export function validateReorder(input: unknown, currentIds: string[]): ValidationResult<string[]> {
  if (!Array.isArray(input)) return fail('Order must be an array of ids.');
  if (input.length !== currentIds.length || new Set(input).size !== currentIds.length) {
    return fail('Order must contain every current id exactly once.');
  }
  for (const id of input) {
    if (typeof id !== 'string' || !currentIds.includes(id)) {
      return fail('Order must contain every current id exactly once.');
    }
  }
  return ok(input as string[]);
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base === '' ? 'campaign' : base;
}
