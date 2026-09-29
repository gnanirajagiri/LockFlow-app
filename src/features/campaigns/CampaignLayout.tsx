/**
 * Campaign detail layout — shared header + tab navigation for the five
 * campaign routes. Status transitions are confirmed via modals and run
 * through the guarded service; archived campaigns render read-only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { CampaignIcon } from '../../components/icons';
import { CampaignsService } from '../../services/campaignsService';
import { getCampaignsRepository } from '../../data/campaignsFactory';
import { getGalleryRepository } from '../../data/galleryFactory';
import { getContentRepository } from '../../data/contentFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { GalleryService } from '../../services/galleryService';
import { ContentStudioService } from '../../services/contentService';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type { CampaignRecord, CampaignStatus } from '../../domain/campaigns';
import { CAMPAIGN_STATUS_TONE, campaignDateRange, campaignStatusLabel } from './campaignsUi';

export interface CampaignContextValue {
  service: CampaignsService;
  campaign: CampaignRecord;
  reload: () => Promise<void>;
}

const TABS: Array<{ segment: string; label: string }> = [
  { segment: 'overview', label: 'Overview' },
  { segment: 'content', label: 'Content' },
  { segment: 'calendar', label: 'Calendar' },
  { segment: 'channels', label: 'Channels' },
  { segment: 'activity', label: 'Activity' },
];

export function CampaignLayout() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

  const service = useMemo(() => {
    const content = new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
    return new CampaignsService(
      getCampaignsRepository(),
      new GalleryService(getGalleryRepository(), content, SEED_GALLERY_WORKSPACE_ID),
    );
  }, []);

  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<CampaignStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!campaignId) return;
    setState('loading');
    setError(null);
    try {
      setCampaign(await service.getCampaign(campaignId, SEED_GALLERY_WORKSPACE_ID));
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the campaign.');
      setState('error');
    }
  }, [service, campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeTab = useMemo(() => {
    const segment = location.pathname.split('/').filter(Boolean)[2] ?? 'overview';
    return TABS.some((t) => t.segment === segment) ? segment : 'overview';
  }, [location.pathname]);

  if (state === 'loading') {
    return (
      <EmptyState icon={<CampaignIcon size={22} />} title="Loading campaign…" description="One moment." />
    );
  }
  if (state === 'error' || !campaign) {
    return (
      <EmptyState
        icon={<CampaignIcon size={22} />}
        title="Could not load this campaign"
        description={error ?? 'It may not exist in this workspace.'}
        actions={<Link className="lf-btn lf-btn--secondary" to="/campaigns">Back to Campaigns</Link>}
      />
    );
  }

  const readOnly = campaign.status === 'archived';
  const primary: { to: CampaignStatus | null; label: string } = (() => {
    if (readOnly) return { to: 'draft', label: 'Restore campaign' };
    if (campaign.status === 'draft') return { to: 'active', label: 'Activate campaign' };
    if (campaign.status === 'active') return { to: null, label: 'Add content' };
    return { to: 'active', label: 'Reactivate campaign' };
  })();

  async function handleStatusChange() {
    if (!campaignId || confirmStatus === null) return;
    setBusy(true);
    try {
      await service.changeCampaignStatus(campaignId, confirmStatus, SEED_GALLERY_WORKSPACE_ID);
      toast({
        title: confirmStatus === 'archived' ? 'Campaign archived. It is read-only until restored.' : `Campaign ${confirmStatus}.`,
        tone: 'success',
      });
      setConfirmStatus(null);
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not update the campaign.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <nav className="lf-breadcrumb" aria-label="Breadcrumb">
        <Link to="/campaigns">Campaigns</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{campaign.name}</span>
      </nav>
      <PageHeader
        title={campaign.name}
        description={
          <>
            <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]} dot>{campaignStatusLabel(campaign.status)}</Badge>{' '}
            <span>{campaignDateRange(campaign)}</span>
            {readOnly ? <span> · Read-only while archived</span> : null}
          </>
        }
        actions={
          <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
            {primary.to === null ? (
              <Button variant="primary" onClick={() => navigate(`/campaigns/${campaign.id}/content`)}>
                {primary.label}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setConfirmStatus(primary.to)}>
                {primary.label}
              </Button>
            )}
            {!readOnly ? (
              <>
                {campaign.status === 'draft' || campaign.status === 'active' ? (
                  <Button onClick={() => setConfirmStatus('completed')}>Complete campaign</Button>
                ) : null}
                <Button variant="ghost" onClick={() => setConfirmStatus('archived')}>Archive campaign</Button>
                <Link className="lf-btn lf-btn--ghost" to={`/campaigns/${campaign.id}/overview`}>
                  Edit campaign
                </Link>
              </>
            ) : null}
          </div>
        }
      />

      <div className="lf-tabs" role="tablist" aria-label="Campaign sections">
        {TABS.map((tab) => (
          <Link
            key={tab.segment}
            role="tab"
            aria-selected={activeTab === tab.segment}
            className={`lf-tabs__tab${activeTab === tab.segment ? ' lf-tabs__tab--active' : ''}`}
            to={`/campaigns/${campaign.id}/${tab.segment}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <Outlet context={{ service, campaign, reload: load } satisfies CampaignContextValue} />

      <Modal
        open={confirmStatus !== null}
        onClose={() => setConfirmStatus(null)}
        title={
          confirmStatus === 'archived'
            ? `Archive ${campaign.name}?`
            : `${confirmStatus ? campaignStatusLabel(confirmStatus) : 'Update'} ${campaign.name}?`
        }
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setConfirmStatus(null)}>Cancel</Button>
            <Button
              variant={confirmStatus === 'archived' ? 'danger' : 'primary'}
              disabled={busy}
              onClick={() => void handleStatusChange()}
            >
              Confirm
            </Button>
          </div>
        }
      >
        {confirmStatus === 'archived' ? (
          <p>
            <strong>{campaign.name}</strong> will be archived and become read-only until restored.
            Content items, channels and history are preserved.
          </p>
        ) : (
          <p>
            This will move <strong>{campaign.name}</strong> to{' '}
            {confirmStatus ? campaignStatusLabel(confirmStatus) : 'the selected status'}. Planned
            items and channels are kept exactly as they are.
          </p>
        )}
      </Modal>
    </>
  );
}
