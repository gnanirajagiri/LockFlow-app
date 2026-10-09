/**
 * Development-only Gallery seed — fictional, placeholder media only.
 *
 * Outputs hang off the seeded "Morning Skincare Routine — Content Set" job
 * request and its immutable pins. Every record carries metadata.placeholder =
 * true: provider generation and secure media storage are NOT connected, and
 * these paths are local placeholders, never real generated media.
 */
import type {
  GalleryCollectionItemRecord,
  GalleryCollectionRecord,
  GalleryOutputEventRecord,
  GalleryOutputRecord,
  GalleryOutputReviewRecord,
  GalleryOutputTagLinkRecord,
  GalleryOutputTagRecord,
} from '../domain/gallery';

const WORKSPACE_ID = 'ws_demo';

export const GALLERY_JOB_REQUEST_ID = 'content_job_morning_routine_set';

const OUTPUT_IDS = {
  vanity: 'gallery_morning_vanity_setup',
  serum: 'gallery_serum_product_moment',
  story: 'gallery_routine_wrapup_story',
  variant: 'gallery_morning_routine_variant',
} as const;

function output(
  id: string,
  title: string,
  partial: Pick<GalleryOutputRecord, 'outputType' | 'status' | 'outputIndex'> &
    Partial<GalleryOutputRecord>,
): GalleryOutputRecord {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    contentJobRequestId: GALLERY_JOB_REQUEST_ID,
    parentGalleryOutputId: null,
    title,
    mediaStoragePath: `/placeholders/gallery/${id}.svg`,
    thumbnailStoragePath: `/placeholders/gallery/${id}-thumb.svg`,
    durationSeconds: null,
    width: null,
    height: null,
    fileSizeBytes: null,
    mimeType: null,
    metadata: { placeholder: true, provider: null },
    createdBy: 'demo-user',
    createdAt: '2026-09-27T12:00:00.000Z',
    updatedAt: '2026-09-27T12:00:00.000Z',
    ...partial,
  };
}

export const GALLERY_OUTPUTS: GalleryOutputRecord[] = [
  output(OUTPUT_IDS.vanity, 'Morning Vanity Setup', {
    outputType: 'image',
    status: 'approved',
    outputIndex: 1,
    width: 1536,
    height: 1024,
  }),
  output(OUTPUT_IDS.serum, 'Serum Product Moment', {
    outputType: 'video',
    status: 'approved',
    outputIndex: 2,
    durationSeconds: 8,
    width: 1080,
    height: 1920,
  }),
  output(OUTPUT_IDS.story, 'Routine Wrap-up Story', {
    outputType: 'story',
    status: 'rejected',
    outputIndex: 3,
    durationSeconds: 15,
  }),
  output(OUTPUT_IDS.variant, 'Morning Routine Variant', {
    outputType: 'image',
    status: 'draft',
    outputIndex: 4,
    parentGalleryOutputId: OUTPUT_IDS.vanity,
    metadata: {
      placeholder: true,
      provider: null,
      variantNote:
        'Future variant placeholder — derived from “Morning Vanity Setup”. Not a generated media result.',
    },
  }),
];

export const GALLERY_REVIEWS: GalleryOutputReviewRecord[] = [
  {
    id: 'greview_vanity_approved',
    galleryOutputId: OUTPUT_IDS.vanity,
    reviewerId: 'demo-user',
    decision: 'approved',
    feedback: 'Continuity anchors hold — approved for campaign planning.',
    createdAt: '2026-09-27T13:02:00.000Z',
    updatedAt: '2026-09-27T13:02:00.000Z',
  },
  {
    id: 'greview_serum_approved',
    galleryOutputId: OUTPUT_IDS.serum,
    reviewerId: 'demo-user',
    decision: 'approved',
    feedback: 'Matches the approved continuity anchors — good to keep.',
    createdAt: '2026-09-27T13:00:00.000Z',
    updatedAt: '2026-09-27T13:00:00.000Z',
  },
  {
    id: 'greview_story_rejected',
    galleryOutputId: OUTPUT_IDS.story,
    reviewerId: 'demo-user',
    decision: 'rejected',
    feedback: 'Try a clearer product label framing in the closing frame.',
    createdAt: '2026-09-27T13:05:00.000Z',
    updatedAt: '2026-09-27T13:05:00.000Z',
  },
];

export const GALLERY_TAGS: GalleryOutputTagRecord[] = [
  tag('gtag_skincare', 'skincare'),
  tag('gtag_morning', 'morning'),
  tag('gtag_vanity', 'vanity'),
  tag('gtag_product', 'product'),
  tag('gtag_closeup', 'close-up'),
  tag('gtag_story', 'story'),
];

function tag(id: string, name: string): GalleryOutputTagRecord {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    name,
    normalizedName: name.toLowerCase().replace(/\s+/g, '-'),
    createdAt: '2026-09-27T12:00:00.000Z',
  };
}

