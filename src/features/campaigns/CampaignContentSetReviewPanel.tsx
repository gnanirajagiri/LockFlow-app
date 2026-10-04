/**
 * Campaign content-set review panel — prompt 30.
 *
 * The formal decision layer between generation (prompt 29) and campaign
 * execution. One coordinated content set (a campaign generation run) is
 * reviewed as a package: outputs are approved / rejected / shortlisted,
 * curated into a final selection and handed off into this campaign as
 * controlled references.
 *
 * Rules kept honest here:
 *   * Outputs stay in Gallery — handoff links, never copies (Library is
 *     untouched); the confirm dialog says so explicitly.
 *   * Only approved outputs reach handoff; rejected/pending are blocked
 *     server-side and shown as blocked, never silently skipped.
 *   * Story frames keep their group/sequence ordering in review, selection
 *     and handoff.
 *   * Selection/handoff is disabled for archived (read-only) campaigns.
 *
 * This component talks ONLY to the OutputReviewService — never providers,
 * never Storage, never the Library.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { GalleryIcon, LockIcon } from '../../components/icons';
import { OutputReviewService } from '../../generation/outputReviewService';
import type { OutputReviewDependencies } from '../../generation/outputReviewService';
import {
  GENERATED_OUTPUT_REVIEW_LABELS,
} from '../../generation/outputReviewWorkflow';
import type {
  GeneratedOutputReviewAction,
  GeneratedOutputReviewStatus,
  SetReviewOutputView,
} from '../../generation/outputReviewWorkflow';
import type { CampaignGenerationRunRecord } from '../../generation/campaignRunService';
import { getRunStore, getReviewStore } from './campaignRunStore';
import { getGalleryService, getCampaignsService } from './campaignServiceRefs';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import { CAMPAIGN_CHANNEL_KEYS } from '../../domain/campaigns';
import { CAMPAIGN_CHANNEL_LABELS } from './campaignsUi';
import type { GalleryOutputRecord } from '../../domain/gallery/types';

const ACTOR = 'demo-user';

const REVIEW_TONE: Record<GeneratedOutputReviewStatus, 'neutral' | 'success' | 'danger' | 'warning' | 'primary'> = {
  pending_review: 'neutral',
  approved: 'success',
  rejected: 'danger',
  shortlisted: 'warning',
  selected_for_campaign: 'primary',
  handed_off: 'primary',
};

/** Media-type groups for the coordinated set view. */
const MEDIA_GROUPS: Array<{ key: 'image' | 'video' | 'story'; label: string }> = [
  { key: 'image', label: 'Images' },
  { key: 'video', label: 'Videos' },
  { key: 'story', label: 'Stories' },
];

function groupTitle(run: CampaignGenerationRunRecord | null): string {
  if (!run) return 'Generated content set';
  const completed = run.completedJobsCount;
  const total = run.totalJobsCount;
  return `Generated content set — ${completed}/${total} jobs completed`;
}

/** Story label like "Frame 1 of 2 — Opening" (prompt-28 provenance). */
function storyLabel(view: SetReviewOutputView): string | null {  if (!view.storyGroupKey) return null;
  const seq = view.storySequence ?? 0;
  const total = view.storySequenceTotal ?? 0;
  const frame = view.storyFrameLabel ? ` — ${view.storyFrameLabel}` : '';
  return `Frame ${seq} of ${total}${frame}`;
}

