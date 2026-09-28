/**
 * Shared reference-media service — the ONLY storage-aware application module.
 *
 * All three reference surfaces (Model, Environment, Library) go through this
 * one service; no UI component calls Supabase Storage directly. Flow:
 *
 *   1. uploadReference  → client-side preflight (magic bytes, size, dimension
 *                          decode) → RPC begin_reference_upload (server-side
 *                          membership/draft/rights/mime/size validation,
 *                          PENDING reference + upload_requested audit) →
 *                          direct upload to the single signed path →
 *                          RPC complete_reference_upload (uploaded + audit).
 *   2. createViewUrl    → access check + audit via RPC, short-lived signed
 *                          URL, cached and transparently refreshed on expiry.
 *   3. softDeleteReference → draft-only soft delete via RPC (locked versions
 *                          are protected by the DB; records are never
 *                          hard-deleted).
 *
 * Demo mode (no Supabase configured) is a development convenience: uploads
 * are unavailable and the UI says so honestly — placeholders keep working.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/supabase';
import { REFERENCES_BUCKET } from './storagePaths';
import type { ReferenceTargetType } from './storagePaths';
import {
  readFileHead,
  readImageDimensions,
  validateDimensions,
  validateFileMetadata,
} from './validateUpload';

/** Signed-URL lifetime in seconds (10 minutes, per spec). */
export const SIGNED_URL_EXPIRY_SECONDS = 600;

export type UploadStage = 'validating' | 'requesting' | 'transferring' | 'complete';

export interface UploadIntentInput {
  targetType: ReferenceTargetType;
  /** The draft version receiving the upload. */
  versionId: string;
  /** Domain enum value for the surface (validated again by the RPC). */
  referenceType: string;
  caption?: string;
  file: File;
  /** Must be true — enforced here AND by the server RPC (defence in depth). */
  rightsConfirmed: boolean;
}

export interface CompletedUpload {
  referenceId: string;
  width: number | null;
  height: number | null;
}

export class DemoModeError extends Error {
  constructor() {
    super('Uploads require a configured Supabase project (demo mode has no storage).');
    this.name = 'DemoModeError';
  }
}

function requireClient(): SupabaseClient {
  const client = getSupabase();
  if (!client) throw new DemoModeError();
  return client;
}

/** Maps RPC/storage failures to the human-readable messages users see. */
export function describeMediaError(error: unknown): string {
  if (error instanceof DemoModeError) return error.message;
  if (error instanceof Error) {
    // PostgREST surfaces raise-exception messages directly.
    if (error.message.includes('rights acknowledgement')) {
      return 'Confirm the rights acknowledgement before uploading.';
    }
    if (error.message.includes('locked version')) {
      return 'References are protected in this locked version. Create a new draft version to make changes.';
    }
    return error.message;
  }
  return 'Something went wrong with the upload.';
}

interface UploadIntentRpcRow {
  reference_id: string;
  bucket: string;
  upload_path: string;
}

export class ReferencesMediaService {
  private viewUrlCache = new Map<string, { url: string; expiresAt: number }>();

