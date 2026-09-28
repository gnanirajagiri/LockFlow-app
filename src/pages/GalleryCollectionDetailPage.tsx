/**
 * Gallery collection detail — ordered Gallery outputs with a searchable
 * add-output selector, accessible reorder (move up/down) and remove.
 * Removing an item only leaves the collection; it never deletes the output.
 * Library assets cannot enter: the selector lists outputs from the service.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/Toast';
import { GalleryIcon, PlusIcon } from '../components/icons';
import { GalleryService } from '../services/galleryService';
import { ContentStudioService } from '../services/contentService';
import { LibraryService } from '../services/libraryService';
import { ModelsService } from '../services/modelsService';
import { EnvironmentsService } from '../services/environmentsService';
import { getGalleryRepository } from '../data/galleryFactory';
import { getContentRepository } from '../data/contentFactory';
import { getLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository } from '../data';
import { getEnvironmentsRepository } from '../data/environmentsFactory';
import { SEED_GALLERY_WORKSPACE_ID } from '../mock/gallerySeed';
import type {
  GalleryCollectionItemRecord,
  GalleryCollectionRecord,
  GalleryOutputRecord,
} from '../domain/gallery';

type LoadState = 'loading' | 'error' | 'ready';

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

const STATUS_TONE: Record<
  GalleryOutputRecord['status'],
  'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'locked' | 'primary'
> = {
  draft: 'neutral',
  processing: 'info',
  ready_for_review: 'primary',
  approved: 'success',
  rejected: 'danger',
  archived: 'warning',
  failed: 'danger',
};

export function GalleryCollectionDetailPage() {
  const { collectionId } = useParams<{ collectionId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const service = useMemo(() => {
    const content = new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
    return new GalleryService(getGalleryRepository(), content, SEED_GALLERY_WORKSPACE_ID);
  }, []);

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [collection, setCollection] = useState<GalleryCollectionRecord | null>(null);
  const [items, setItems] = useState<Array<{ item: GalleryCollectionItemRecord; output: GalleryOutputRecord }>>([]);
  const [allOutputs, setAllOutputs] = useState<GalleryOutputRecord[]>([]);
  const [addSearch, setAddSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!collectionId) return;
    setState('loading');
    setError(null);
    try {
      const workspaceId = SEED_GALLERY_WORKSPACE_ID;
      const [record, rows, outputs] = await Promise.all([
        service.getCollection(collectionId, workspaceId),
        service.listCollectionItems(collectionId, workspaceId),
        service.listOutputs(workspaceId),
      ]);
      setCollection(record);
      setItems(rows);
      setAllOutputs(outputs);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this collection.');
      setState('error');
    }
  }, [collectionId, service]);

  useEffect(() => {
    void load();
  }, [load]);

  const memberIds = useMemo(() => new Set(items.map(({ output }) => output.id)), [items]);

  const addableOutputs = useMemo(() => {
    const needle = addSearch.trim().toLowerCase();
    return allOutputs.filter(
      (output) =>
        !memberIds.has(output.id) &&
        (needle === '' || output.title.toLowerCase().includes(needle)),
    );
  }, [allOutputs, memberIds, addSearch]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast({ title: success, tone: 'success' });
      await load();
    } catch (err) {
      toast({
        title: 'Action failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (!collectionId || target < 0 || target >= items.length) return;
    const order = items.map(({ item }) => item.id);
    [order[index], order[target]] = [order[target], order[index]];
    void run(
      () => service.reorderCollectionItems(collectionId, order, SEED_GALLERY_WORKSPACE_ID),
      'Collection reordered',
    );
  }

  if (!collectionId || state === 'loading') {
    return (
      <div className="lf-page" aria-busy="true">
        <Skeleton variant="rect" height={56} />
        <Skeleton variant="rect" height={220} />
      </div>
    );
  }

  if (state === 'error' || !collection) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<GalleryIcon size={22} />}
          title="Couldn't load this collection"
          description={error ?? 'It may not exist in this workspace.'}
          actions={
            <Link className="lf-btn lf-btn--secondary" to="/gallery/collections">
              Back to collections
            </Link>
          }
        />
      </div>
    );
  }

  const archived = collection.status === 'archived';

  return (
    <div className="lf-page">
      <nav className="lf-library__filterreset" aria-label="Breadcrumb">
        <Link to="/gallery">Gallery</Link> / <Link to="/gallery/collections">Collections</Link> /{' '}
        <span aria-current="page">{collection.name}</span>
      </nav>

      <PageHeader
        eyebrow="Collection"
        title={collection.name}
        description={collection.description ?? 'Ordered Gallery outputs for review and export.'}
        actions={
          <div className="lf-envprofile__actions-row">
            <Link className="lf-btn lf-btn--secondary" to="/gallery/collections">
              All collections
            </Link>
            {archived ? (
              <Badge tone="warning" dot>
                Archived
              </Badge>
            ) : (
              <Button variant="danger" onClick={() => setArchiving(true)}>
                Archive collection
              </Button>
            )}
          </div>
        }
      />

      {archived ? (
        <div className="lf-lockedbanner__copy" role="status">
          This collection is archived (soft archive). Its items are preserved below and shown
          read-only; restore is a future action once collection editing reopens.
        </div>
      ) : (
        <>
          {/* Add-output selector — Gallery outputs only, searchable ─────── */}
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Add outputs</h3>
              <Input
                label="Search Gallery outputs"
                hideLabel
                placeholder="Search outputs by title…"
                value={addSearch}
                onChange={(event) => setAddSearch(event.target.value)}
                type="search"
              />
              {addableOutputs.length === 0 ? (
                <p className="lf-tile__description">
                  {addSearch.trim() === ''
                    ? 'Every Gallery output is already in this collection.'
                    : 'No outputs match that search.'}
                </p>
              ) : (
                <ul className="lf-library__choices">
                  {addableOutputs.map((output) => (
                    <li key={output.id}>
                      <button
                        type="button"
                        className="lf-library__choice"
                        disabled={busy || adding}
                        onClick={() => {
                          setAdding(true);
                          void run(
                            () => service.addCollectionItem(collection.id, output.id, SEED_GALLERY_WORKSPACE_ID),
                            `${output.title} added`,
                          ).finally(() => setAdding(false));
                        }}
                      >
                        <span className="lf-library__choiceicon" aria-hidden="true">
                          <PlusIcon size={14} />
                        </span>
                        <span className="lf-library__assetoptionmeta">
                          <strong>{output.title}</strong>
                          <span>
                            {output.outputType} · {statusLabel(output.status)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="lf-library__note">
                Only Gallery outputs can join a collection. Library assets stay in the unified
                Library.
              </p>
            </CardBody>
          </Card>
        </>
      )}

      {/* Ordered items — shown read-only while archived, editable otherwise */}
      {items.length === 0 && !archived ? (
        <EmptyState
          icon={<GalleryIcon size={22} />}
          title="No outputs in this collection yet"
          description="Add outputs above — removal here never deletes the output itself."
        />
      ) : items.length > 0 ? (
        <div role="list">
          {items.map(({ output }, index) => (
            <Card key={output.id} role="listitem">
              <CardBody>
                <div className="lf-library__rowwrap">
                  <div
                    className="lf-library__rowmenu"
                    role="group"
                    aria-label={`Reorder ${output.title}`}
                  >
                    <button
                      type="button"
                      className="lf-iconbtn"
                      aria-label={`Move ${output.title} up`}
                      disabled={busy || archived || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="lf-iconbtn"
                      aria-label={`Move ${output.title} down`}
                      disabled={busy || archived || index === items.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <span className="lf-envcard__slug">#{index + 1}</span>
                  </div>
                  <Link to={`/gallery/${output.id}`} className="lf-library__rowlink lf-envrow__main">
                    <div className="lf-envrow__cover" aria-hidden="true">
                      <GalleryIcon size={18} />
                    </div>
                    <div className="lf-envrow__name">
                      <strong>{output.title}</strong>
                      <div className="lf-envrow__badges">
                        <Badge tone="neutral">{output.outputType}</Badge>
                        <Badge tone={STATUS_TONE[output.status]} dot>
                          {statusLabel(output.status)}
                        </Badge>
                      </div>
                    </div>
                  </Link>
                  <div className="lf-library__rowmenu">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || archived}
                      onClick={() =>
                        void run(
                          () =>
                            service.removeCollectionItem(
                              collection.id,
                              items[index].item.id,
                              SEED_GALLERY_WORKSPACE_ID,
                            ),
                          `${output.title} removed from collection`,
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : null}

      <Modal
        open={archiving}
        onClose={() => setArchiving(false)}
        title={`Archive ${collection.name}?`}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setArchiving(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setArchiving(false);
                void run(
                  () => service.archiveCollection(collection.id, SEED_GALLERY_WORKSPACE_ID),
                  'Collection archived',
                ).then(() => navigate('/gallery/collections'));
              }}
            >
              Archive collection
            </Button>
          </div>
        }
      >
        <p style={{ margin: 0 }}>
          This is a soft archive — the collection and its ordered items are preserved. Outputs are
          never deleted by archiving a collection.
        </p>
      </Modal>
    </div>
  );
}
