/** 
 * Relationship service layer for the UI.
 *
 * The engine module (`libraryRelationshipEngine.ts`) is a deterministic,
 * in-memory stub that tests and the UI can use directly. This bridge is the
 * only place that wires the engine to the current workspace and the
 * RelationshipClient adapter, so the UI never directly imports the engine's
 * storage maps and the repository contract stays the single source of truth.
 *
 * It re-exports the view shapes the UI already understands
 * (LibraryDefaultRelationshipView, LibraryAssetBundleView,
 * LibrarySuggestedAssetView) so feature panels can consume them without
 * knowing whether the engine is a stub (tests/mock) or the Supabase RPCs.
 */
import { useContext } from 'react';
import type {
  DefaultRelationshipRow,
  LibraryAssetBundleMemberRecord,
  LibraryAssetBundleRecord,
  LibraryAttachmentRecord,
  RelationshipType,
} from '../domain/library';
import { LibraryDataContext } from './useLibraryData';
import { RelationshipClient } from '../../services/libraryRelationshipClient';
import {
  RELATIONSHIP_TYPES,
  RELATIONSHIP_VARIANT_LABELS,
  relationshipContextRelevance,
} from '../domain/library';

export interface RelationshipClientInterface {
  listDefaultLibraryRelationships(workspaceId: string, sourceEntityType?: string, sourceEntityId?: string): Promise<DefaultRelationshipRow[]>;
  createDefaultLibraryRelationship(workspaceId: string, input: DefaultRelationshipRow): Promise<DefaultRelationshipRow>;
  updateDefaultLibraryRelationship(workspaceId: string, relationshipId: string, patch: Partial<DefaultRelationshipRow>): Promise<DefaultRelationshipRow>;
  removeDefaultLibraryRelationship(workspaceId: string, relationshipId: string): Promise<void>;
  listLibraryAssetBundles(workspaceId: string): Promise<LibraryAssetBundleRecord[]>;
  createLibraryAssetBundle(workspaceId: string, input: { name: string; description?: string | null; sourceEntityType?: string | null; sourceEntityId?: string | null }): Promise<LibraryAssetBundleRecord>;
  updateLibraryAssetBundle(workspaceId: string, bundleId: string, patch: Partial<{ name: string; description: string | null; sourceEntityType: string | null; sourceEntityId: string | null }>): Promise<LibraryAssetBundleRecord>;
  listLibraryAssetBundleMembers(workspaceId: string, bundleId: string): Promise<LibraryAssetBundleMemberRecord[]>;
  addBundleMember(workspaceId: string, bundleId: string, input: { libraryAssetId: string; roleOrSlot?: string | null; position?: number | null }): Promise<LibraryAssetBundleMemberRecord>;
  removeBundleMember(workspaceId: string, bundleId: string, libraryAssetId: string): Promise<void>;
  applyLibraryAssetBundleToDraftTarget(workspaceId: string, bundleId: string, targetType: string, targetId: string): Promise<LibraryAttachmentRecord[]>;
  getSuggestedAssetsForContext(workspaceId: string, input: { targetEntityType?: string; targetEntityId?: string; context?: string }): Promise<any[]>;
  acceptSuggestedAsset(workspaceId: string, input: { sourceEntityId: string; targetEntityType: string; targetEntityId: string; assetId: string }): Promise<any>;
  rejectSuggestedAsset(workspaceId: string, input: { sourceEntityId: string; targetEntityType: string; targetEntityId: string; assetId: string }): Promise<any>;
  createDraftVersionForDefaultChangeIfNeeded(workspaceId: string, input: { sourceEntityType: string; sourceEntityId: string; changeSummary?: string }): Promise<{ draftVersionId: string | null; created: boolean; message: string }>;
}

/** 
 * The UI-facing service. Holds one RelationshipClient per data context;
 * each client is constructed with the engine data the host supplied.
 * The RelationshipClient itself maps rows to the UI-safe views defined in
 * the client module.
 *
 * Calling this inside a component without a LibraryDataContext throws, so
 * panels always render inside the Library route or a parent that provided
 * the context.
 */
export function useRelationshipService(): RelationshipClientInterface {
  const ctx = useContext(LibraryDataContext);
  if (!ctx) {
    throw new Error('useRelationshipService must be used inside a LibraryDataContext provider.');
  }
  return new RelationshipClient(ctx.engine as any, { workspaceProvider: ctx.getWorkspaceId });
}

/** Deterministic, rule-based context relevance used to surface suggestions.
 * Kept in the domain layer and unchanged by the UI layer; the UI only
 * consumes the engine's already-computed suggestions. */
export { relationshipContextRelevance } from '../domain/library';

/** Recommended/default relationship type vocabulary. The UI renders these
 * labels verbatim from the domain registry so the UI never hard-codes a
 * product decision that belongs in the schema. */
export { RELATIONSHIP_TYPES, RELATIONSHIP_VARIANT_LABELS } from '../domain/library';

// Re-export the view shapes the UI consumes so feature panels can keep
// their own interfaces without importing the engine module.
export type {
  DefaultRelationshipRow,
  LibraryAssetBundleMemberRecord,
  LibraryAssetBundleRecord,
  LibraryAttachmentRecord,
  RelationshipType,
} from '../domain/library';
