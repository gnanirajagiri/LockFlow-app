/**
 * Campaign Publishing Calendar (/campaigns/:campaignId/calendar).
 *
 * Planning-oriented: month/week/agenda views of items + publish-run state.
 * Planning dates NEVER publish — every reschedule touches planning metadata
 * only, with a warning when the item is already in the publishing flow.
 * "Review to publish" routes into the Prompt 19 review/confirm workflow.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { GalleryIcon } from '../../components/icons';
import type { CampaignContextValue } from '../campaigns/CampaignLayout';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type { CampaignPublishingTimeline, TimelineEntry } from '../../domain/publishingOps';
import { OPS_STATE_LABELS, OPS_STATE_TONES, formatDateTime } from './opsUi';
import { usePublishingOpsService } from './usePublishingOpsService';

const USER_ID = 'demo-user';

type ViewMode = 'month' | 'week' | 'agenda';

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

export function CampaignPublishingCalendarPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { campaign } = useOutletContext<CampaignContextValue>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const ops = usePublishingOpsService();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<CampaignPublishingTimeline | null>(null);
  const [view, setView] = useState<ViewMode>('month');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [channelFilter, setChannelFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [selected, setSelected] = useState<TimelineEntry | null>(null);
  const [moving, setMoving] = useState<TimelineEntry | null>(null);
  const [moveDate, setMoveDate] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    try {
      setTimeline(await ops.getCampaignPublishingTimeline(SEED_GALLERY_WORKSPACE_ID, campaignId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the publishing calendar.');
    } finally {
      setLoading(false);
    }
  }, [ops, campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = useMemo(() => {
    let rows = timeline?.entries ?? [];
    if (channelFilter !== 'all') rows = rows.filter((e) => e.channel === channelFilter);
    if (stateFilter !== 'all') rows = rows.filter((e) => e.publishingState === stateFilter);
    return rows;
  }, [timeline, channelFilter, stateFilter]);

  const channels = useMemo(
    () => [...new Set((timeline?.entries ?? []).map((e) => e.channel).filter(Boolean))] as string[],
    [timeline],
  );
  const states = useMemo(
    () => [...new Set((timeline?.entries ?? []).map((e) => e.publishingState))],
    [timeline],
  );

  const days = useMemo(() => {
    const result: Date[] = [];
    if (view === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const gridStart = startOfWeek(first);
      for (let i = 0; i < 42; i += 1) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        result.push(d);
      }
    } else if (view === 'week') {
      const gridStart = startOfWeek(anchor);
      for (let i = 0; i < 7; i += 1) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        result.push(d);
      }
    }
    return result;
  }, [view, anchor]);

  const entriesForDay = useCallback(
    (d: Date) => entries.filter((e) => e.plannedPublishAt && dateKey(new Date(e.plannedPublishAt)) === dateKey(d)),
    [entries],
  );

  const agenda = useMemo(
    () =>
      [...entries]
        .filter((e) => e.plannedPublishAt)
        .sort((a, b) => (a.plannedPublishAt! < b.plannedPublishAt! ? -1 : 1)),
    [entries],
  );

  async function handleMove() {
    if (!moving || !moveDate) return;
    setBusy(true);
    try {
      const previous = moving.plannedPublishAt ? new Date(moving.plannedPublishAt) : null;
      const next = new Date(`${moveDate}T00:00:00`);
      if (previous) next.setHours(previous.getHours(), previous.getMinutes(), 0, 0);
      const result = await ops.updateCampaignItemPlanningDate(
        SEED_GALLERY_WORKSPACE_ID,
        moving.campaignItemId,
        next.toISOString(),
        null,
        { actorId: USER_ID, campaignId },
      );
      toast({
        title: result.warning ?? 'Planning date updated — internal planning only, nothing publishes.',
        tone: result.warning ? 'warning' : 'success',
      });
      setMoving(null);
      setSelected(null);
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not move the item.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  function openMove(entry: TimelineEntry) {
    setMoving(entry);
    setMoveDate(entry.plannedPublishAt ? dateKey(new Date(entry.plannedPublishAt)) : dateKey(new Date()));
  }

  const readOnly = campaign.status === 'archived';
  const inFlight = selected
    ? ['queued', 'submitting', 'submitted', 'published', 'failed', 'retry_required'].includes(selected.publishingState)
    : false;

  return (
    <div>
      <PageHeader
        title="Publishing calendar"
        description="Planning targets only — arriving dates never publish anything. Publishing stays an explicit, confirmed action."
        actions={
          <Button variant="ghost" onClick={() => navigate(`/campaigns/${campaignId}/status`)}>
            Status overview
          </Button>
        }
      />

      <Card>
        <CardBody>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="lf-input" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} aria-label="Filter by channel" style={{ maxWidth: 170 }}>
                <option value="all">All channels</option>
                {channels.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select className="lf-input" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} aria-label="Filter by publishing state" style={{ maxWidth: 190 }}>
                <option value="all">All states</option>
                {states.map((s) => (
                  <option key={s} value={s}>{OPS_STATE_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div className="lf-viewtoggle" role="group" aria-label="Calendar view">
              {(['month', 'week', 'agenda'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`lf-viewtoggle__btn${view === mode ? ' lf-viewtoggle__btn--active' : ''}`}
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                >
                  {mode === 'month' ? 'Month' : mode === 'week' ? 'Week' : 'Agenda'}
                </button>
              ))}
            </div>
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 12, color: '#64748b' }}>
            Planning-only: these dates organise the team. No post is created, queued or sent because a date arrives.
          </p>
        </CardBody>
      </Card>

      {loading ? (
        <Skeleton height={320} />
      ) : error ? (
        <EmptyState icon={<GalleryIcon size={22} />} title="Could not load the calendar" description={error} actions={<Button onClick={() => void load()}>Try again</Button>} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<GalleryIcon size={22} />}
          title="Nothing planned yet"
          description="Add planned dates from the campaign content tab, then arrange them here."
          actions={<Button onClick={() => navigate(`/campaigns/${campaignId}/content`)}>Open content</Button>}
        />
      ) : view === 'agenda' ? (
        <Card style={{ marginTop: 16 }}>
          <CardBody>
            <div role="list">
              {agenda.map((entry) => (
                <button
                  key={entry.campaignItemId}
                  type="button"
                  role="listitem"
                  onClick={() => setSelected(entry)}
                  style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', textAlign: 'left', background: 'none', border: 0, borderTop: '1px solid #e2e8f0', padding: '10px 0', cursor: 'pointer' }}
                >
                  <GalleryIcon size={16} />
                  <strong>{entry.title}</strong>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{formatDateTime(entry.plannedPublishAt)}</span>
                  <span style={{ fontSize: 12 }}>{entry.channel ?? 'No channel'}</span>
                  {entry.accountLabel && <span style={{ fontSize: 12, color: '#64748b' }}>{entry.accountLabel}</span>}
                  <Badge tone={OPS_STATE_TONES[entry.publishingState]} dot>
                    {OPS_STATE_LABELS[entry.publishingState]}
                  </Badge>
                </button>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="lf-dialogactions" style={{ justifyContent: 'space-between', marginTop: 16 }}>
            <Button
              size="sm"
              onClick={() => {
                const next = new Date(anchor);
                if (view === 'month') next.setMonth(next.getMonth() - 1);
                else next.setDate(next.getDate() - 7);
                setAnchor(next);
              }}
            >
              ← Previous
            </Button>
            <strong>{anchor.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</strong>
            <Button
              size="sm"
              onClick={() => {
                const next = new Date(anchor);
                if (view === 'month') next.setMonth(next.getMonth() + 1);
                else next.setDate(next.getDate() + 7);
                setAnchor(next);
              }}
            >
              Next →
            </Button>
          </div>
          <div
            className={`lf-campaign-calendar lf-campaign-calendar--${view}`}
            role="grid"
            aria-label={`Publishing calendar, ${view} view`}
            style={{ marginTop: 10 }}
          >
            {days.map((d) => {
              const dayEntries = entriesForDay(d);
              const isToday = dateKey(d) === dateKey(new Date());
              return (
                <div
                  key={d.toISOString()}
                  className={`lf-campaign-day${isToday ? ' lf-campaign-day--today' : ''}`}
                  role="gridcell"
                  aria-label={`${d.toDateString()}${dayEntries.length > 0 ? `, ${dayEntries.length} item${dayEntries.length === 1 ? '' : 's'}` : ''}`}
                >
                  <span className="lf-campaign-day__num">{d.getDate()}</span>
                  {dayEntries.map((entry) => (
                    <button
                      key={entry.campaignItemId}
                      type="button"
                      className="lf-campaign-day__entry"
                      onClick={() => setSelected(entry)}
                      title={`${entry.title} — ${OPS_STATE_LABELS[entry.publishingState]}`}
                    >
                      <GalleryIcon size={12} />
                      <span>
                        {entry.plannedPublishAt ? new Date(entry.plannedPublishAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''} {entry.title}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Detail drawer */}
      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title ?? 'Item'}
        description="Readiness and next allowed action. Nothing publishes from this screen."
        size="md"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setSelected(null)}>Close</Button>
            {selected?.publishingState === 'failed' && selected.latestRunId && (
              <Button onClick={() => navigate(`/campaigns/${campaignId}/publish-runs/${selected.latestRunId}`)}>
                Inspect failed run
              </Button>
            )}
            <Button
              variant="primary"
              disabled={readOnly}
              onClick={() => navigate(`/campaigns/${campaignId}/publishing-review?item=${selected?.campaignItemId ?? ''}`)}
            >
              Review to publish
            </Button>
          </div>
        }
      >
        {selected && (
          <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Badge tone={OPS_STATE_TONES[selected.publishingState]} dot>
                {OPS_STATE_LABELS[selected.publishingState]}
              </Badge>
              {selected.failureCategory && <Badge tone="danger">{selected.failureCategory.replaceAll('_', ' ').toLowerCase()}</Badge>}
            </div>
            <p style={{ margin: 0 }}>Channel: <strong>{selected.channel ?? 'Not assigned'}</strong></p>
            <p style={{ margin: 0 }}>Account: <strong>{selected.accountLabel ?? 'None'}</strong></p>
            <p style={{ margin: 0 }}>Planned: <strong>{formatDateTime(selected.plannedPublishAt)}</strong> (planning only)</p>
            <p style={{ margin: 0 }}>Media: <strong>{selected.mediaType}</strong> · placement: <strong>{selected.placement ?? '—'}</strong></p>
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>
              <strong>Readiness checklist</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                <li>{selected.channel ? '✅ Channel assigned' : '⚠️ Channel not assigned'}</li>
                <li>{selected.itemStatus !== 'blocked' ? '✅ Item active' : '⚠️ Item blocked'}</li>
                <li>{selected.latestRunId ? `↻ Latest attempt #${selected.latestAttemptNumber}` : '⬚ Not submitted yet'}</li>
              </ul>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="sm" disabled={readOnly} onClick={() => openMove(selected)}>
                Move planning date
              </Button>
            </div>
            {inFlight && (
              <p style={{ margin: 0, fontSize: 12, color: '#b45309' }}>
                This item already has publishing activity. Moving the planning date does not change, cancel or re-send any run.
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Reschedule modal — planning metadata only */}
      <Modal
        open={moving !== null}
        onClose={() => setMoving(null)}
        title="Move planning date"
        description="Updates the internal planning date only. No publish run is created or changed."
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setMoving(null)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !moveDate} onClick={() => void handleMove()}>
              Move item
            </Button>
          </div>
        }
      >
        {moving && (
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="ops-move-date">Planned for</label>
            <input
              id="ops-move-date"
              className="lf-input"
              type="date"
              value={moveDate}
              onChange={(e) => setMoveDate(e.target.value)}
            />
            <p className="lf-field__help">
              Planning metadata only — this never triggers publishing and never touches a publish run.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
