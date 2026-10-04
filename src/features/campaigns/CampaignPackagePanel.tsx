/**
 * Campaign content packaging panel — prompt 31.
 *
 * Turns approved Gallery outputs into platform-ready campaign packages:
 * one package per channel/placement referencing the SAME source output.
 * Shows the honest readiness ladder (draft → needs_* → ready_for_review →
 * handed_to_publishing), the format/compatibility checklist and per-package
 * next actions. Only ready packages move into the existing Publishing
 * Review flow; nothing auto-publishes, and the Gallery source is never
 * modified.
 *
 * This component talks ONLY to the CampaignContentPackageService — never
 * providers, never OAuth/token material, never Storage.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { GalleryIcon } from '../../components/icons';
import { CampaignContentPackageService, InMemoryPackageStore } from '../../campaigns/packageService';
import type { PackageDependencies } from '../../campaigns/packageService';
import {
  CAMPAIGN_PACKAGE_STATUS_LABELS,
} from '../../campaigns/packageWorkflow';
import type {
  CampaignContentPackageRecord,
  PackagePlacement,
} from '../../campaigns/packageWorkflow';
import type { CampaignChannelKey } from '../../domain/campaigns/types';
import { getCampaignsService, getGalleryService } from './campaignServiceRefs';
import { PublishingReviewService } from '../../services/publishingReviewService';
import { PublishingDraftService } from '../../services/publishingService';
import { getPublishingReviewRepository } from '../../data/publishingReviewFactory';
import { getPublishingRepository } from '../../data/publishingFactory';
import { createDefaultPublishingRegistry } from '../../services/publishingProviders';
import { createDefaultProviderRegistry } from '../../services/socialProviders';
import { SocialConnectionsService } from '../../services/socialConnectionsService';
import { SocialConnectionEncryptionService } from '../../services/socialConnectionEncryption';
import { getSocialConnectionsRepository } from '../../data/socialConnectionsFactory';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import { CAMPAIGN_CHANNEL_LABELS } from './campaignsUi';

const ACTOR = 'demo-user';

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'danger' | 'warning' | 'primary' | 'info'> = {
  draft: 'neutral',
  needs_media_adaptation: 'warning',
  needs_copy: 'warning',
  needs_account: 'warning',
  blocked: 'danger',
  ready_for_review: 'success',
  approved_for_publish: 'primary',
  handed_to_publishing: 'primary',
};

/** Channels offered for packaging (social-first; Website/Email keep honest rules). */
const PACKAGE_CHANNELS: CampaignChannelKey[] = [
  'instagram', 'tiktok', 'youtube', 'facebook', 'linkedin', 'x', 'pinterest', 'paid_social',
];

/** Placements per channel (mirrors the adaptation profiles). */
const CHANNEL_PLACEMENTS: Partial<Record<CampaignChannelKey, PackagePlacement[]>> = {
  instagram: ['feed_post', 'reel', 'story', 'ad_creative'],
  tiktok: ['video_post', 'short_video', 'ad_creative'],
  youtube: ['video_post', 'short_video'],
  facebook: ['feed_post', 'reel', 'story', 'ad_creative'],
  linkedin: ['feed_post', 'video_post', 'image_post'],
  x: ['image_post', 'video_post', 'feed_post'],
  pinterest: ['image_post', 'video_post'],
  paid_social: ['ad_creative', 'feed_post', 'video_post', 'image_post'],
};

/** Shared module-level store so package state survives remounts. */
let packageStoreInstance: InMemoryPackageStore | null = null;
function getPackageStore(): InMemoryPackageStore {
  if (!packageStoreInstance) packageStoreInstance = new InMemoryPackageStore();
  return packageStoreInstance;
}

let packageServiceInstance: CampaignContentPackageService | null = null;