export const GALLERY_TAG_LINKS: GalleryOutputTagLinkRecord[] = [
  { galleryOutputId: OUTPUT_IDS.vanity, tagId: 'gtag_skincare', createdAt: '2026-09-27T12:00:00.000Z' },
  { galleryOutputId: OUTPUT_IDS.vanity, tagId: 'gtag_morning', createdAt: '2026-09-27T12:00:00.000Z' },
  { galleryOutputId: OUTPUT_IDS.vanity, tagId: 'gtag_vanity', createdAt: '2026-09-27T12:00:00.000Z' },
  { galleryOutputId: OUTPUT_IDS.serum, tagId: 'gtag_product', createdAt: '2026-09-27T12:00:00.000Z' },
  { galleryOutputId: OUTPUT_IDS.serum, tagId: 'gtag_skincare', createdAt: '2026-09-27T12:00:00.000Z' },
  { galleryOutputId: OUTPUT_IDS.serum, tagId: 'gtag_closeup', createdAt: '2026-09-27T12:00:00.000Z' },
  { galleryOutputId: OUTPUT_IDS.story, tagId: 'gtag_story', createdAt: '2026-09-27T12:00:00.000Z' },
  { galleryOutputId: OUTPUT_IDS.story, tagId: 'gtag_skincare', createdAt: '2026-09-27T12:00:00.000Z' },
];

export const GALLERY_COLLECTIONS: GalleryCollectionRecord[] = [
  {
    id: 'gcollection_morning_campaign',
    workspaceId: WORKSPACE_ID,
    name: 'Morning Skincare Campaign',
    description: 'Curated outputs from the Morning Skincare Routine plan.',
    status: 'active',
    createdBy: 'demo-user',
    createdAt: '2026-09-27T14:00:00.000Z',
    updatedAt: '2026-09-27T14:00:00.000Z',
  },
];

export const GALLERY_COLLECTION_ITEMS: GalleryCollectionItemRecord[] = [
  {
    id: 'gcitem_1',
    galleryCollectionId: 'gcollection_morning_campaign',
    galleryOutputId: OUTPUT_IDS.serum, // approved video first
    sortOrder: 0,
    createdAt: '2026-09-27T14:00:00.000Z',
    updatedAt: '2026-09-27T14:00:00.000Z',
  },
  {
    id: 'gcitem_2',
    galleryCollectionId: 'gcollection_morning_campaign',
    galleryOutputId: OUTPUT_IDS.vanity, // ready-for-review image second
    sortOrder: 1,
    createdAt: '2026-09-27T14:00:00.000Z',
    updatedAt: '2026-09-27T14:00:00.000Z',
  },
];

export const GALLERY_EVENTS: GalleryOutputEventRecord[] = [
  {
    id: 'gevent_vanity_created',
    galleryOutputId: OUTPUT_IDS.vanity,
    eventType: 'output_created',
    message: 'Placeholder output registered against the content set job.',
    metadata: { placeholder: true },
    createdAt: '2026-09-27T12:00:00.000Z',
  },
  {
    id: 'gevent_vanity_review',
    galleryOutputId: OUTPUT_IDS.vanity,
    eventType: 'status_changed',
    message: 'Status moved from draft to ready_for_review.',
    metadata: { from: 'draft', to: 'ready_for_review' },
    createdAt: '2026-09-27T12:30:00.000Z',
  },
  {
    id: 'gevent_vanity_approved',
    galleryOutputId: OUTPUT_IDS.vanity,
    eventType: 'approved',
    message: 'Output approved.',
    metadata: { reviewerId: 'demo-user' },
    createdAt: '2026-09-27T13:02:00.000Z',
  },
  {
    id: 'gevent_serum_created',
    galleryOutputId: OUTPUT_IDS.serum,
    eventType: 'output_created',
    message: 'Placeholder output registered against the content set job.',
    metadata: { placeholder: true },
    createdAt: '2026-09-27T12:00:00.000Z',
  },
  {
    id: 'gevent_serum_review',
    galleryOutputId: OUTPUT_IDS.serum,
    eventType: 'review_submitted',
    message: 'Review submitted: approved.',
    metadata: { decision: 'approved' },
    createdAt: '2026-09-27T13:00:00.000Z',
  },
  {
    id: 'gevent_serum_approved',
    galleryOutputId: OUTPUT_IDS.serum,
    eventType: 'approved',
    message: 'Output approved.',
    metadata: { reviewerId: 'demo-user' },
    createdAt: '2026-09-27T13:00:00.000Z',
  },
  {
    id: 'gevent_story_rejected',
    galleryOutputId: OUTPUT_IDS.story,
    eventType: 'rejected',
    message: 'Output rejected with feedback.',
    metadata: { reviewerId: 'demo-user' },
    createdAt: '2026-09-27T13:05:00.000Z',
  },
  {
    id: 'gevent_variant_created',
    galleryOutputId: OUTPUT_IDS.variant,
    eventType: 'output_created',
    message: 'Future variant placeholder created from Morning Vanity Setup.',
    metadata: { placeholder: true, parentGalleryOutputId: OUTPUT_IDS.vanity },
    createdAt: '2026-09-27T12:10:00.000Z',
  },
];

export const SEED_GALLERY_WORKSPACE_ID = WORKSPACE_ID;
export const GALLERY_OUTPUT_SEED_IDS = OUTPUT_IDS;
