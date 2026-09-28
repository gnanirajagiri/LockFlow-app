/**
 * Gallery collections — index list. Collections group GALLERY OUTPUTS only,
 * never Library assets; they are soft-archived, never hard-deleted.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/Toast';
import { GridViewIcon } from '../components/icons';
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
import type { GalleryCollectionRecord } from '../domain/gallery';

type LoadState = 'loading' | 'error' | 'ready';

export function GalleryCollectionsPage() {
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
  const [collections, setCollections] = useState<GalleryCollectionRecord[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const workspaceId = SEED_GALLERY_WORKSPACE_ID;
      const list = await service.listCollections(workspaceId);
      const itemCounts: Record<string, number> = {};
      for (const collection of list) {
        const items = await service.listCollectionItems(collection.id, workspaceId).catch(() => []);
        itemCounts[collection.id] = items.length;
      }
      setCollections(list);
      setCounts(itemCounts);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load collections.');
      setState('error');
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (name.trim() === '') return;
    setBusy(true);
    try {
      await service.createCollection(
        { workspaceId: SEED_GALLERY_WORKSPACE_ID, name: name.trim(), description: description.trim() || undefined },
        'demo-user',
        SEED_GALLERY_WORKSPACE_ID,
      );
      toast({ title: 'Collection created', description: name.trim(), tone: 'success' });
      setCreateOpen(false);
      setName('');
      setDescription('');
      await load();
    } catch (err) {
      toast({
        title: 'Create failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Gallery"
        title="Collections"
        description="Group finished Gallery outputs for review, sharing and export. Collections never contain Library assets."
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            New collection
          </Button>
        }
      />

      {state === 'loading' ? (
        <div className="lf-envgrid" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rect" height={130} />
          ))}
        </div>
      ) : null}

      {state === 'error' ? (
        <EmptyState
          icon={<GridViewIcon size={22} />}
          title="Couldn't load collections"
          description={error ?? undefined}
          actions={
            <Button variant="primary" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : null}

      {state === 'ready' ? (
        collections.length === 0 ? (
          <EmptyState
            icon={<GridViewIcon size={22} />}
            title="No collections yet"
            description="Create a collection to organise approved outputs for campaigns and exports."
            actions={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                New collection
              </Button>
            }
          />
        ) : (
          <div className="lf-envgrid" role="list">
            {collections.map((collection) => (
              <Card key={collection.id} role="listitem">
                <CardBody>
                  <Link to={`/gallery/collections/${collection.id}`} className="lf-library__rowlink">
                    <div className="lf-envcard__title">
                      <h2>{collection.name}</h2>
                      <Badge tone={collection.status === 'active' ? 'success' : 'warning'}>{collection.status}</Badge>
                    </div>
                    <p className="lf-envcard__summary">
                      {counts[collection.id] ?? 0} output{(counts[collection.id] ?? 0) === 1 ? '' : 's'} ·{' '}
                      updated {new Date(collection.updatedAt).toLocaleDateString()}
                    </p>
                    {collection.description ? (
                      <p className="lf-tile__description">{collection.description}</p>
                    ) : null}
                  </Link>
                </CardBody>
              </Card>
            ))}
          </div>
        )
      ) : null}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New collection"
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy || name.trim() === ''} onClick={() => void handleCreate()}>
              Create collection
            </Button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
          <Input label="Name" required value={name} onChange={(event) => setName(event.target.value)} />
          <Input
            label="Description"
            optional
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <p className="lf-tile__description" style={{ margin: 0 }}>
            Collections hold Gallery outputs only — Library assets stay in the unified Library.
          </p>
        </div>
      </Modal>
    </div>
  );
}