/** Builds the service over existing seams (same memoised pattern). */
export function getPackageService(): CampaignContentPackageService {
  if (packageServiceInstance) return packageServiceInstance;
  const gallery = getGalleryService();
  const campaigns = getCampaignsService();

  // Existing social connections seam — sanitized records only.
  const connections = new SocialConnectionsService(
    getSocialConnectionsRepository(),
    createDefaultProviderRegistry(),
    new SocialConnectionEncryptionService(),
  );

  // Existing publishing-review seam — the ONLY exit toward publishing.
  // Same construction as usePublishingReviewService (draft service included).
  const draftService = new PublishingDraftService(
    getPublishingRepository(),
    createDefaultPublishingRegistry(),
    connections,
    gallery,
    campaigns,
  );
  const reviewService = new PublishingReviewService(
    getPublishingReviewRepository(),
    getPublishingRepository(),
    createDefaultPublishingRegistry(),
    connections,
    gallery,
    campaigns,
    draftService,
  );

  const deps: PackageDependencies = {
    getOutput: (outputId, workspaceId) => gallery.getOutput(outputId, workspaceId),
    getCampaign: async (campaignId, workspaceId) => {
      const record = await campaigns.getCampaign(campaignId, workspaceId);
      return { id: record.id, workspaceId: record.workspaceId };
    },
    listVerifiedConnections: async (workspaceId) => {
      const rows = await connections.listConnections(workspaceId).catch(() => []);
      return rows.map((row) => ({ id: row.id, providerKey: row.providerKey, status: row.status }));
    },
    sendToPublishingReview: async (input) => {
      const report = await reviewService.createPublishingReview(
        {
          campaignId: input.campaignId,
          items: [{ campaignItemId: input.campaignItemId, placement: input.placement, acknowledgement: true }],
        },
        input.workspaceId,
        ACTOR,
      );
      const first = report.items[0];
      return {
        eligible: report.allEligible,
        blockers: first?.eligibility.blockers.map((blocker) => blocker.messageSafe) ?? [],
      };
    },
  };
  packageServiceInstance = new CampaignContentPackageService(getPackageStore(), deps);
  return packageServiceInstance;
}

export interface CampaignPackagePanelProps {
  campaignId: string;
  readOnly: boolean;
  /** Approved outputs offered for packaging (resolved by the content tab). */
  approvedOutputs: Array<{ id: string; title: string; outputType: 'image' | 'video' | 'story' }>;
}

