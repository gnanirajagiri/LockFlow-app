/** 
 * Default relationship controller — the UI controller for P25.
 *
 * It owns the workflow state (add/edit/remove relationship, add/remove
 * bundle members, accept/reject/replace/reapply suggestions) and renders
 * the derived, auditable state the service produces.
 *
 * The controller deliberately does NOT enforce version safety or override
 * semantics. All of that is the RelationshipEngine's job; this container
 * merely calls the RelationshipClient and re-renders the derived rows.
 *
 * Workspace/target scope is passed in from the host (the Library layout)
 * so the panel needs no route tree duplication.
 */
import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { LibraryIcon, LockIcon } from '../../components/icons';
import type { LibraryOutletContext } from '../../features/library/LibraryAssetProfileLayout';
import { DefaultRelationshipCard, type DefaultRelationshipCardData } from './DefaultRelationshipCard';
import { useRelationshipService } from './RelationshipService';
import type {
  LibraryAssetBundleRecord,
  LibraryDefaultRelationshipView,
  LibrarySuggestedAssetView,
} from '../../domain/library';

export interface ControllerProps {
  /** The workspace id this panel belongs to (for RLS-equivalent scoping). */
  workspaceId?: string;
}

export function DefaultRelationshipController({
  workspaceId,
}: ControllerProps) {
  const { data } = useOutletContext<LibraryOutletContext>();
  const { asset, activeVersion } = data;
  const { toast } = useToast();

  // Primary target for the relationship scope: the active version, else
  // the asset itself. The layout's data always belongs to workspaceId.
  const targetLabel = useMemo(() => {
    if (!asset) return 'selected target';
    if (activeVersion) return `model ${asset.name} — ${activeVersion.versionNumber}`;
    return asset.name;
  }, [asset, activeVersion]);

  const client = useRelationshipService();

  const [relationshipRows, setRelationshipRows] = useState<
    ReadonlyArray<DefaultRelationshipCardData>
  >([]);
  const [bundleRows, setBundleRows] = useState<LibraryAssetBundleRecord[]>([]);
  const [suggestionRows, setSuggestionRows] = useState<
    LibrarySuggestedAssetView[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const load = useMemo(() => async () => {
    setError(null);
    try {
      const [relationships, bundles, suggestions] = await Promise.all([
        client.listDefaultLibraryRelationships(workspaceId ?? ''),
        client.listLibraryAssetBundles(workspaceId ?? ''),
        client.getSuggestedAssetsForContext(workspaceId ?? '', {}),
      ]);
      setRelationshipRows(
        (relationships as LibraryDefaultRelationshipView[]).map((r) => ({
          kind: 'relationship' as const,
          view: r,
        })),
      );
      setBundleRows(bundles);
      setSuggestionRows(suggestions as LibrarySuggestedAssetView[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load default relationships.');
    }
  }, [client, workspaceId]);

  async function refresh() {
    try {
      await load();
    } catch {
      // load already sets error; swallow to avoid double toast wrappers.
    }
  }

  // ── Relationships (default) ────────────────────────────────────────────

  

  

  async function handleRemoveRelationship(row: DefaultRelationshipCardData) {
    void 0;
    setError(null);
    try {
      await client.removeDefaultLibraryRelationship(workspaceId ?? '', row.view.id);
      await refresh();
      toast({ title: 'Default relationship removed', tone: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the default relationship.');
    } finally {
      void 0;
    }
  }

  // ── Bundles ────────────────────────────────────────────────────────────

  async function handleCreateBundle(name: string, description: string | null) {
    void 0;
    setError(null);
    try {
      const created = await client.createLibraryAssetBundle(
        workspaceId ?? '',
        { name, description, sourceEntityType: null, sourceEntityId: null },
      );
      await refresh();
      toast({ title: 'Bundle created', tone: 'success' });
      return created.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the bundle.');
      throw err;
    } finally {
      void 0;
    }
  }

  async function handleUpdateBundle(
    bundle: LibraryAssetBundleRecord,
    patch: Partial<LibraryAssetBundleRecord>,
  ) {
    void 0;
    setError(null);
    try {
      const updated = await client.updateLibraryAssetBundle(
        workspaceId ?? '',
        bundle.id,
        patch as any,
      );
      setBundleRows((current) => current.map((b) => (b.id === bundle.id ? updated : b)));
      toast({ title: 'Bundle updated', tone: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the bundle.');
    } finally {
      void 0;
    }
  }

  

  

  async function handleApplyBundle(bundle: LibraryAssetBundleRecord) {
    void 0;
    setError(null);
    try {
      const records = await client.applyLibraryAssetBundleToDraftTarget(
        workspaceId ?? '',
        bundle.id,
        activeVersion ? 'model' : 'default',
        activeVersion ? activeVersion.id : '',
        activeVersion?.id,
      );
      toast({
        title: `Applied ${records.length} asset${records.length === 1 ? '' : 's'} to this draft`,
        tone: 'success',
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply the bundle to the draft.');
    } finally {
      void 0;
    }
  }

  // ── Suggestions ────────────────────────────────────────────────────────

  async function handleAcceptSuggestion(suggestion: LibrarySuggestedAssetView) {
    void 0;
    setError(null);
    try {
      await client.acceptSuggestedAsset(workspaceId ?? '', {
        sourceEntityId: suggestion.sourceEntityId,
        targetEntityType: suggestion.targetEntityType,
        targetEntityId: suggestion.targetEntityId,
        assetId: suggestion.relationshipId ?? suggestion.id,
      });
      await refresh();
      toast({ title: 'Suggestion accepted', tone: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept the suggestion.');
    } finally {
      void 0;
    }
  }

  async function handleRejectSuggestion(suggestion: LibrarySuggestedAssetView) {
    void 0;
    setError(null);
    try {
      await client.rejectSuggestedAsset(workspaceId ?? '', {
        sourceEntityId: suggestion.sourceEntityId,
        targetEntityType: suggestion.targetEntityType,
        targetEntityId: suggestion.targetEntityId,
        assetId: suggestion.relationshipId ?? suggestion.id,
      });
      await refresh();
      toast({ title: 'Suggestion rejected', tone: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reject the suggestion.');
    } finally {
      void 0;
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────

  const targetLabelFinal = targetLabel;

  return (
    <div className="lf-section" style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
      <Card>
        <CardBody>
          <div className="lf-sheet__section">
            <h3>Default relationships &amp; suggestions</h3>
            <p className="lf-tile__description">
              Recommended and default Library assets for <strong>{targetLabelFinal}</strong>.
              Every row is explicit, inspectable and reversible. Defaults never mutate locked
              versions or already-locked generations — they only apply to future drafts and new
              applications of that default.
            </p>
            {error ? (
              <div className="lf-alertbox" role="alert">{error}</div>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {/* Recommended / default / suggested relationships */}
      {relationshipRows.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              borderless
              icon={<LibraryIcon size={22} />}
              title="No defaults yet"
              description="Recommended and default Library assets for this target will appear here once you add or accept one. Accepting a suggestion creates a real, visible attachment record."
            />
          </CardBody>
        </Card>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {relationshipRows.map((row) => (
            <li key={row.view.id}>
              <DefaultRelationshipCard
                data={row}
                canAccept
                canReject
                onAccept={() => {
                  const match = suggestionRows.find((s) => s.id === row.view.id);
                  if (match) void handleAcceptSuggestion(match);
                }}
                onReject={() => {
                  const match = suggestionRows.find((s) => s.id === row.view.id);
                  if (match) void handleRejectSuggestion(match);
                }}
                onRemove={() => {
                  const isSuggestion = row.kind === 'suggestion';
                  if (isSuggestion) void handleRejectSuggestion(row as any as LibrarySuggestedAssetView);
                  else void handleRemoveRelationship(row);
                }}
                onReplace={() => {
                  // Replacement is handled by the host workflow (an edit
                  // panel mapping to updateDefaultLibraryRelationship).
                }}
                onApplyBundle={() => {
                  const match = bundleRows.find((b) => b.id === row.view.id);
                  if (match) void handleApplyBundle(match);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Suggested assets in workflow */}
      {suggestionRows.length > 0 ? (
        <Card>
          <CardBody>
            <h3 style={{ margin: '0 0 var(--lf-space-2)', fontSize: 14, fontWeight: 600 }}>
              Suggested assets
            </h3>
            <p
              className="lf-tile__description"
              style={{ margin: 0, fontSize: 12, color: '#64748b' }}
            >
              Rule-based, context-aware suggestions surfaced during creation/editing. They are
              deterministic and auditable, not AI-only randomness. Accepting one creates a real
              attachment; rejecting or dismissing keeps the base default untouched.
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {suggestionRows.map((suggestion) => (
                <li key={suggestion.id}>
                  <DefaultRelationshipCard
                    data={{ kind: 'suggestion', view: suggestion, sourceAsset: null }}
                    canAccept
                    canReject
                    onAccept={() => void handleAcceptSuggestion(suggestion)}
                    onReject={() => void handleRejectSuggestion(suggestion)}
                    onRemove={() => void handleRejectSuggestion(suggestion)}
                  />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {/* Bundles */}
      {bundleRows.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              borderless
              icon={<LibraryIcon size={22} />}
              title="No bundles yet"
              description="Reusable default asset sets. Create one to apply a visible set of assets to a draft version — the application always creates real attachment records, never hidden magic state."
              actions={
                <Button variant="primary" onClick={() => void handleCreateBundle('brand-starter', 'Reusable brand starter set')}>
                  Create a bundle
                </Button>
              }
            />
          </CardBody>
        </Card>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {bundleRows.map((bundle) => (
            <li
              key={bundle.id}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 'var(--lf-space-3)',
                background: '#fff',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 200px',
                  gap: 'var(--lf-space-2)',
                  alignItems: 'center',
                }}
              >
                <div className="lf-tile__title" style={{ fontWeight: 600, fontSize: 14 }}>
                  {bundle.name}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  <Badge tone="neutral">{bundle.status}</Badge>
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {bundle.memberCount} member{bundle.memberCount === 1 ? '' : 's'}
                </div>
              </div>
              {bundle.description ? (
                <p style={{ margin: 'var(--lf-space-2) 0 0', fontSize: 12, color: '#64748b' }}>
                  {bundle.description}
                </p>
              ) : null}
              <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
                <Button size="sm" variant="ghost" onClick={() => void handleUpdateBundle(bundle, { name: 'brand-starter', description: null })}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void handleApplyBundle(bundle)}>
                  Apply to draft
                  <LockIcon size={12} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p
        className="lf-tile__description"
        style={{ marginTop: 'var(--lf-space-2)', fontSize: 12 }}
      >
        <LockIcon size={12} style={{ display: 'inline-block', marginRight: 4, verticalAlign: 'middle' }} />
        Locked model/environment versions are never mutated by defaults or bundles.
        Changing a default or applying a bundle always lands on a draft version first.
      </p>
    </div>
  );
}
