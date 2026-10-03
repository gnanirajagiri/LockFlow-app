/** Relationship service layer for the UI.

The engine module (`libraryRelationshipEngine.ts`) is a deterministic,
in-memory store used directly by tests and by the UI through the
RelationshipClient adapter. This module is the single seam that constructs
and exposes that client, so the UI never touches the engine's storage maps
directly and the repository contract stays the single source of truth.

It re-exports the view shapes the UI consumes so feature panels keep their
own imports without knowing whether the engine is an in-memory stub or the
Supabase RPCs.
*/

import { useContext } from 'react';
import type {
} from '../../domain/library';
import { LibraryDataContext } from './useLibraryData';
import { RelationshipClient } from '../../services/libraryRelationshipClient';

/** UI-facing service surface. Mirrors the engine's camelCase API so the
 *  panels read like the underlying store.
 */

/**
 * The UI-facing service. Reads the engine + workspace from the
 * LibraryDataContext the layout provides, then constructs a
 * RelationshipClient bound to that workspace.
 */
export function useRelationshipService(): RelationshipClient {
  const ctx = useContext(LibraryDataContext);
  if (!ctx) {
    throw new Error('useRelationshipService must be used inside a LibraryDataContext provider.');
  }
  const { engine, workspaceId } = ctx;
  return new RelationshipClient({ engine, workspaceProvider: () => workspaceId });
}

/** Deterministic, rule-based context relevance (domain helper). */
export { relationshipContextRelevance } from '../../domain/library';

/** Relationship type vocabulary rendered verbatim by the UI. */
export { RELATIONSHIP_VARIANT_LABELS } from '../../domain/library';

// Re-export the view shapes the UI consumes.
export type {
  LibraryAssetBundleRecord,
} from '../../domain/library';