  /** Full upload flow; reports stage transitions for the UI progress row. */
  async uploadReference(
    input: UploadIntentInput,
    options?: { onStageChange?: (stage: UploadStage) => void },
  ): Promise<CompletedUpload> {
    const client = requireClient();
    const onStageChange = options?.onStageChange;

    // 0) Rights acknowledgement is mandatory before any upload intent exists.
    if (!input.rightsConfirmed) {
      throw new Error('Confirm the rights acknowledgement before uploading.');
    }

    // 1) Client-side preflight — file signature, size, then dimensions.
    onStageChange?.('validating');
    const head = await readFileHead(input.file);
    const meta = validateFileMetadata(
      { name: input.file.name, size: input.file.size, type: input.file.type },
      head,
    );
    const dimensions = await readImageDimensions(input.file);
    // Dimensions are validated only when the environment can actually decode
    // (real browsers); node/test environments record nothing rather than
    // inventing a validation result. The RPC stores them as nullable.
    if (dimensions) validateDimensions(dimensions);

    // 2) Server intent — re-validates membership, draft status, rights,
    //    mime and size authoritatively; creates the pending reference row.
    onStageChange?.('requesting');
    const { data: intentData, error: intentError } = await client
      .rpc('begin_reference_upload', {
        p_target_type: input.targetType,
        p_version_id: input.versionId,
        p_reference_type: input.referenceType,
        p_caption: input.caption ?? '',
        p_original_filename: input.file.name,
        p_mime_type: meta.sniffedMime,
        p_file_size: input.file.size,
        p_rights_confirmed: true, // the dialog refuses to submit without the checkbox
      })
      .single<UploadIntentRpcRow>();
    if (intentError) throw intentError;
    const intent = {
      referenceId: intentData.reference_id,
      bucket: intentData.bucket,
      uploadPath: intentData.upload_path,
    };

    // 3) Direct upload to the one signed, path-scoped upload URL.
    onStageChange?.('transferring');
    try {
      const { data: signed, error: signedError } = await client.storage
        .from(intent.bucket)
        .createSignedUploadUrl(intent.uploadPath);
      if (signedError || !signed) {
        throw signedError ?? new Error('Could not create the signed upload URL.');
      }
      const { error: uploadError } = await client.storage
        .from(intent.bucket)
        .uploadToSignedUrl(intent.uploadPath, signed.token, input.file, {
          contentType: meta.sniffedMime,
        });
      if (uploadError) throw uploadError;
    } catch (error) {
      // Mark the pending row failed (best effort) and rethrow for the UI.
      await this.failUpload(intent.referenceId, input.targetType, error).catch(() => undefined);
      throw error;
    }

    // 4) Completion — flips pending → uploaded and records the dimensions.
    onStageChange?.('complete');
    const { error: completeError } = await client.rpc('complete_reference_upload', {
      p_reference_id: intent.referenceId,
      p_target_type: input.targetType,
      p_width: dimensions?.width ?? null,
      p_height: dimensions?.height ?? null,
    });
    if (completeError) throw completeError;

    return { referenceId: intent.referenceId, width: dimensions?.width ?? null, height: dimensions?.height ?? null };
  }

  /**
   * Marks a pending upload failed (audit-trailed). The upload loop calls this
   * automatically when the transfer fails; retry starts a fresh intent.
   */
  async failUpload(referenceId: string, targetType: ReferenceTargetType, cause: unknown): Promise<void> {
    const client = requireClient();
    const { error } = await client.rpc('fail_reference_upload', {
      p_reference_id: referenceId,
      p_target_type: targetType,
      p_reason: cause instanceof Error ? cause.message.slice(0, 300) : 'transfer failed',
    });
    if (error) throw error;
  }

  /**
   * Soft-deletes a draft reference (audit-trailed). Locked versions are
   * protected by the DB guards; the record itself is never hard-deleted.
   */
  async softDeleteReference(referenceId: string, targetType: ReferenceTargetType): Promise<void> {
    const client = requireClient();
    const { error } = await client.rpc('soft_delete_reference', {
      p_reference_id: referenceId,
      p_target_type: targetType,
    });
    if (error) throw error;
  }

  /**
   * Signed view URL for a reference the member can read. Audits the access,
   * caches by reference id, and transparently re-signs before expiry.
   */
  async createViewUrl(referenceId: string, targetType: ReferenceTargetType): Promise<string> {
    const client = requireClient();

    const cached = this.viewUrlCache.get(referenceId);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.url;

    // Access check + audit trail happen server-side in one RPC call; the URL
    // itself is never persisted anywhere.
    const { error: auditError } = await client.rpc('log_signed_url_access', {
      p_reference_id: referenceId,
      p_target_type: targetType,
    });
    if (auditError) throw auditError;

    const path = await this.resolveStoragePath(referenceId, targetType);
    const { data, error } = await client.storage
      .from(REFERENCES_BUCKET)
      .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
    if (error || !data) throw error ?? new Error('Could not create the signed view URL.');

    this.viewUrlCache.set(referenceId, {
      url: data.signedUrl,
      expiresAt: Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000,
    });
    return data.signedUrl;
  }

  /** Reads the object path from the reference row (member-visible via RLS). */
  private async resolveStoragePath(referenceId: string, targetType: ReferenceTargetType): Promise<string> {
    const client = requireClient();
    const table =
      targetType === 'model_reference'
        ? 'model_references'
        : targetType === 'environment_reference'
          ? 'environment_references'
          : 'library_asset_references';
    const { data, error } = await client
      .from(table)
      .select('storage_path, storage_bucket, upload_status')
      .eq('id', referenceId)
      .single<{ storage_path: string; storage_bucket: string | null; upload_status: string }>();
    if (error) throw error; // RLS hides foreign workspaces — surface as failure
    if (data.upload_status !== 'uploaded') {
      throw new Error('This reference has no uploaded file yet.');
    }
    void data.storage_bucket; // bucket is fixed for references in this milestone
    return data.storage_path;
  }
}
