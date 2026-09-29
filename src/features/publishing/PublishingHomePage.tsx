/**
 * Campaign publishing overview (/campaigns/:campaignId/publishing).
 *
 * Summary counts + draft cards with status-appropriate actions. The primary
 * action appears only when eligible items AND a verified connection exist —
 * otherwise it honestly points at connections or campaign content.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { GalleryIcon } from '../../components/icons';
import type { CampaignContextValue } from '../campaigns/CampaignLayout';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import { SocialConnectionsService } from '../../services/socialConnectionsService';
import { SocialConnectionEncryptionService } from '../../services/socialConnectionEncryption';
import { createDefaultProviderRegistry } from '../../services/socialProviders';
import { getSocialConnectionsRepository } from '../../data/socialConnectionsFactory';
import type { SafePublishingDraftView, PublishingDraftStatus } from '../../domain/publishing';
import {
  PUBLISHING_STATUS_LABELS,
  PUBLISHING_STATUS_TONES,
  formatPublishedAt,
} from './publishingUi';
import { usePublishingService } from './usePublishingService';

type LoadState = 'loading' | 'error' | 'ready';

export function CampaignPublishingPage() {
  const { campaign } = useOutletContext<CampaignContextValue>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const publishing = usePublishingService();
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<SafePublishingDraftView[]>([]);
  const [hasVerifiedConnection, setHasVerifiedConnection] = useState(false);
  const [archiving, setArchiving] = useState<SafePublishingDraftView | null>(null);
  const [busy, setBusy] = useState(false);

  const connections = useMemo(
    () =>
      new SocialConnectionsService(
        getSocialConnectionsRepository(),
        createDefaultProviderRegistry(),
        new SocialConnectionEncryptionService(),
      ),
    [],
  );

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [rows, connectionRows] = await Promise.all([
        publishing.listDraftsForCampaign(campaign.id, SEED_GALLERY_WORKSPACE_ID),
        connections.listConnections(SEED_GALLERY_WORKSPACE_ID),
      ]);
      setDrafts(rows);
      setHasVerifiedConnection(
        connectionRows.some((c) => c.status === 'connected' || c.status === 'needs_reauth'),
      );
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load publishing drafts.');
      setState('error');
    }
  }, [campaign.id, connections, publishing]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const by = (statuses: PublishingDraftStatus[]) =>
      drafts.filter((d) => !d.archivedAt && statuses.includes(d.status)).length;
    return {
      drafts: by(['draft', 'validating']),
      ready: by(['ready']),
      processing: by(['submitting', 'processing']),
      published: by(['published']),
      attention: by(['failed', 'blocked', 'needs_reauth']),
    };
  }, [drafts]);

  async function handleArchive() {
    if (!archiving) return;
    setBusy(true);
    try {
      await publishing.archiveDraft(archiving.id, SEED_GALLERY_WORKSPACE_ID, USER_ID);
      toast({ title: 'Draft archived.', tone: 'success' });
      setArchiving(null);
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not archive.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const primaryAction = hasVerifiedConnection
    ? { label: 'Prepare post', to: `/campaigns/${campaign.id}/publishing/new` }
    : { label: 'Connect an account', to: '/settings/connections' };

  return (
    <div>
      <PageHeader
        title="Publishing"
        description="Prepare approved campaign content for connected accounts."
        actions={
          <Button variant="primary" onClick={() => navigate(primaryAction.to)}>
            {primaryAction.label}
          </Button>
        }
      />

      {state === 'loading' ? (
        <Skeleton height={180} />
      ) : state === 'error' ? (
        <EmptyState
          icon={<GalleryIcon size={22} />}
          title="Could not load publishing drafts"
          description={error ?? 'Something went wrong.'}
          actions={<Button onClick={() => void load()}>Try again</Button>}
        />
      ) : (
        <>
          <div className="lf-campaign-summary">
            <Card><CardBody><strong>{counts.drafts}</strong> Drafts</CardBody></Card>
            <Card><CardBody><strong>{counts.ready}</strong> Ready to publish</CardBody></Card>
            <Card><CardBody><strong>{counts.processing}</strong> Processing</CardBody></Card>
            <Card><CardBody><strong>{counts.published}</strong> Published</CardBody></Card>
            <Card><CardBody><strong>{counts.attention}</strong> Needs attention</CardBody></Card>
          </div>

          <p className="lf-tile__description" style={{ margin: 'var(--lf-space-3) 0' }}>
            Creating a draft does not publish anything. Planned campaign dates stay internal —
            nothing posts automatically.
          </p>

          {drafts.length === 0 ? (
            <EmptyState
              icon={<GalleryIcon size={22} />}
              title="Prepare your first publishing draft."
              description="Choose an approved Campaign item and a verified workspace account. Creating a draft does not publish anything."
              actions={
                <div className="lf-dialogactions">
                  <Button variant="primary" onClick={() => navigate(primaryAction.to)}>
                    {primaryAction.label}
                  </Button>
                  {!hasVerifiedConnection ? (
                    <Link className="lf-btn lf-btn--ghost" to={`/campaigns/${campaign.id}/content`}>
                      Add approved campaign content
                    </Link>
                  ) : null}
                </div>
              }
            />
          ) : (
            <div role="list">
              {drafts.map((draft) => (
                <Card key={draft.id} role="listitem">
                  <CardBody>
                    <div className="lf-campaign-item">
                      <div className="lf-campaign-item__preview" aria-hidden="true">
                        <GalleryIcon size={20} />
                      </div>
                      <div className="lf-campaign-item__body">
                        <div className="lf-envcard__title">
                          <Link to={`/publishing/${draft.id}`}>
                            <strong>{draft.sourceTitle}</strong>
                          </Link>
                          <Badge tone={PUBLISHING_STATUS_TONES[draft.status]} dot>
                            {PUBLISHING_STATUS_LABELS[draft.status]}
                          </Badge>
                        </div>
                        <p className="lf-tile__description">
                          {draft.externalAccount.accountLabel ?? draft.externalAccount.connectionLocalName}
                          {' · '}
                          {draft.placement.replace(/_/g, ' ')}
                          {' · updated '}
                          {new Date(draft.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </p>
                        {draft.publishedUrl ? (
                          <p className="lf-tile__description">
                            <a href={draft.publishedUrl} target="_blank" rel="noreferrer">
                              View published post
                            </a>{' '}
                            · {formatPublishedAt(draft.publishedAt)}
                          </p>
                        ) : null}
                        {draft.failureMessageSafe ? (
                          <p className="lf-tile__description">
                            <Badge tone="warning" dot>{draft.failureMessageSafe}</Badge>
                          </p>
                        ) : null}
                      </div>
                      <div className="lf-campaign-item__actions">
                        {draft.status === 'ready' ? (
                          <Button size="sm" variant="primary" onClick={() => navigate(`/publishing/${draft.id}`)}>
                            Publish now
                          </Button>
                        ) : null}
                        {['submitting', 'processing'].includes(draft.status) ? (
                          <Button size="sm" onClick={() => navigate(`/publishing/${draft.id}`)}>
                            View status
                          </Button>
                        ) : null}
                        {draft.status === 'published' ? (
                          <>
                            <a className="lf-btn lf-btn--secondary lf-btn--sm" href={draft.publishedUrl ?? '#'} target="_blank" rel="noreferrer">
                              View published post
                            </a>
                          </>
                        ) : null}
                        {draft.status === 'failed' ? (
                          <Button size="sm" variant="primary" onClick={() => navigate(`/publishing/${draft.id}`)}>
                            View failure
                          </Button>
                        ) : null}
                        {draft.status === 'needs_reauth' ? (
                          <a className="lf-btn lf-btn--secondary lf-btn--sm" href="/settings/connections">
                            Reconnect account
                          </a>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/publishing/${draft.id}`)}>
                          Open
                        </Button>
                        {['draft', 'ready', 'failed', 'cancelled', 'blocked', 'needs_reauth'].includes(draft.status) ? (
                          <Button size="sm" variant="ghost" onClick={() => setArchiving(draft)}>
                            Archive
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title="Archive publishing draft"
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setArchiving(null)}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={() => void handleArchive()}>
              Archive
            </Button>
          </div>
        }
      >
        <p>
          Historic runs and events are preserved. Archived drafts move out of the active lists.
        </p>
      </Modal>
    </div>
  );
}

export const USER_ID = 'demo-user';
