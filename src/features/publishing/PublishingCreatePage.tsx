/**
 * Create publishing draft (/campaigns/:campaignId/publishing/new) — 5 steps:
 * content → destination → placement → copy/accessibility → review.
 * Publish-now intentionally does NOT exist here: it appears only in the
 * individual draft detail after validation.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, Link } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { GalleryIcon } from '../../components/icons';
import type { CampaignContextValue } from '../campaigns/CampaignLayout';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import { SocialConnectionsService } from '../../services/socialConnectionsService';
import { SocialConnectionEncryptionService } from '../../services/socialConnectionEncryption';
import { createDefaultProviderRegistry } from '../../services/socialProviders';
import { getSocialConnectionsRepository } from '../../data/socialConnectionsFactory';
import type { SocialConnectionRecord } from '../../domain/social';
import type { ProviderCapabilities, PublishingPlacement } from '../../domain/publishing';
import { CAMPAIGN_CHANNEL_LABELS } from '../campaigns/campaignsUi';
import { usePublishingService } from './usePublishingService';
import { createDefaultPublishingRegistry } from '../../services/publishingProviders';

const STEPS = ['Content', 'Destination', 'Format', 'Copy & accessibility', 'Review'] as const;

export function PublishingCreatePage() {
  const { campaign, service: campaignsService } = useOutletContext<CampaignContextValue>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const publishing = usePublishingService();

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<
    Array<{ id: string; galleryOutputId: string; title: string; outputType: string; channelLabel: string; blocked: boolean; blockedReason: string | null }>
  >([]);
  const [connections, setConnections] = useState<SocialConnectionRecord[]>([]);
  const [capabilities, setCapabilities] = useState<ProviderCapabilities | null>(null);

  const [itemId, setItemId] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<PublishingPlacement | null>(null);
  const [caption, setCaption] = useState('');
  const [cta, setCta] = useState('');
  const [altText, setAltText] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const social = useMemo(
    () =>
      new SocialConnectionsService(
        getSocialConnectionsRepository(),
        createDefaultProviderRegistry(),
        new SocialConnectionEncryptionService(),
      ),
    [],
  );

  // Load verified connections on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const connectionRows = await social.listConnections(SEED_GALLERY_WORKSPACE_ID);
        if (!active) return;
        setConnections(connectionRows.filter((c) => c.status === 'connected'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [social]);

  // Step 1 data: campaign items with fresh eligibility through the detail.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const detail = await campaignsService.getCampaignDetail(campaign.id, SEED_GALLERY_WORKSPACE_ID);
        if (!active) return;
        setItems(
          detail.itemsWithOutputs
            .filter((w) => w.item.status !== 'removed' && !w.item.removedAt)
            .map((w) => ({
              id: w.item.id,
              galleryOutputId: w.item.galleryOutputId,
              title: w.output?.title ?? 'Gallery output',
              outputType: w.output?.outputType ?? 'image',
              channelLabel: w.item.plannedChannel
                ? CAMPAIGN_CHANNEL_LABELS[w.item.plannedChannel] ?? w.item.plannedChannel
                : 'No channel planned',
              blocked: w.effectiveStatus === 'blocked',
              blockedReason:
                w.effectiveStatus === 'blocked'
                  ? 'This approved output is no longer available for publishing. Replace it in Campaign Content.'
                  : null,
            })),
        );
      } catch (err) {
        toast({ title: err instanceof Error ? err.message : 'Could not load campaign items.', tone: 'error' });
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id]);

  const selectedItem = items.find((i) => i.id === itemId) ?? null;
  const selectedConnection = connections.find((c) => c.id === connectionId) ?? null;
  const isVideo = selectedItem ? selectedItem.outputType === 'video' : false;

  // Step 2→3: fetch provider capabilities when a connection is chosen.
  useEffect(() => {
    if (!selectedConnection || step < 2) return;
    let active = true;
    (async () => {
      try {
        const provider = createDefaultPublishingRegistryFor(selectedConnection.providerKey);
        if (!provider) return;
        const caps = await provider.getCapabilities({
          connection: {
            connectionId: selectedConnection.id,
            providerKey: selectedConnection.providerKey,
            workspaceId: SEED_GALLERY_WORKSPACE_ID,
            accessToken: '',
          },
        });
        if (active) setCapabilities(caps);
      } catch {
        if (active) setCapabilities(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedConnection, step]);

  const maxCaption = capabilities?.maxCaptionLength ?? 2200;
  const altRequired = placement === 'image_post';

  function canAdvance(): boolean {
    if (step === 0) return itemId !== null;
    if (step === 1) return connectionId !== null;
    if (step === 2) return placement !== null;
    if (step === 3) {
      if (caption.length > maxCaption) return false;
      if (altRequired && !altText.trim()) return false;
      return true;
    }
    return true;
  }

  async function handleSaveDraft() {
    if (!itemId || !connectionId || !placement) return;
    setBusy(true);
    try {
      const draft = await publishing.createDraft(
        {
          campaignId: campaign.id,
          campaignItemId: itemId,
          workspaceSocialConnectionId: connectionId,
          placement,
          copy: {
            ...(caption.trim() ? { caption: caption.trim() } : {}),
            ...(cta.trim() ? { callToAction: cta.trim() } : {}),
            ...(altText.trim() ? { altText: altText.trim() } : {}),
            ...(notes.trim() ? { internalNotes: notes.trim() } : {}),
          },
          acknowledgement: true,
        },
        SEED_GALLERY_WORKSPACE_ID,
        'demo-user',
      );
      toast({ title: 'Draft saved. Nothing has been published.', tone: 'success' });
      navigate(`/publishing/${draft.id}`);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not save the draft.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Publishing" description="Prepare approved campaign content for connected accounts." />
        <Skeleton height={220} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Publishing"
        description="Prepare approved campaign content for connected accounts."
        actions={
          <Link className="lf-btn lf-btn--ghost" to={`/campaigns/${campaign.id}/publishing`}>
            Back to Publishing
          </Link>
        }
      />

      <ol className="lf-campaign-overview" aria-label="Draft creation steps" style={{ listStyle: 'decimal', paddingLeft: 'var(--lf-space-5)' }}>
        {STEPS.map((label, index) => (
          <li key={label} style={{ fontWeight: index === step ? 600 : 400 }}>
            {label}
            {index === step ? <Badge tone="info">Current</Badge> : null}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <Card>
          <CardBody>
            <p className="lf-tile__description">
              Only active Campaign items with approved, available Gallery outputs are listed.
            </p>
            {items.length === 0 ? (
              <EmptyState
                icon={<GalleryIcon size={20} />}
                title="No campaign content yet"
                description="Add approved Gallery outputs in Campaign Content first."
                actions={<Link className="lf-btn lf-btn--secondary" to={`/campaigns/${campaign.id}/content`}>Add approved campaign content</Link>}
              />
            ) : (
              <div role="list">
                {items.map((item) => (
                  <Card key={item.id} role="listitem">
                    <CardBody>
                      <div className="lf-campaign-item">
                        <div className="lf-campaign-item__preview" aria-hidden="true"><GalleryIcon size={18} /></div>
                        <div className="lf-campaign-item__body">
                          <strong>{item.title}</strong>
                          <p className="lf-tile__description">
                            {item.outputType} · {item.channelLabel}
                            {' · approved'}
                          </p>
                          {item.blocked && item.blockedReason ? (
                            <p className="lf-tile__description"><Badge tone="warning" dot>{item.blockedReason}</Badge></p>
                          ) : null}
                        </div>
                        <div className="lf-campaign-item__actions">
                          {item.blocked ? (
                            <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={`/campaigns/${campaign.id}/content`}>
                              Replace in Content
                            </Link>
                          ) : (
                            <Button size="sm" variant={itemId === item.id ? 'primary' : 'secondary'} onClick={() => { setItemId(item.id); setPlacement(null); }}>
                              {itemId === item.id ? 'Selected' : 'Select'}
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardBody>
            <p className="lf-tile__description">
              Only verified, connected workspace accounts can prepare publishing drafts.
            </p>
            {connections.length === 0 ? (
              <EmptyState
                icon={<GalleryIcon size={20} />}
                title="No verified account"
                description="Connect and verify an account before preparing a publishing draft."
                actions={<Link className="lf-btn lf-btn--primary" to="/settings/connections">Open Connections</Link>}
              />
            ) : (
              <div role="list">
                {connections.map((connection) => (
                  <Card key={connection.id} role="listitem">
                    <CardBody>
                      <div className="lf-campaign-item">
                        <div className="lf-campaign-item__body">
                          <strong>{connection.localName}</strong>
                          <p className="lf-tile__description">
                            {connection.providerKey} · {connection.externalAccountLabel ?? 'Connected account'} · Connected
                          </p>
                        </div>
                        <div className="lf-campaign-item__actions">
                          <Button size="sm" variant={connectionId === connection.id ? 'primary' : 'secondary'} onClick={() => { setConnectionId(connection.id); setCapabilities(null); }}>
                            {connectionId === connection.id ? 'Selected' : 'Select'}
                          </Button>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardBody>
            <p className="lf-tile__description">
              Only placements the provider supports are offered. LockFlow never auto-crops,
              transcodes or generates new media for a placement.
            </p>
            <p className="lf-tile__description">
              Source: {selectedItem?.title} ({isVideo ? 'video' : 'image'}).
            </p>
            {!capabilities ? (
              <Skeleton height={80} />
            ) : (
              <div role="list" className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
                {capabilities.placements.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={placement === option ? 'primary' : 'secondary'}
                    onClick={() => setPlacement(option)}
                  >
                    {option.replace(/_/g, ' ')}
                  </Button>
                ))}
              </div>
            )}
            {placement === 'ad_creative' ? (
              <p className="lf-tile__description">
                Paid placements are preparation-only in this phase — no spend, targeting or
                buying is possible.
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardBody>
            <p className="lf-tile__description">
              Copy changes affect this publishing draft only. Your Gallery output and Campaign
              item remain unchanged.
            </p>
            <div className="lf-formgrid">
              <div className="lf-field lf-field--full">
                <label className="lf-field__label" htmlFor="pub-caption">
                  Caption (max {maxCaption} characters)
                </label>
                <textarea
                  id="pub-caption"
                  className="lf-input"
                  rows={4}
                  maxLength={maxCaption}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                />
                <p className="lf-tile__description">{caption.length}/{maxCaption}</p>
              </div>
              <div className="lf-field">
                <Input label="Call to action (optional)" value={cta} onChange={(e) => setCta(e.target.value)} />
              </div>
              <div className="lf-field">
                <Input
                  label={altRequired ? 'Alt text (required)' : 'Alt text (recommended)'}
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                  hint="Describe the image for accessibility."
                />
              </div>
              <div className="lf-field lf-field--full">
                <Input label="Internal notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {step === 4 ? (
        <Card>
          <CardBody>
            <p className="lf-tile__description">
              Review the source, destination and copy. Saving creates an internal draft — nothing
              is published.
            </p>
            <ul>
              <li>Source: {selectedItem?.title} (approved Gallery output, provenance read-only)</li>
              <li>Account: {selectedConnection?.localName} ({selectedConnection?.providerKey})</li>
              <li>Placement: {placement?.replace(/_/g, ' ')}</li>
              <li>Caption: {caption.length}/{maxCaption} characters</li>
              <li>Alt text: {altText.trim() ? 'provided' : 'not provided'}</li>
            </ul>
            <p className="lf-tile__description">
              <strong>
                I confirm I have the right to publish this content and that the content and copy
                comply with platform policies and applicable law.
              </strong>{' '}
              (Recorded with the draft on save.)
            </p>
            <div className="lf-dialogactions">
              <Button onClick={() => navigate(`/campaigns/${campaign.id}/publishing`)}>Cancel</Button>
              <Button disabled={busy} onClick={() => void handleSaveDraft()}>
                {busy ? 'Saving…' : 'Save draft'}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div className="lf-dialogactions" style={{ justifyContent: 'space-between' }}>
        <Button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
          ← Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button variant="primary" disabled={!canAdvance()} onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
            Continue →
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Resolves the publishing adapter for a provider key (capabilities only). */
function createDefaultPublishingRegistryFor(providerKey: string) {
  return createDefaultPublishingRegistry().get(providerKey);
}