export function CampaignPackagePanel({ campaignId, readOnly, approvedOutputs }: CampaignPackagePanelProps) {
  const { toast } = useToast();
  const service = useMemo(() => getPackageService(), []);

  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState<CampaignContentPackageRecord[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Create-form state
  const [outputId, setOutputId] = useState('');
  const [channel, setChannel] = useState<CampaignChannelKey>('instagram');
  const [placement, setPlacement] = useState<PackagePlacement>('feed_post');
  const [caption, setCaption] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setPackages(await service.listCampaignContentPackages(SEED_GALLERY_WORKSPACE_ID, campaignId));
    } finally {
      setLoading(false);
    }
  }, [service, campaignId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function nextPlacement(nextChannel: CampaignChannelKey) {
    const options = CHANNEL_PLACEMENTS[nextChannel] ?? ['other'];
    setPlacement(options[0] ?? 'other');
  }

  async function handleCreate() {
    if (busy || !outputId) return;
    setBusy(true);
    try {
      await service.createCampaignContentPackage(SEED_GALLERY_WORKSPACE_ID, {
        campaignId,
        channel,
        placement,
        sourceGalleryOutputId: outputId,
        captionOrCopy: caption.trim() || null,
      }, ACTOR);
      toast({ title: 'Package created for the channel. Validate it to check readiness.', tone: 'success' });
      setCreateOpen(false);
      setOutputId('');
      setCaption('');
      await refresh();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not create the package.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleValidate(pkg: CampaignContentPackageRecord) {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await service.validateCampaignContentPackage(SEED_GALLERY_WORKSPACE_ID, pkg.id);
      if (updated.validationState === 'valid') {
        toast({ title: 'Package is ready for publishing review.', tone: 'success' });
      } else {
        toast({ title: `Package not ready: ${updated.validationErrors[0] ?? 'issues found'}.`, tone: 'error' });
      }
      await refresh();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Validation failed.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleAddCopy(pkg: CampaignContentPackageRecord) {
    if (busy) return;
    setBusy(true);
    try {
      await service.updateCampaignContentPackage(SEED_GALLERY_WORKSPACE_ID, pkg.id, {
        captionOrCopy: `${pkg.captionOrCopy ?? ''} (edited for ${pkg.channel})`.trim(),
      }, ACTOR);
      toast({ title: 'Copy updated — re-validate the package.', tone: 'success' });
      await refresh();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not update the package.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestVariant(pkg: CampaignContentPackageRecord) {
    if (busy) return;
    setBusy(true);
    try {
      const variant = await service.createPackageMediaVariant(
        SEED_GALLERY_WORKSPACE_ID,
        pkg.id,
        { targetAspectRatio: '4:5', cropSettings: { mode: 'center' } },
        ACTOR,
      );
      toast({
        title: variant.status === 'unsupported'
          ? 'This transform is not supported — the package stays blocked.'
          : 'Crop variant recorded. Re-validate the package.',
        tone: variant.status === 'unsupported' ? 'error' : 'success',
      });
      await refresh();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not request the variant.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleSendToReview(pkg: CampaignContentPackageRecord) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await service.sendPackageToPublishingReview(SEED_GALLERY_WORKSPACE_ID, pkg.id, ACTOR);
      if (result.status === 'handed_to_publishing') {
        toast({ title: 'Package handed to publishing review. Nothing is published yet.', tone: 'success' });
      } else {
        toast({ title: `Publishing review found blockers: ${result.blockers[0] ?? 'unknown'}.`, tone: 'error' });
      }
      await refresh();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not hand off to publishing review.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  /** Next-action hint per status (honest readiness ladder). */
  function nextAction(pkg: CampaignContentPackageRecord): string {
    switch (pkg.status) {
      case 'draft': return 'Validate the package.';
      case 'needs_media_adaptation': return 'Request a crop/format variant, then re-validate.';
      case 'needs_copy': return 'Add the caption/copy, then re-validate.';
      case 'needs_account': return 'Assign a verified connected account, then re-validate.';
      case 'blocked': return 'This channel/format combination cannot be packaged.';
      case 'ready_for_review': return 'Send to publishing review.';
      case 'approved_for_publish': return 'Approved — publishing review controls the rest.';
      case 'handed_to_publishing': return 'In the existing publishing review flow.';
      default: return 'Validate the package.';
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="lf-dialogactions" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3 className="lf-envpanel__heading">Channel packaging</h3>
            <p className="lf-tile__description" style={{ margin: 0 }}>
              Prepare approved outputs per channel: copy, format checks, account and readiness.
              One output can be packaged differently for several channels — the Gallery source is
              never modified.
            </p>
          </div>
          {!readOnly && approvedOutputs.length > 0 ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>Package for a channel</Button>
          ) : null}
        </div>

        {loading ? (
          <Skeleton height={120} />
        ) : packages.length === 0 ? (
          <EmptyState
            icon={<GalleryIcon size={22} />}
            title="No channel packages yet"
            description="Package an approved output for a connected channel to prepare it for publishing review."
          />
        ) : (
          <ul className="lf-sheet__trait-list" style={{ margin: 'var(--lf-space-3) 0 0' }}>
            {packages.map((pkg) => {
              const source = approvedOutputs.find((candidate) => candidate.id === pkg.sourceGalleryOutputId);
              return (
                <li key={pkg.id} className="lf-sheet__trait-row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="lf-envcard__title" style={{ flexWrap: 'wrap' }}>
                      <strong>{source?.title ?? pkg.sourceGalleryOutputId}</strong>
                      <Badge tone="neutral">{CAMPAIGN_CHANNEL_LABELS[pkg.channel] ?? pkg.channel}</Badge>
                      <Badge tone="neutral">{pkg.placement.replace('_', ' ')}</Badge>
                      <Badge tone={STATUS_TONE[pkg.status] ?? 'neutral'} dot>
                        {CAMPAIGN_PACKAGE_STATUS_LABELS[pkg.status]}
                      </Badge>
                      {pkg.adaptationStatus === 'variant_needed' ? <Badge tone="warning">Crop needed</Badge> : null}
                      {pkg.adaptationStatus === 'unsupported' ? <Badge tone="danger">Format unsupported</Badge> : null}
                    </div>
                    <p className="lf-tile__description" style={{ margin: '2px 0 0' }}>
                      {nextAction(pkg)}
                    </p>
                    {pkg.validationErrors.length > 0 ? (
                      <ul className="lf-sheet__trait-list" style={{ margin: '4px 0 0' }}>
                        {pkg.validationErrors.slice(0, 3).map((error) => (
                          <li key={error} className="lf-sheet__trait-row" role="alert">{error}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {!readOnly && pkg.status !== 'handed_to_publishing' ? (
                    <div className="lf-campaign-item__actions" style={{ flexWrap: 'wrap' }}>
                      <Button size="sm" disabled={busy} onClick={() => void handleValidate(pkg)}>Validate</Button>
                      {pkg.status === 'needs_copy' || !pkg.captionOrCopy ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleAddCopy(pkg)}>Add copy</Button>
                      ) : null}
                      {pkg.status === 'needs_media_adaptation' ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleRequestVariant(pkg)}>Request crop</Button>
                      ) : null}
                      {pkg.status === 'ready_for_review' ? (
                        <Button size="sm" variant="primary" disabled={busy} onClick={() => void handleSendToReview(pkg)}>
                          Send to publishing review
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>

      {/* ── Create-package dialog ────────────────────────────────────────── */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Package for a channel"
        description="Creates a channel-specific presentation of an approved output. The Gallery source stays unchanged."
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !outputId} onClick={() => void handleCreate()}>
              Create package
            </Button>
          </div>
        }
      >
        <div className="lf-formgrid">
          <div className="lf-field lf-field--full">
            <label className="lf-field__label" htmlFor="pkg-output">Approved output</label>
            <select
              id="pkg-output"
              className="lf-input"
              value={outputId}
              onChange={(event) => setOutputId(event.target.value)}
            >
              <option value="">Choose an approved output…</option>
              {approvedOutputs.map((output) => (
                <option key={output.id} value={output.id}>
                  {output.title} ({output.outputType})
                </option>
              ))}
            </select>
          </div>
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="pkg-channel">Channel</label>
            <select
              id="pkg-channel"
              className="lf-input"
              value={channel}
              onChange={(event) => {
                const nextChannel = event.target.value as CampaignChannelKey;
                setChannel(nextChannel);
                nextPlacement(nextChannel);
              }}
            >
              {PACKAGE_CHANNELS.map((key) => (
                <option key={key} value={key}>{CAMPAIGN_CHANNEL_LABELS[key] ?? key}</option>
              ))}
            </select>
          </div>
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="pkg-placement">Placement</label>
            <select
              id="pkg-placement"
              className="lf-input"
              value={placement}
              onChange={(event) => setPlacement(event.target.value as PackagePlacement)}
            >
              {(CHANNEL_PLACEMENTS[channel] ?? ['other']).map((key) => (
                <option key={key} value={key}>{key.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div className="lf-field lf-field--full">
            <label className="lf-field__label" htmlFor="pkg-caption">Caption / copy for this channel</label>
            <textarea
              id="pkg-caption"
              className="lf-input"
              rows={3}
              maxLength={2200}
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Channel-specific copy (each package keeps its own)"
            />
          </div>
        </div>
      </Modal>
    </Card>
  );
}
