/**
 * Campaigns service rules — the product contracts, tested at the service
 * boundary over fresh mock repositories (reset per test for isolation).
 *
 * Covers the 14 required cases: workspace scoping, cross-workspace denial,
 * the single eligibility rule, no Gallery/source mutation, explicit
 * replacement, blocked propagation, channel validation, planning-only dates,
 * copy-variant purity, status guard, calendar updates, append-only events,
 * Gallery action gating and the absence of any publishing/OAuth surface.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CampaignsService } from './campaignsService';
import { MockCampaignsRepository } from '../data/mockCampaignsRepository';
import { MockGalleryRepository } from '../data/mockGalleryRepository';
import { ContentStudioService } from './contentService';
import { MockContentRepository } from '../data/mockContentRepository';
import { GalleryService } from './galleryService';
import { LibraryService } from './libraryService';
import { ModelsService } from './modelsService';
import { EnvironmentsService } from './environmentsService';
import { getLibraryRepository, resetLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository, resetModelsRepository } from '../data';
import { getEnvironmentsRepository, resetEnvironmentsRepository } from '../data/environmentsFactory';
import { resetContentRepository } from '../data/contentFactory';
import { resetGalleryRepository } from '../data/galleryFactory';
import { resetCampaignsRepository } from '../data/campaignsFactory';
import { SEED_GALLERY_WORKSPACE_ID } from '../mock/gallerySeed';
import { GALLERY_OUTPUT_SEED_IDS } from '../mock/gallerySeed';
import {
  CAMPAIGN_TRANSITIONS,
  effectiveItemStatus,
  isGalleryOutputEligibleForCampaign,
  galleryEligibilityProblem,
} from '../domain/campaigns';

const WS = SEED_GALLERY_WORKSPACE_ID;
const OTHER_WS = 'ws_other';

let service: CampaignsService;
let gallery: GalleryService;

beforeEach(() => {
  resetCampaignsRepository();
  resetGalleryRepository();
  resetContentRepository();
  resetLibraryRepository();
  resetModelsRepository();
  resetEnvironmentsRepository();
  const content = new ContentStudioService(new MockContentRepository(), {
    library: new LibraryService(getLibraryRepository()),
    models: new ModelsService(getModelsRepository()),
    environments: new EnvironmentsService(getEnvironmentsRepository()),
  });
  gallery = new GalleryService(new MockGalleryRepository(), content, WS);
  service = new CampaignsService(new MockCampaignsRepository(), gallery);
});

describe('campaign status guard (case 10)', () => {
  it('allows exactly the specified transitions', () => {
    expect(CAMPAIGN_TRANSITIONS.draft).toEqual(['active', 'archived']);
    expect(CAMPAIGN_TRANSITIONS.active).toEqual(['completed', 'archived']);
    expect(CAMPAIGN_TRANSITIONS.completed).toEqual(['active', 'archived']);
    expect(CAMPAIGN_TRANSITIONS.archived).toEqual(['draft', 'active', 'completed']);
  });

  it('refuses invalid transitions with a typed error', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Guard Test' }, 'demo-user');
    const active = await service.changeCampaignStatus(created.id, 'active', WS);
    await expect(service.changeCampaignStatus(active.id, 'draft', WS)).rejects.toThrow(
      /cannot move from active to draft/,
    );
  });

  it('archived campaigns are read-only until restored', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Archived RO' }, 'demo-user');
    await service.changeCampaignStatus(created.id, 'archived', WS);
    await expect(
      service.updateCampaign(created.id, { objective: 'new' }, WS),
    ).rejects.toThrow(/archived and read-only/);
    // Restore re-enables editing.
    await service.changeCampaignStatus(created.id, 'draft', WS);
    const updated = await service.updateCampaign(created.id, { objective: 'restored objective' }, WS);
    expect(updated.objective).toBe('restored objective');
  });
});

describe('eligibility rule (cases 2, 3, 13)', () => {
  const base = {
    id: 'out_1',
    workspaceId: WS,
    title: 'Output',
    outputType: 'image' as const,
    status: 'approved' as const,
    contentJobRequestId: 'job_1',
    mediaAvailable: true,
  };

  it('passes only for approved, same-workspace, available outputs with provenance', () => {
    expect(isGalleryOutputEligibleForCampaign(base, WS)).toBe(true);
    expect(isGalleryOutputEligibleForCampaign({ ...base, status: 'draft' }, WS)).toBe(false);
    expect(isGalleryOutputEligibleForCampaign({ ...base, status: 'processing' }, WS)).toBe(false);
    expect(isGalleryOutputEligibleForCampaign({ ...base, status: 'ready_for_review' }, WS)).toBe(false);
    expect(isGalleryOutputEligibleForCampaign({ ...base, status: 'rejected' }, WS)).toBe(false);
    expect(isGalleryOutputEligibleForCampaign({ ...base, status: 'failed' }, WS)).toBe(false);
    expect(isGalleryOutputEligibleForCampaign({ ...base, status: 'archived' }, WS)).toBe(false);
    expect(isGalleryOutputEligibleForCampaign({ ...base, mediaAvailable: false }, WS)).toBe(false);
    expect(isGalleryOutputEligibleForCampaign({ ...base, contentJobRequestId: '' }, WS)).toBe(false);
    expect(isGalleryOutputEligibleForCampaign({ ...base, workspaceId: OTHER_WS }, WS)).toBe(false);
  });

  it('gives an honest reason for ineligibility', () => {
    expect(galleryEligibilityProblem({ ...base, status: 'draft' }, WS)).toMatch(/approved/i);
    expect(galleryEligibilityProblem(base, OTHER_WS)).toMatch(/different workspace/i);
  });

  it('listing eligible outputs returns only approved seed outputs', async () => {
    const eligible = await service.listEligibleOutputs(WS);
    const ids = eligible.map((row) => row.output.id);
    expect(ids).toContain(GALLERY_OUTPUT_SEED_IDS.serum);
    expect(ids).toContain(GALLERY_OUTPUT_SEED_IDS.vanity);
    expect(ids).not.toContain(GALLERY_OUTPUT_SEED_IDS.story); // rejected
    expect(ids).not.toContain(GALLERY_OUTPUT_SEED_IDS.variant); // draft
  });
});

describe('workspace scoping (cases 1, 2)', () => {
  it('denies cross-workspace campaign reads', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Private Plan' }, 'demo-user');
    await expect(service.getCampaign(created.id, OTHER_WS)).rejects.toThrow(/different workspace/);
  });

  it('denies attaching a cross-workspace Gallery output', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Cross WS' }, 'demo-user');
    await expect(
      service.addItem(
        { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum },
        'demo-user',
        OTHER_WS,
      ),
    ).rejects.toThrow();
  });

  it('campaign detail events/items are workspace-scoped', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Scoped' }, 'demo-user');
    await expect(service.getCampaignDetail(created.id, OTHER_WS)).rejects.toThrow(/different workspace/);
    await expect(service.listEvents(created.id, OTHER_WS)).rejects.toThrow(/different workspace/);
  });
});

describe('attachment and provenance (cases 4, 5)', () => {
  it('attaches only approved outputs and never mutates the Gallery record', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Attach Test' }, 'demo-user');
    await service.changeCampaignStatus(created.id, 'active', WS);
    const before = await gallery.getOutput(GALLERY_OUTPUT_SEED_IDS.serum, WS);
    const item = await service.addItem(
      { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum },
      'demo-user',
      WS,
    );
    expect(item.galleryOutputId).toBe(GALLERY_OUTPUT_SEED_IDS.serum);
    const after = await gallery.getOutput(GALLERY_OUTPUT_SEED_IDS.serum, WS);
    expect(after).toEqual(before); // output untouched
  });

  it('refuses non-approved outputs with the honest reason', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Reject Attach' }, 'demo-user');
    await expect(
      service.addItem(
        { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.story },
        'demo-user',
        WS,
      ),
    ).rejects.toThrow(/approved/i);
  });

  it('replacement is explicit, validates eligibility and preserves the original output', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Replace Test' }, 'demo-user');
    const item = await service.addItem(
      { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum },
      'demo-user',
      WS,
    );
    const original = await gallery.getOutput(GALLERY_OUTPUT_SEED_IDS.serum, WS);
    const replaced = await service.replaceItemOutput(
      item.id,
      created.id,
      GALLERY_OUTPUT_SEED_IDS.vanity,
      WS,
    );
    expect(replaced.galleryOutputId).toBe(GALLERY_OUTPUT_SEED_IDS.vanity);
    expect((await gallery.getOutput(GALLERY_OUTPUT_SEED_IDS.serum, WS)).status).toBe(original.status);
    const events = await service.listEvents(created.id, WS);
    expect(events.some((e) => e.eventType === 'item_replaced')).toBe(true);
    // No auto-replacement to a newer output: same-id replacement is refused.
    await expect(
      service.replaceItemOutput(item.id, created.id, GALLERY_OUTPUT_SEED_IDS.vanity, WS),
    ).rejects.toThrow(/different approved output/i);
  });
});

describe('blocked propagation (case 6)', () => {
  it('renders archived attached outputs as blocked without erasing history', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Blocked Test' }, 'demo-user');
    const item = await service.addItem(
      { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum },
      'demo-user',
      WS,
    );
    // The output becomes archived later (Gallery-side action).
    await gallery.transitionOutput(GALLERY_OUTPUT_SEED_IDS.serum, 'archived', WS);
    const detail = await service.getCampaignDetail(created.id, WS);
    const row = detail.itemsWithOutputs.find((w) => w.item.id === item.id);
    expect(row?.effectiveStatus).toBe('blocked');
    // The historic relation is preserved (not removed).
    expect(row?.item.galleryOutputId).toBe(GALLERY_OUTPUT_SEED_IDS.serum);
    expect(row?.item.removedAt).toBeNull();
  });

  it('effectiveItemStatus keeps removed precedence and computes blocked', () => {
    expect(
      effectiveItemStatus({ status: 'planned', removedAt: null }, false),
    ).toBe('blocked');
    expect(
      effectiveItemStatus({ status: 'planned', removedAt: '2026-01-01T00:00:00.000Z' }, true),
    ).toBe('removed');
    expect(effectiveItemStatus({ status: 'ready', removedAt: null }, true)).toBe('ready');
  });
});

describe('channel validation (case 7)', () => {
  it('planned channel must belong to the campaign', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Channel Test' }, 'demo-user');
    await expect(
      service.addItem(
        { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum, plannedChannel: 'instagram' },
        'demo-user',
        WS,
      ),
    ).rejects.toThrow(/campaign channels/i);
    await service.addChannel(
      { campaignId: created.id, channel: 'instagram', intent: 'organic' },
      WS,
    );
    const item = await service.addItem(
      { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum, plannedChannel: 'instagram' },
      'demo-user',
      WS,
    );
    expect(item.plannedChannel).toBe('instagram');
    // Updates validate too.
    await expect(
      service.updateItem(item.id, created.id, { plannedChannel: 'tiktok' }, WS),
    ).rejects.toThrow(/campaign channels/i);
  });

  it('channel+intent combinations are unique', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Channel Dup' }, 'demo-user');
    await service.addChannel({ campaignId: created.id, channel: 'tiktok', intent: 'organic' }, WS);
    await expect(
      service.addChannel({ campaignId: created.id, channel: 'tiktok', intent: 'organic' }, WS),
    ).rejects.toThrow(/already planned/i);
  });
});

describe('planning dates and calendar (cases 8, 11)', () => {
  it('calendar updates change only the planning date', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Calendar Test' }, 'demo-user');
    const item = await service.addItem(
      { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum, plannedChannel: null },
      'demo-user',
      WS,
    );
    const before = await service.getCampaignDetail(created.id, WS);
    const beforeItem = before.items.find((i) => i.id === item.id);
    await service.updateItemPlannedDate(item.id, created.id, '2026-10-12T09:00:00.000Z', WS);
    const after = await service.getCampaignDetail(created.id, WS);
    const afterItem = after.items.find((i) => i.id === item.id);
    expect(afterItem?.plannedPublishAt).toBe('2026-10-12T09:00:00.000Z');
    // Everything else is untouched.
    expect(afterItem?.captionDraft).toBe(beforeItem?.captionDraft);
    expect(afterItem?.plannedChannel).toBe(beforeItem?.plannedChannel);
    const events = await service.listEvents(created.id, WS);
    expect(events.some((e) => e.eventType === 'calendar_updated')).toBe(true);
  });

  it('date validation rejects start after end', async () => {
    await expect(
      service.createCampaign(
        { workspaceId: WS, name: 'Bad Dates', startDate: '2026-10-10', endDate: '2026-10-01' },
        'demo-user',
      ),
    ).rejects.toThrow(/start date must not be after end date/i);
  });
});

describe('copy variants (case 9)', () => {
  it('variants store copy only and never create media or provider runs', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Variant Test' }, 'demo-user');
    const item = await service.addItem(
      { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum },
      'demo-user',
      WS,
    );
    const variant = await service.addVariant(
      item.id,
      created.id,
      { label: 'Short paid caption', captionDraft: 'Fictional copy only.' },
      WS,
    );
    expect(variant.label).toBe('Short paid caption');
    // No media/provider fields exist on the variant type at all.
    expect(Object.keys(variant)).not.toContain('mediaStoragePath');
    expect(Object.keys(variant)).not.toContain('providerRunId');
    expect(variant.formatOverride).toBeNull();
  });

  it('variants cannot be added to removed items', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Variant RO' }, 'demo-user');
    const item = await service.addItem(
      { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum },
      'demo-user',
      WS,
    );
    await service.removeItem(item.id, created.id, WS);
    await expect(
      service.addVariant(item.id, created.id, { label: 'Nope' }, WS),
    ).rejects.toThrow(/active campaign items/i);
  });
});

describe('audit events (case 12)', () => {
  it('material actions append events with minimal metadata', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Audit Test' }, 'demo-user');
    await service.changeCampaignStatus(created.id, 'active', WS);
    await service.addChannel({ campaignId: created.id, channel: 'email', intent: 'both' }, WS);
    const item = await service.addItem(
      { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum },
      'demo-user',
      WS,
    );
    await service.removeItem(item.id, created.id, WS);
    const events = await service.listEvents(created.id, WS);
    const types = events.map((e) => e.eventType);
    expect(types).toContain('created');
    expect(types).toContain('status_changed');
    expect(types).toContain('channel_added');
    expect(types).toContain('item_added');
    expect(types).toContain('item_removed');
    for (const event of events) {
      expect(JSON.stringify(event.metadata)).not.toMatch(/token|secret|password|signed/i);
      expect(JSON.stringify(event.metadata)).not.toMatch(/supabase\.co|\.svg|base64/i);
    }
  });

  it('events carry no media bytes or signed URLs', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Media Leak' }, 'demo-user');
    await service.addItem(
      { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum },
      'demo-user',
      WS,
    );
    const events = await service.listEvents(created.id, WS);
    for (const event of events) {
      expect(event.metadata.mediaStoragePath).toBeUndefined();
      expect(event.metadata.signedUrl).toBeUndefined();
    }
  });
});

describe('publishing boundaries (case 14)', () => {
  it('service exposes no publishing, OAuth or scheduling surface', () => {
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    const forbidden = proto.filter((name) =>
      /publish|oauth|token|connect|schedule|worker|social/i.test(name),
    );
    expect(forbidden).toEqual([]);
  });

  it('planned dates are stored as planning metadata only (no delivery state)', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'No Publish' }, 'demo-user');
    const item = await service.addItem(
      { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum },
      'demo-user',
      WS,
    );
    await service.updateItemPlannedDate(item.id, created.id, '2026-10-12T09:00:00.000Z', WS);
    const detail = await service.getCampaignDetail(created.id, WS);
    const row = detail.items.find((i) => i.id === item.id);
    expect(row && 'publishState' in row).toBe(false);
    expect(row && 'externalPostId' in row).toBe(false);
  });
});

describe('reorder safety (case 10 support)', () => {
  it('reorder requires every current id exactly once', async () => {
    const created = await service.createCampaign({ workspaceId: WS, name: 'Reorder' }, 'demo-user');
    const a = await service.addItem(
      { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum },
      'demo-user',
      WS,
    );
    const b = await service.addItem(
      { campaignId: created.id, galleryOutputId: GALLERY_OUTPUT_SEED_IDS.vanity },
      'demo-user',
      WS,
    );
    await service.reorderItems(created.id, [b.id, a.id], WS);
    const detail = await service.getCampaignDetail(created.id, WS);
    const order = detail.items.map((i) => i.id);
    expect(order.indexOf(b.id)).toBeLessThan(order.indexOf(a.id));
    await expect(service.reorderItems(created.id, [a.id], WS)).rejects.toThrow(/exactly once/i);
    await expect(service.reorderItems(created.id, [a.id, a.id], WS)).rejects.toThrow(/exactly once/i);
  });
});
