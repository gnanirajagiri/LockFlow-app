/**
 * Library asset storage — the signed-URL upload pipeline.
 *
 * Follows the ReferencesMediaService pattern: one signed upload path per
 * intent (server RPC `begin_library_file_upload` returns bucket + path),
 * direct transfer via `uploadToSignedUrl`, then server completion via
 * `complete_library_file_upload`. Paths follow the canonical workspace
 * convention so the reference-upload storage RLS authorizes them:
 *
 *   workspaces/{workspaceId}/library-assets/{assetId}/{fileId}/{safeName}
 *
 * Demo mode (no Supabase configured) is honest: uploads are unavailable
 * and the error says so — the safe file reference stays 'pending'.
 */
import { getSupabase } from '../lib/supabase';
import { DemoModeError, describeMediaError } from '../features/media/referencesMediaService';
import {
  readFileHead,
  validateFileMetadata,
} from '../features/media/validateUpload';

export { DemoModeError, describeMediaError };

export type LibraryUploadStage = 'validating' | 'requesting' | 'transferring' | 'complete';

interface BeginUploadRpcRow {
  file_id: string;
  bucket: string;
  upload_path: string;
}

export interface LibraryUploadResult {
  fileId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
}

export interface UploadLibraryAssetFileInput {
  workspaceId: string;
  assetId: string;
  file: File;
  /** Retry an existing pending/failed reference row instead of making a new one. */
  retryFileId?: string;
  onStageChange?: (stage: LibraryUploadStage) => void;
}

export class LibraryAssetStorageService {
  /**
   * Full flow: client preflight (signature + size; dimensions when the
   * environment can decode) → RPC intent → signed transfer → RPC completion.
   * On transfer failure the pending row is marked failed (best effort) and
   * the error is rethrown for the UI.
   */
  async uploadAssetFile(input: UploadLibraryAssetFileInput): Promise<LibraryUploadResult> {
    const client = getSupabase();
    if (!client) throw new DemoModeError();
    const onStageChange = input.onStageChange;

    // 1) Client preflight — the same validators the reference flow uses.
    onStageChange?.('validating');
    const head = await readFileHead(input.file);
    const meta = validateFileMetadata(
      { name: input.file.name, size: input.file.size, type: input.file.type },
      head,
    );

    // 2) Server intent — authoritative membership/asset/mime/size validation;
    //    creates the PENDING row with the canonical workspace-scoped path.
    //    A retry reuses the same row (and path) instead of piling up rows.
    onStageChange?.('requesting');
    const { data: intentData, error: intentError } = await client
      .rpc('begin_library_file_upload', {
        p_workspace_id: input.workspaceId,
        p_library_asset_id: input.assetId,
        p_original_filename: input.file.name,
        p_mime_type: meta.sniffedMime,
        p_file_size: input.file.size,
        ...(input.retryFileId ? { p_retry_file_id: input.retryFileId } : {}),
      })
      .single<BeginUploadRpcRow>();
    if (intentError) throw intentError;
    const intent = {
      fileId: intentData.file_id,
      bucket: intentData.bucket,
      uploadPath: intentData.upload_path,
    };

    // 3) Direct transfer to the single signed, path-scoped upload URL.
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
      await this.failAssetFileUpload(intent.fileId, error).catch(() => undefined);
      throw error;
    }

    // 4) Completion — pending → uploaded + audit event, server-side.
    onStageChange?.('complete');
    const { error: completeError } = await client.rpc('complete_library_file_upload', {
      p_file_id: intent.fileId,
    });
    if (completeError) throw completeError;

    return {
      fileId: intent.fileId,
      fileName: meta.safeFilename,
      mime: meta.sniffedMime,
      sizeBytes: meta.sizeBytes,
    };
  }

  /** Marks the pending/failed row failed (audit-trailed, best effort). */
  async failAssetFileUpload(fileId: string, cause: unknown): Promise<void> {
    const client = getSupabase();
    if (!client) throw new DemoModeError();
    const { error } = await client.rpc('fail_library_file_upload', {
      p_file_id: fileId,
      p_reason: cause instanceof Error ? cause.message.slice(0, 120) : 'transfer failed',
    });
    if (error) throw error;
  }
}
