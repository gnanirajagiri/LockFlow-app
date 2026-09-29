/**
 * Campaign content tab — the campaign-content organiser.
 *
 * Only approved, eligible Gallery outputs can be attached (single rule in
 * the domain). Replacement is explicit and confirmed; blocked items surface
 * honestly when their attached output is no longer available; copy variants
 * never create media.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOutletContext } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { GalleryIcon, SearchIcon } from '../../components/icons';
import type { CampaignContextValue } from './CampaignLayout';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import { ContentStudioService } from '../../services/contentService';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { getContentRepository } from '../../data/contentFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { CAMPAIGN_CHANNEL_KEYS } from '../../domain/campaigns';
import type { CampaignItemRecord, CampaignItemVariantRecord } from '../../domain/campaigns';
import {
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_ITEM_FORMAT_LABELS,
  CAMPAIGN_ITEM_STATUS_LABELS,
  CAMPAIGN_ITEM_STATUS_TONE,
  formatPlannedDateTime,
} from './campaignsUi';

interface EligibleOutput {
  output: {
    id: string;
    title: string;
    outputType: 'image' | 'video' | 'story';
    status: string;
    contentJobRequestId: string;
  };
  title: string;
}

const FORMATS = Object.keys(CAMPAIGN_ITEM_FORMAT_LABELS) as Array<keyof typeof CAMPAIGN_ITEM_FORMAT_LABELS>;

export function CampaignContentTab() {
  const { service, campaign, reload } = useOutletContext<CampaignContextValue>();
  const { toast } = useToast();
  const readOnly = campaign.status === 'archived';

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CampaignItemRecord[]>([]);
  const [variants, setVariants] = useState<CampaignItemVariantRecord[]>([]);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof service.getCampaignDetail>> | null>(null);

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [eligible, setEligible] = useState<EligibleOutput[] | null>(null);
  const [eligibleSearch, setEligibleSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'video' | 'story'>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [attaching, setAttaching] = useState<EligibleOutput | null>(null);
  const [attachChannel, setAttachChannel] = useState('');
  const [attachFormat, setAttachFormat] = useState('');
  const [attachDate, setAttachDate] = useState('');
  const [attachCaption, setAttachCaption] = useState('');
  const [attachCta, setAttachCta] = useState('');
  const [attachNotes, setAttachNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const [editingItem, setEditingItem] = useState<CampaignItemRecord | null>(null);
  const [editChannel, setEditChannel] = useState('');
  const [editFormat, setEditFormat] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editCaption, setEditCaption] = useState('');
  const [editCta, setEditCta] = useState('');
  const [replacing, setReplacing] = useState<CampaignItemRecord | null>(null);
  const [removing, setRemoving] = useState<CampaignItemRecord | null>(null);
  const [variantItem, setVariantItem] = useState<CampaignItemRecord | null>(null);
  const [variantLabel, setVariantLabel] = useState('');
  const [variantCaption, setVariantCaption] = useState('');
  const [variantCta, setVariantCta] = useState('');

  const channelKeys = useMemo(() => detail?.channels.map((ch) => ch.channel) ?? [], [detail]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await service.getCampaignDetail(campaign.id, SEED_GALLERY_WORKSPACE_ID);
      setDetail(d);
      setItems(d.items.filter((i) => i.status !== 'removed' && !i.removedAt));
      setVariants(d.variants);
    } finally {
      setLoading(false);
    }
  }, [service, campaign.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const contentService = useMemo(
    () =>
      new ContentStudioService(getContentRepository(), {
        library: new LibraryService(getLibraryRepository()),
        models: new ModelsService(getModelsRepository()),
        environments: new EnvironmentsService(getEnvironmentsRepository()),
      }),
    [],
  );

  const openSelector = useCallback(() => {
    setSelectorOpen(true);
    if (projects.length === 0) {
      contentService
        .listProjects(SEED_GALLERY_WORKSPACE_ID)
        .then((rows) => setProjects(rows.map((p) => ({ id: p.id, name: p.name }))))
        .catch(() => setProjects([]));
    }
  }, [contentService, projects.length]);

  // Eligible outputs refetch when the selector opens or the project filter
  // changes — filtering happens through the service (job → project relation).
  useEffect(() => {
    if (!selectorOpen) return;
    let active = true;
    service
      .listEligibleOutputs(
        SEED_GALLERY_WORKSPACE_ID,
        projectFilter === 'all' ? {} : { contentProjectId: projectFilter },
      )
      .then((rows) => {
        if (active) setEligible(rows);
      })
      .catch((err) => {
        toast({ title: err instanceof Error ? err.message : 'Could not load approved outputs.', tone: 'error' });
        if (active) setEligible([]);
      });
    return () => {
      active = false;
    };
  }, [selectorOpen, projectFilter, service, toast]);

  const filteredEligible = useMemo(() => {
    if (!eligible) return [];
    const needle = eligibleSearch.trim().toLowerCase();
    return eligible.filter(({ output, title }) => {
      if (typeFilter !== 'all' && output.outputType !== typeFilter) return false;
      if (needle && !title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [eligible, eligibleSearch, typeFilter]);

  function resetAttachForm() {
    setAttaching(null);
    setAttachChannel('');
    setAttachFormat('');
    setAttachDate('');
    setAttachCaption('');
    setAttachCta('');
    setAttachNotes('');
  }

  async function handleAttach() {
    if (!attaching) return;
    setBusy(true);
    try {
      await service.addItem(
        {
          campaignId: campaign.id,
          galleryOutputId: attaching.output.id,
          plannedChannel: attachChannel || null,
          plannedFormat: attachFormat || null,
          plannedPublishAt: attachDate ? new Date(attachDate).toISOString() : null,
          ...(attachCaption.trim() ? { captionDraft: attachCaption.trim() } : {}),
          ...(attachCta.trim() ? { callToAction: attachCta.trim() } : {}),
          ...(attachNotes.trim() ? { notes: attachNotes.trim() } : {}),
        },
        'demo-user',
        SEED_GALLERY_WORKSPACE_ID,
      );
      toast({ title: `${attaching.title} added to the campaign.`, tone: 'success' });
      resetAttachForm();
      setSelectorOpen(false);
      await load();
      await reload();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not add this output.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  function openEdit(item: CampaignItemRecord) {
    setEditingItem(item);
    setEditChannel(item.plannedChannel ?? '');
    setEditFormat(item.plannedFormat ?? '');
    setEditDate(item.plannedPublishAt ? item.plannedPublishAt.slice(0, 16) : '');
    setEditCaption(item.captionDraft ?? '');
    setEditCta(item.callToAction ?? '');
  }

  async function handleEditSave() {
    if (!editingItem) return;
    setBusy(true);
    try {
      await service.updateItem(
        editingItem.id,
        campaign.id,
        {
          plannedChannel: editChannel || null,
          plannedFormat: editFormat || null,
          plannedPublishAt: editDate ? new Date(editDate).toISOString() : null,
          captionDraft: editCaption.trim() || null,
          callToAction: editCta.trim() || null,
        },
        SEED_GALLERY_WORKSPACE_ID,
      );
      toast({ title: 'Campaign item updated.', tone: 'success' });
      setEditingItem(null);
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not update the item.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleReplace(target: EligibleOutput) {
    if (!replacing) return;
    setBusy(true);
    try {
      await service.replaceItemOutput(replacing.id, campaign.id, target.output.id, SEED_GALLERY_WORKSPACE_ID);
      toast({ title: `Item now uses ${target.title}. The original Gallery output is unchanged.`, tone: 'success' });
      setReplacing(null);
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not replace the output.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      await service.removeItem(removing.id, campaign.id, SEED_GALLERY_WORKSPACE_ID);
      toast({ title: 'Removed from campaign. The Gallery output is unchanged.', tone: 'success' });
      setRemoving(null);
      await load();
      await reload();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not remove the item.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function move(item: CampaignItemRecord, direction: -1 | 1) {
    const index = items.findIndex((i) => i.id === item.id);
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const ordered = [...items];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved);
    try {
      await service.reorderItems(campaign.id, ordered.map((i) => i.id), SEED_GALLERY_WORKSPACE_ID);
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not reorder items.', tone: 'error' });
    }
  }

  async function handleAddVariant() {
    if (!variantItem) return;
    setBusy(true);
    try {
      await service.addVariant(
        variantItem.id,
        campaign.id,
        {
          label: variantLabel,
          ...(variantCaption.trim() ? { captionDraft: variantCaption.trim() } : {}),
          ...(variantCta.trim() ? { callToAction: variantCta.trim() } : {}),
        },
        SEED_GALLERY_WORKSPACE_ID,
      );
      toast({ title: 'Copy variant added. It does not create media.', tone: 'success' });
      setVariantItem(null);
      setVariantLabel('');
      setVariantCaption('');
      setVariantCta('');
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not add the variant.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const variantsFor = (itemId: string) => variants.filter((v) => v.campaignItemId === itemId);

  return (
    <div>
      <div className="lf-dialogactions" style={{ justifyContent: 'space-between' }}>
        <p className="lf-tile__description" style={{ margin: 0 }}>
          Add approved Gallery outputs and prepare their channel-specific plans.
        </p>
        <Button variant="primary" disabled={readOnly} onClick={() => void openSelector()}>
          Add approved content
        </Button>
      </div>

      {loading ? (
        <Skeleton height={120} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<GalleryIcon size={22} />}
          title="No campaign content yet"
          description="Attach approved Gallery outputs to plan them for channels. Draft, processing, rejected or archived outputs cannot be added."
          actions={
            <Button variant="primary" disabled={readOnly} onClick={() => void openSelector()}>
              Add approved content
            </Button>
          }
        />
      ) : (
        <div role="list">
          {items.map((item, index) => {
            const withOutput = detail?.itemsWithOutputs.find((w) => w.item.id === item.id);
            const effective = withOutput?.effectiveStatus ?? item.status;
            const outputTitle = withOutput?.output?.title ?? 'Gallery output';
            return (
              <Card key={item.id} role="listitem">
                <CardBody>
                  <div className="lf-campaign-item">
                    <div className="lf-campaign-item__preview" aria-hidden="true">
                      <GalleryIcon size={22} />
                    </div>
                    <div className="lf-campaign-item__body">
                      <div className="lf-envcard__title">
                        <Link to={`/gallery/${item.galleryOutputId}`} className="lf-library__rowlink">
                          <strong>{outputTitle}</strong>
                        </Link>
                        <Badge tone={CAMPAIGN_ITEM_STATUS_TONE[effective]} dot>
                          {CAMPAIGN_ITEM_STATUS_LABELS[effective]}
                        </Badge>
                        <Badge tone="neutral">{withOutput?.output?.outputType ?? 'output'}</Badge>
                      </div>
                      <p className="lf-tile__description">
                        {item.plannedChannel ? CAMPAIGN_CHANNEL_LABELS[item.plannedChannel] ?? item.plannedChannel : 'No channel'}
                        {' · '}
                        {item.plannedFormat ? CAMPAIGN_ITEM_FORMAT_LABELS[item.plannedFormat] : 'No format'}
                        {' · '}
                        Planned for {formatPlannedDateTime(item.plannedPublishAt)}
                      </p>
                      {item.captionDraft ? (
                        <p className="lf-tile__description">Caption draft: {item.captionDraft}</p>
                      ) : null}
                      {item.callToAction ? (
                        <p className="lf-tile__description">CTA: {item.callToAction}</p>
                      ) : null}
                      {effective === 'blocked' ? (
                        <p role="alert">
                          <Badge tone="warning" dot>Blocked</Badge>{' '}
                          This approved output is no longer available for future publishing preparation.
                          The historic link is preserved — you can replace the output or remove the item,
                          but the Gallery record is not changed.
                        </p>
                      ) : null}
                      {variantsFor(item.id).length > 0 ? (
                        <ul className="lf-library__tags">
                          {variantsFor(item.id).map((v) => (
                            <li key={v.id} className="lf-library__tag">
                              {v.label} · copy variant only
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <div className="lf-campaign-item__actions">
                      <Button size="sm" variant="ghost" disabled={index === 0 || readOnly} onClick={() => void move(item, -1)}>
                        ↑ <span className="lf-visually-hidden">Move {outputTitle} up</span>
                      </Button>
                      <Button size="sm" variant="ghost" disabled={index === items.length - 1 || readOnly} onClick={() => void move(item, 1)}>
                        ↓ <span className="lf-visually-hidden">Move {outputTitle} down</span>
                      </Button>
                      <Button size="sm" disabled={readOnly} onClick={() => openEdit(item)}>Edit plan</Button>
                      <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => setVariantItem(item)}>
                        Add copy variant
                      </Button>
                      <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => setReplacing(item)}>
                        Replace output
                      </Button>
                      <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => setRemoving(item)}>
                        Remove
                      </Button>
                      <Link className="lf-btn lf-btn--ghost lf-btn--sm" to={`/gallery/${item.galleryOutputId}`}>
                        Open in Gallery
                      </Link>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <p className="lf-tile__description" style={{ marginTop: 'var(--lf-space-4)' }}>
        Publishing connections are not configured yet — plans here never post to any platform.
        Provenance stays read-only via the Gallery links on each item.
      </p>

      {/* ── Approved-output selector ─────────────────────────────────────── */}
      <Modal
        open={selectorOpen}
        onClose={() => { setSelectorOpen(false); setEligible(null); }}
        title="Add approved content"
        description="Only approved, available Gallery outputs are listed. Provenance and approval status are never changed by campaigns."
        size="lg"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => { setSelectorOpen(false); setEligible(null); }}>Close</Button>
          </div>
        }
      >
        <div className="lf-models-toolbar" role="group" aria-label="Approved output filters">
          <div className="lf-models-toolbar__filter lf-models-toolbar__filter--grow">
            <Input
              id="eligible-search"
              label="Search"
              hideLabel
              type="search"
              value={eligibleSearch}
              onChange={(event) => setEligibleSearch(event.target.value)}
              placeholder="Search approved outputs by title"
            />
          </div>
          <div className="lf-models-toolbar__filter">
            <label className="lf-field__label" htmlFor="eligible-type">Type</label>
            <select id="eligible-type" className="lf-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
              <option value="all">All types</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="story">Story</option>
            </select>
          </div>
          <div className="lf-models-toolbar__filter">
            <label className="lf-field__label" htmlFor="eligible-project">Content project</label>
            <select id="eligible-project" className="lf-input" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
        {eligible === null ? (
          <Skeleton height={200} />
        ) : filteredEligible.length === 0 ? (
          <EmptyState
            icon={<SearchIcon size={20} />}
            title="No eligible approved outputs"
            description="Outputs must be approved and available in this workspace. Draft, processing, rejected and archived outputs are excluded."
          />
        ) : (
          <div role="list">
            {filteredEligible.map(({ output, title }) => (
              <Card key={output.id} role="listitem">
                <CardBody>
                  <div className="lf-campaign-item">
                    <div className="lf-campaign-item__preview" aria-hidden="true"><GalleryIcon size={20} /></div>
                    <div className="lf-campaign-item__body">
                      <strong>{title}</strong>
                      <p className="lf-tile__description">
                        {output.outputType} · approved · provenance: content job {output.contentJobRequestId}
                      </p>
                    </div>
                    <div className="lf-campaign-item__actions">
                      <Button size="sm" variant="primary" disabled={readOnly} onClick={() => setAttaching({ output, title })}>
                        Select
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </Modal>

      {/* ── Attach plan dialog ───────────────────────────────────────────── */}
      <Modal
        open={attaching !== null}
        onClose={resetAttachForm}
        title={attaching ? `Plan ${attaching.title}` : 'Plan item'}
        footer={
          <div className="lf-dialogactions">
            <Button onClick={resetAttachForm}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void handleAttach()}>
              Add to campaign
            </Button>
          </div>
        }
      >
        {attaching ? (
          <div className="lf-formgrid">
            <div className="lf-field">
              <label className="lf-field__label" htmlFor="attach-channel">Planned channel</label>
              <select id="attach-channel" className="lf-input" value={attachChannel} onChange={(e) => setAttachChannel(e.target.value)}>
                <option value="">No channel yet</option>
                {CAMPAIGN_CHANNEL_KEYS.map((key) => (
                  <option key={key} value={key}>{CAMPAIGN_CHANNEL_LABELS[key] ?? key}</option>
                ))}
              </select>
              {channelKeys.length > 0 ? (
                <p className="lf-field__help">Campaign channels: {channelKeys.map((k) => CAMPAIGN_CHANNEL_LABELS[k] ?? k).join(', ')}.</p>
              ) : (
                <p className="lf-field__help">This campaign has no channels yet — add them on the Channels tab.</p>
              )}
            </div>
            <div className="lf-field">
              <label className="lf-field__label" htmlFor="attach-format">Planned format</label>
              <select id="attach-format" className="lf-input" value={attachFormat} onChange={(e) => setAttachFormat(e.target.value)}>
                <option value="">No format yet</option>
                {FORMATS.map((format) => (
                  <option key={format} value={format}>{CAMPAIGN_ITEM_FORMAT_LABELS[format]}</option>
                ))}
              </select>
            </div>
            <div className="lf-field">
              <label className="lf-field__label" htmlFor="attach-date">Planned date/time (internal planning only)</label>
              <Input id="attach-date" label="" hideLabel type="datetime-local" value={attachDate} onChange={(e) => setAttachDate(e.target.value)} />
            </div>
            <div className="lf-field lf-field--full">
              <label className="lf-field__label" htmlFor="attach-caption">Caption draft</label>
              <textarea id="attach-caption" className="lf-input" rows={3} maxLength={2200} value={attachCaption} onChange={(e) => setAttachCaption(e.target.value)} />
            </div>
            <div className="lf-field">
              <label className="lf-field__label" htmlFor="attach-cta">Call to action</label>
              <input id="attach-cta" className="lf-input" maxLength={200} value={attachCta} onChange={(e) => setAttachCta(e.target.value)} />
            </div>
            <div className="lf-field">
              <label className="lf-field__label" htmlFor="attach-notes">Notes</label>
              <input id="attach-notes" className="lf-input" maxLength={1000} value={attachNotes} onChange={(e) => setAttachNotes(e.target.value)} />
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ── Edit plan dialog ─────────────────────────────────────────────── */}
      <Modal
        open={editingItem !== null}
        onClose={() => setEditingItem(null)}
        title="Edit campaign item plan"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setEditingItem(null)}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void handleEditSave()}>
              Save plan
            </Button>
          </div>
        }
      >
        {editingItem ? (
          <div className="lf-formgrid">
            <div className="lf-field">
              <label className="lf-field__label" htmlFor="edit-channel">Planned channel</label>
              <select id="edit-channel" className="lf-input" value={editChannel} onChange={(e) => setEditChannel(e.target.value)}>
                <option value="">No channel</option>
                {CAMPAIGN_CHANNEL_KEYS.map((key) => (
                  <option key={key} value={key}>{CAMPAIGN_CHANNEL_LABELS[key] ?? key}</option>
                ))}
              </select>
            </div>
            <div className="lf-field">
              <label className="lf-field__label" htmlFor="edit-format">Planned format</label>
              <select id="edit-format" className="lf-input" value={editFormat} onChange={(e) => setEditFormat(e.target.value)}>
                <option value="">No format</option>
                {FORMATS.map((format) => (
                  <option key={format} value={format}>{CAMPAIGN_ITEM_FORMAT_LABELS[format]}</option>
                ))}
              </select>
            </div>
            <div className="lf-field">
              <label className="lf-field__label" htmlFor="edit-date">Planned date/time (internal planning only)</label>
              <Input id="edit-date" label="" hideLabel type="datetime-local" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </div>
            <div className="lf-field lf-field--full">
              <label className="lf-field__label" htmlFor="edit-caption">Caption draft</label>
              <textarea id="edit-caption" className="lf-input" rows={3} maxLength={2200} value={editCaption} onChange={(e) => setEditCaption(e.target.value)} />
            </div>
            <div className="lf-field">
              <label className="lf-field__label" htmlFor="edit-cta">Call to action</label>
              <input id="edit-cta" className="lf-input" maxLength={200} value={editCta} onChange={(e) => setEditCta(e.target.value)} />
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ── Replace confirmation ─────────────────────────────────────────── */}
      <Modal
        open={replacing !== null}
        onClose={() => setReplacing(null)}
        title="Replace output"
        size="lg"
        footer={<div className="lf-dialogactions"><Button onClick={() => setReplacing(null)}>Cancel</Button></div>}
      >
        {replacing ? (
          <>
            <p>
              Replacing this item changes the campaign plan only. The original Gallery output
              remains unchanged. Choose another <strong>approved</strong> output below — newer
              versions are never auto-selected.
            </p>
            <EligiblePickerInline
              service={service}
              readOnly={readOnly}
              onPick={(target) => void handleReplace(target)}
            />
          </>
        ) : null}
      </Modal>

      {/* ── Remove confirmation ──────────────────────────────────────────── */}
      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove from campaign"
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={() => void handleRemove()}>
              Remove item
            </Button>
          </div>
        }
      >
        <p>
          <strong>{removing ? removing.id : ''}</strong> will be removed from this campaign. This is
          a soft remove — the relation's history stays in the campaign, and the Gallery output is
          never modified.
        </p>
      </Modal>

      {/* ── Copy variant dialog ──────────────────────────────────────────── */}
      <Modal
        open={variantItem !== null}
        onClose={() => setVariantItem(null)}
        title="Add copy variant"
        description="Copy variant only — this does not create new media."
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setVariantItem(null)}>Cancel</Button>
            <Button variant="primary" disabled={busy || variantLabel.trim().length === 0} onClick={() => void handleAddVariant()}>
              Add variant
            </Button>
          </div>
        }
      >
        <div className="lf-formgrid">
          <Input
            id="variant-label"
            label="Variant label"
            value={variantLabel}
            onChange={(e) => setVariantLabel(e.target.value)}
            maxLength={120}
          />
          <div className="lf-field lf-field--full">
            <label className="lf-field__label" htmlFor="variant-caption">Caption draft</label>
            <textarea id="variant-caption" className="lf-input" rows={3} maxLength={2200} value={variantCaption} onChange={(e) => setVariantCaption(e.target.value)} />
          </div>
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="variant-cta">Call to action</label>
            <input id="variant-cta" className="lf-input" maxLength={200} value={variantCta} onChange={(e) => setVariantCta(e.target.value)} />
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Inline eligible-output picker used by the replace flow. */
function EligiblePickerInline({
  service,
  readOnly,
  onPick,
}: {
  service: CampaignContextValue['service'];
  readOnly: boolean;
  onPick: (target: EligibleOutput) => void;
}) {
  const [eligible, setEligible] = useState<EligibleOutput[] | null>(null);
  useEffect(() => {
    let active = true;
    service
      .listEligibleOutputs(SEED_GALLERY_WORKSPACE_ID)
      .then((rows) => {
        if (active) setEligible(rows);
      })
      .catch(() => setEligible([]));
    return () => {
      active = false;
    };
  }, [service]);

  if (eligible === null) return <Skeleton height={120} />;
  if (eligible.length === 0) {
    return <p className="lf-tile__description">No other approved outputs are available in this workspace.</p>;
  }
  return (
    <div role="list">
      {eligible.map(({ output, title }) => (
        <Card key={output.id} role="listitem">
          <CardBody>
            <div className="lf-campaign-item">
              <div className="lf-campaign-item__body">
                <strong>{title}</strong>
                <p className="lf-tile__description">{output.outputType} · approved</p>
              </div>
              <div className="lf-campaign-item__actions">
                <Button size="sm" disabled={readOnly} onClick={() => onPick({ output, title })}>
                  Use this output
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