export function CampaignContentSetReviewPanel({ campaignId, readOnly }: { campaignId: string; readOnly: boolean }) {
  const { toast } = useToast();

  // ── Service wiring (existing seams only) ───────────────────────────────────
  const service = useMemo(() => {
    const gallery = getGalleryService();
    const campaigns = getCampaignsService();
    const deps: OutputReviewDependencies = {
      // Handoff creates the campaign item through the EXISTING campaign rules
      // (approved status, workspace, provenance re-validated server-side).
      addCampaignItem: (input) =>
        campaigns.addItem(
          {
            campaignId: input.campaignId,
            galleryOutputId: input.galleryOutputId,
            plannedChannel: input.plannedChannel ?? null,
            plannedFormat: null,
            captionDraft: input.captionDraft,
            notes: input.notes,
          },
          input.createdBy,
          input.workspaceId,
        ),
      // Approving a review flips the Gallery output itself, so the existing
      // campaign/publishing eligibility rules keep working unchanged.
      approveGalleryOutput: (outputId, workspaceId) => gallery.transitionOutput(outputId, 'approved', workspaceId),
    };
    return new OutputReviewService(getReviewStore(), deps);
  }, []);

  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState<CampaignGenerationRunRecord | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof service.getGeneratedSetReviewDetail>> | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | GeneratedOutputReviewStatus>('all');
  const [busy, setBusy] = useState(false);

  // Selection state
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [selectionItems, setSelectionItems] = useState<string[]>([]);
  const [selectionName, setSelectionName] = useState('');

  // Handoff state
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffChannel, setHandoffChannel] = useState('');
  const [handoffBlocked, setHandoffBlocked] = useState<string[]>([]);
  const [handoffResult, setHandoffResult] = useState<{ linked: number; blocked: string[] } | null>(null);

  /** Seeds run-stamped Gallery outputs into the review store (idempotent). */
  const seedOutputsForRun = useCallback(
    async (runRecord: CampaignGenerationRunRecord | null): Promise<boolean> => {
      if (!runRecord) return false;
      const gallery = getGalleryService();
      const store = getReviewStore();
      const all = await gallery.listOutputs(SEED_GALLERY_WORKSPACE_ID);
      // Only outputs explicitly stamped with this run's id (ingestion stamps
      // the provenance; nothing is guessed from titles or partial ids).
      const resolved = all.filter(
        (output) =>
          output.workspaceId === SEED_GALLERY_WORKSPACE_ID
          && (output.metadata as Record<string, unknown> | null)?.['campaign_generation_run_id'] === runRecord.id,
      );
      if (resolved.length === 0) return false;
      const known = new Set(
        (await store.listWorkspaceOutputs(SEED_GALLERY_WORKSPACE_ID)).map((o) => o.id),
      );
      const fresh = resolved.filter((o) => !known.has(o.id));
      if (fresh.length > 0) store.seedOutputs(fresh);
      return true;
    },
    [],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const runs = await getRunStore().listRuns(SEED_GALLERY_WORKSPACE_ID);
      const latest = runs.find((candidate) => candidate.campaignId === campaignId) ?? null;
      setRun(latest);
      if (latest) {
        await seedOutputsForRun(latest);
        setDetail(await service.getGeneratedSetReviewDetail(SEED_GALLERY_WORKSPACE_ID, latest.id));
      } else {
        setDetail(null);
      }
      if (selectionId) {
        const items = await service.listSelectionItems(SEED_GALLERY_WORKSPACE_ID, selectionId);
        setSelectionItems(items.map((item) => item.galleryOutputId));
      }
    } finally {
      setLoading(false);
    }
  }, [service, campaignId, seedOutputsForRun, selectionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const views = detail?.outputs ?? [];
  const counts = detail?.counts ?? { approved: 0, rejected: 0, shortlisted: 0, pending: 0, handedOff: 0 };

  const visibleViews = useMemo(
    () => (statusFilter === 'all' ? views : views.filter((view) => view.review.reviewStatus === statusFilter)),
    [views, statusFilter],
  );

  function labelFor(output: GalleryOutputRecord): string {
    return output.title;
  }

  async function handleReview(outputId: string, action: GeneratedOutputReviewAction, notes?: string) {
    if (busy || readOnly) return;
    setBusy(true);
    try {
      await service.reviewGeneratedOutput(SEED_GALLERY_WORKSPACE_ID, outputId, action, {
        reviewerId: ACTOR,
        ...(notes ? { notes } : {}),
      });
      if (action === 'approve') toast({ title: 'Output approved.', tone: 'success' });
      if (action === 'reject') toast({ title: 'Output rejected — it stays inspectable but is blocked from handoff.', tone: 'success' });
      if (action === 'shortlist') toast({ title: 'Output shortlisted as a preferred pick.', tone: 'success' });
      if (action === 'unshortlist') toast({ title: 'Output moved back to approved.', tone: 'success' });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Review action failed.', tone: 'error' });
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function handleCreateSelection() {
    if (busy) return;
    setBusy(true);
    try {
      const selection = await service.createGeneratedOutputSelection(SEED_GALLERY_WORKSPACE_ID, {
        name: selectionName.trim() || undefined,
        campaignGenerationRunId: run?.id ?? null,
        createdBy: ACTOR,
      });
      setSelectionId(selection.id);
      setSelectionItems([]);
      setSelectionName('');
      toast({ title: 'Final picks selection created. Add approved outputs to it.', tone: 'success' });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not create the selection.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleAddToSelection(outputId: string) {
    if (!selectionId || busy) return;
    setBusy(true);
    try {
      await service.addOutputToSelection(SEED_GALLERY_WORKSPACE_ID, selectionId, outputId, { actorId: ACTOR });
      const items = await service.listSelectionItems(SEED_GALLERY_WORKSPACE_ID, selectionId);
      setSelectionItems(items.map((item) => item.galleryOutputId));
      toast({ title: 'Added to final picks.', tone: 'success' });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not add to the selection.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveFromSelection(outputId: string) {
    if (!selectionId || busy) return;
    setBusy(true);
    try {
      await service.removeOutputFromSelection(SEED_GALLERY_WORKSPACE_ID, selectionId, outputId, ACTOR);
      const items = await service.listSelectionItems(SEED_GALLERY_WORKSPACE_ID, selectionId);
      setSelectionItems(items.map((item) => item.galleryOutputId));
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not update the selection.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleReorder(outputId: string, direction: -1 | 1) {
    if (!selectionId || busy) return;
    const index = selectionItems.indexOf(outputId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= selectionItems.length) return;
    const ordered = [...selectionItems];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved);
    setBusy(true);
    try {
      await service.reorderSelectionItems(SEED_GALLERY_WORKSPACE_ID, selectionId, ordered, ACTOR);
      setSelectionItems(ordered);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not reorder the selection.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleHandoff() {
    if (!selectionId || busy || selectionItems.length === 0) return;
    setBusy(true);
    setHandoffBlocked([]);
    setHandoffResult(null);
    try {
      const result = await service.handoffOutputsToCampaign(SEED_GALLERY_WORKSPACE_ID, {
        campaignId,
        galleryOutputIds: selectionItems,
        plannedChannel: handoffChannel || undefined,
        actorId: ACTOR,
      });
      setHandoffResult({ linked: result.items.length, blocked: result.blocked });
      setHandoffBlocked(result.blocked);
      if (result.items.length > 0) {
        toast({
          title: `${result.items.length} output${result.items.length === 1 ? '' : 's'} handed off to the campaign.`,
          description: 'Outputs remain Gallery assets, now linked as campaign content.',
          tone: 'success',
        });
      }
      if (result.blocked.length > 0) {
        toast({ title: `${result.blocked.length} output(s) were blocked from handoff.`, tone: 'error' });
      }
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Handoff failed.', tone: 'error' });
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const handoffCandidates = selectionItems.filter((outputId) => {
    const view = views.find((candidate) => candidate.galleryOutput.id === outputId);
    return view && ['approved', 'shortlisted', 'selected_for_campaign'].includes(view.review.reviewStatus);
  });

  return (
    <Card>
      <CardBody>
        <h3 className="lf-envpanel__heading">Review generated content set</h3>
        <p className="lf-tile__description">
          Approve, reject or shortlist outputs from the coordinated set, curate final picks and hand
          approved content into this campaign. Outputs stay in Gallery — campaigns link, never copy.
        </p>

        {loading ? (
          <Skeleton height={140} />
        ) : !detail || views.length === 0 ? (
          <EmptyState
            icon={<GalleryIcon size={22} />}
            title="No generated set to review yet"
            description="Generate a full content set above — its outputs will appear here for coordinated review."
          />
        ) : (
          <>
            {/* Counts + filters */}
            <div className="lf-envcard__badges" style={{ marginTop: 'var(--lf-space-3)', gap: 'var(--lf-space-2)' }}>
              <Badge tone="primary" dot>{groupTitle(run)}</Badge>
              <Badge tone="success">{counts.approved} approved</Badge>
              <Badge tone="warning">{counts.shortlisted} shortlisted</Badge>
              <Badge tone="danger">{counts.rejected} rejected</Badge>
              <Badge tone="neutral">{counts.pending} pending</Badge>
              {counts.handedOff > 0 ? <Badge tone="primary">{counts.handedOff} handed off</Badge> : null}
            </div>
            <div className="lf-models-toolbar" role="group" aria-label="Review filters" style={{ marginTop: 'var(--lf-space-2)' }}>
              <div className="lf-models-toolbar__filter">
                <label className="lf-field__label" htmlFor="review-status-filter">Status</label>
                <select
                  id="review-status-filter"
                  className="lf-input"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                >
                  <option value="all">All statuses</option>
                  {(Object.keys(GENERATED_OUTPUT_REVIEW_LABELS) as GeneratedOutputReviewStatus[]).map((status) => (
                    <option key={status} value={status}>{GENERATED_OUTPUT_REVIEW_LABELS[status]}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Grouped by media type, story order preserved */}
            {MEDIA_GROUPS.map((group) => {
              const groupViews = visibleViews.filter((view) => view.galleryOutput.outputType === group.key);
              if (groupViews.length === 0) return null;
              return (
                <div key={group.key} className="lf-sheet__section" style={{ marginTop: 'var(--lf-space-3)' }}>
                  <h4 style={{ margin: '0 0 var(--lf-space-2)' }}>
                    {group.label} <span className="lf-tile__description">({groupViews.length})</span>
                  </h4>
                  <ul className="lf-sheet__trait-list" style={{ margin: 0 }}>
                    {groupViews.map((view) => {
                      const output = view.galleryOutput;
                      const status = view.review.reviewStatus;
                      const inSelection = selectionItems.includes(output.id);
                      const selectionIndex = selectionItems.indexOf(output.id);
                      return (
                        <li key={output.id} className="lf-sheet__trait-row">
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="lf-envcard__title" style={{ flexWrap: 'wrap' }}>
                              <strong>{labelFor(output)}</strong>
                              <Badge tone={REVIEW_TONE[status]} dot>{GENERATED_OUTPUT_REVIEW_LABELS[status]}</Badge>
                              {storyLabel(view) ? <Badge tone="neutral">{storyLabel(view)}</Badge> : null}
                            </div>
                            {view.review.reviewNotes ? (
                              <p className="lf-tile__description" style={{ margin: '2px 0 0' }}>Notes: {view.review.reviewNotes}</p>
                            ) : null}
                          </div>
                          <div className="lf-campaign-item__actions" style={{ flexWrap: 'wrap' }}>
                            {!readOnly ? (
                              <>
                                <Button size="sm" disabled={busy || status === 'approved'} onClick={() => void handleReview(output.id, 'approve')}>
                                  Approve
                                </Button>
                                <Button size="sm" variant="ghost" disabled={busy || status === 'rejected'} onClick={() => void handleReview(output.id, 'reject')}>
                                  Reject
                                </Button>
                                {status === 'approved' ? (
                                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleReview(output.id, 'shortlist')}>
                                    Shortlist
                                  </Button>
                                ) : null}
                                {status === 'shortlisted' ? (
                                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleReview(output.id, 'unshortlist')}>
                                    Unshortlist
                                  </Button>
                                ) : null}
                                {status !== 'rejected' && status !== 'pending_review' && !inSelection ? (
                                  <Button size="sm" variant="secondary" disabled={busy || !selectionId} onClick={() => void handleAddToSelection(output.id)}>
                                    Add to picks
                                  </Button>
                                  ) : null}
                                {inSelection ? (
                                  <>
                                    <Badge tone="primary">Pick #{selectionIndex + 1}</Badge>
                                    <Button size="sm" variant="ghost" disabled={selectionIndex === 0 || busy} onClick={() => void handleReorder(output.id, -1)}>
                                      ↑ <span className="lf-visually-hidden">Move up</span>
                                    </Button>
                                    <Button size="sm" variant="ghost" disabled={selectionIndex === selectionItems.length - 1 || busy} onClick={() => void handleReorder(output.id, 1)}>
                                      ↓ <span className="lf-visually-hidden">Move down</span>
                                    </Button>
                                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleRemoveFromSelection(output.id)}>
                                      Remove
                                    </Button>
                                  </>
                                ) : null}
                              </>
                            ) : (
                              <Badge tone={REVIEW_TONE[status]} dot>{GENERATED_OUTPUT_REVIEW_LABELS[status]}</Badge>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}

            {/* Final picks / selection */}
            {!readOnly ? (
              <div className="lf-sheet__section" style={{ marginTop: 'var(--lf-space-4)' }}>
                <h4 style={{ margin: '0 0 var(--lf-space-2)' }}>Final picks for this campaign</h4>
                {selectionId ? (
                  <>
                    <p className="lf-tile__description">
                      {selectionItems.length} output{selectionItems.length === 1 ? '' : 's'} curated — order is
                      preserved for story grouping. {handoffCandidates.length} approved
                      {handoffCandidates.length === 1 ? '' : ' output'} ready for handoff.
                    </p>
                    <div className="lf-dialogactions" style={{ justifyContent: 'flex-start', marginTop: 'var(--lf-space-2)' }}>
                      <Button variant="primary" disabled={busy || handoffCandidates.length === 0} onClick={() => setHandoffOpen(true)}>
                        Hand {handoffCandidates.length} approved output{handoffCandidates.length === 1 ? '' : 's'} into campaign
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
                    <input
                      className="lf-input"
                      style={{ maxWidth: 280 }}
                      placeholder="Selection name (optional)"
                      maxLength={120}
                      value={selectionName}
                      onChange={(event) => setSelectionName(event.target.value)}
                      aria-label="Selection name"
                    />
                    <Button variant="secondary" disabled={busy} onClick={() => void handleCreateSelection()}>
                      Create final picks selection
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </CardBody>

      {/* ── Handoff confirmation ─────────────────────────────────────────── */}
      <Modal
        open={handoffOpen}
        onClose={() => { setHandoffOpen(false); setHandoffResult(null); setHandoffBlocked([]); }}
        title="Hand approved outputs into campaign"
        description="Links approved Gallery outputs to this campaign as planned content. Nothing is published and nothing is copied."
        size="lg"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => { setHandoffOpen(false); setHandoffResult(null); setHandoffBlocked([]); }}>Close</Button>
            {!handoffResult ? (
              <Button variant="primary" disabled={busy || handoffCandidates.length === 0} onClick={() => void handleHandoff()}>
                {busy ? 'Handing off…' : `Hand off ${handoffCandidates.length} output${handoffCandidates.length === 1 ? '' : 's'}`}
              </Button>
            ) : null}
          </div>
        }
      >
        <p className="lf-tile__description">
          <LockIcon size={12} /> Outputs remain Gallery assets with campaign linkage — they are never
          duplicated into the Library and never auto-published. Publishing stays a separate, explicit
          step in the campaign workflow.
        </p>
        <ul className="lf-sheet__trait-list" style={{ margin: 'var(--lf-space-2) 0' }}>
          {handoffCandidates.map((outputId) => {
            const view = views.find((candidate) => candidate.galleryOutput.id === outputId);
            if (!view) return null;
            return (
              <li key={outputId} className="lf-sheet__trait-row">
                <span className="lf-sheet__trait-key">{view.galleryOutput.title}</span>
                <span className="lf-sheet__trait-value">{GENERATED_OUTPUT_REVIEW_LABELS[view.review.reviewStatus]}</span>
              </li>
            );
          })}
        </ul>
        <div className="lf-field" style={{ marginTop: 'var(--lf-space-2)' }}>
          <label className="lf-field__label" htmlFor="handoff-channel">Planned channel (optional)</label>
          <select
            id="handoff-channel"
            className="lf-input"
            value={handoffChannel}
            onChange={(event) => setHandoffChannel(event.target.value)}
          >
            <option value="">No channel yet</option>
            {CAMPAIGN_CHANNEL_KEYS.map((key) => (
              <option key={key} value={key}>{CAMPAIGN_CHANNEL_LABELS[key] ?? key}</option>
            ))}
          </select>
        </div>
        {handoffBlocked.length > 0 ? (
          <div role="alert" style={{ marginTop: 'var(--lf-space-2)' }}>
            <Badge tone="danger" dot>Blocked outputs</Badge>
            <ul className="lf-sheet__trait-list" style={{ marginTop: 'var(--lf-space-1)' }}>
              {handoffBlocked.map((reason) => (
                <li key={reason} className="lf-sheet__trait-row">{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {handoffResult ? (
          <p className="lf-library__note" style={{ marginTop: 'var(--lf-space-2)' }}>
            Handed off {handoffResult.linked} output(s). Campaign items now reference these Gallery
            outputs with full traceability back to their generation run.
          </p>
        ) : null}
      </Modal>
    </Card>
  );
}
