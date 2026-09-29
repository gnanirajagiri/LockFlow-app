/**
 * Campaign calendar tab — internal planning calendar.
 *
 * Views: month grid, week grid and agenda list. Entries show type, channel,
 * format, planned time and status. Date moves update ONLY the item's
 * planning date via the service. No "scheduled to platform" wording — all
 * entries are "Planned for", and a standing note explains publishing is not
 * configured.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { GalleryIcon } from '../../components/icons';
import type { CampaignContextValue } from './CampaignLayout';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type { CampaignItemRecord } from '../../domain/campaigns';
import {
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_ITEM_FORMAT_LABELS,
  CAMPAIGN_ITEM_STATUS_LABELS,
  CAMPAIGN_ITEM_STATUS_TONE,
} from './campaignsUi';

type ViewMode = 'month' | 'week' | 'agenda';

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7)); // Monday-first
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function CampaignCalendarTab() {
  const { service, campaign } = useOutletContext<CampaignContextValue>();
  const { toast } = useToast();
  const readOnly = campaign.status === 'archived';

  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('month');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [items, setItems] = useState<CampaignItemRecord[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [moving, setMoving] = useState<CampaignItemRecord | null>(null);
  const [moveDate, setMoveDate] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await service.getCampaignDetail(campaign.id, SEED_GALLERY_WORKSPACE_ID);
      const active = d.items.filter((i) => i.status !== 'removed' && !i.removedAt);
      setItems(active);
      const titleMap: Record<string, string> = {};
      for (const w of d.itemsWithOutputs) {
        if (w.output) titleMap[w.item.id] = w.output.title;
      }
      setTitles(titleMap);
    } finally {
      setLoading(false);
    }
  }, [service, campaign.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const dated = useMemo(() => items.filter((i) => i.plannedPublishAt !== null), [items]);

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

  const itemsForDay = useCallback(
    (d: Date) =>
      dated.filter((item) => {
        const key = dateKey(new Date(item.plannedPublishAt as string));
        return key === dateKey(d);
      }),
    [dated],
  );

  const agenda = useMemo(
    () =>
      [...dated].sort(
        (a, b) => Date.parse(a.plannedPublishAt as string) - Date.parse(b.plannedPublishAt as string),
      ),
    [dated],
  );

  async function handleMove() {
    if (!moving || !moveDate) return;
    setBusy(true);
    try {
      // Preserve the original time-of-day when only the date changes.
      const previous = moving.plannedPublishAt ? new Date(moving.plannedPublishAt) : null;
      const next = new Date(`${moveDate}T00:00:00`);
      if (previous) next.setHours(previous.getHours(), previous.getMinutes(), 0, 0);
      await service.updateItemPlannedDate(moving.id, campaign.id, next.toISOString(), SEED_GALLERY_WORKSPACE_ID);
      toast({ title: 'Planned date updated (internal campaign planning only).', tone: 'success' });
      setMoving(null);
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not move the item.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  function openMove(item: CampaignItemRecord) {
    setMoving(item);
    setMoveDate(item.plannedPublishAt ? dateKey(new Date(item.plannedPublishAt)) : dateKey(new Date()));
  }

  const formatTime = (value: string) =>
    new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <div>
      <div className="lf-dialogactions" style={{ justifyContent: 'space-between' }}>
        <p className="lf-tile__description" style={{ margin: 0 }}>
          Dates here are internal campaign planning dates until account connections are enabled.
        </p>
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

      {loading ? (
        <Skeleton height={320} />
      ) : dated.length === 0 ? (
        <EmptyState
          icon={<GalleryIcon size={22} />}
          title="Plan when each approved output should go live."
          description="Dates here are internal campaign planning dates until account connections are enabled. Add planned dates from the Content tab, then arrange them here."
        />
      ) : view === 'agenda' ? (
        <div role="list">
          {agenda.map((item) => (
            <div key={item.id} className="lf-campaign-agendarow" role="listitem">
              <GalleryIcon size={18} />
              <strong>{titles[item.id] ?? 'Gallery output'}</strong>
              <span>Planned for {formatTime(item.plannedPublishAt as string)}</span>
              <Badge tone={CAMPAIGN_ITEM_STATUS_TONE[item.status]} dot>
                {CAMPAIGN_ITEM_STATUS_LABELS[item.status]}
              </Badge>
              <span className="lf-tile__description">
                {item.plannedChannel ? CAMPAIGN_CHANNEL_LABELS[item.plannedChannel] ?? item.plannedChannel : 'No channel'}
                {item.plannedFormat ? ` · ${CAMPAIGN_ITEM_FORMAT_LABELS[item.plannedFormat]}` : ''}
              </span>
              <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => openMove(item)}>
                Move date
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="lf-dialogactions" style={{ justifyContent: 'space-between' }}>
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
            aria-label={`Campaign planning calendar, ${view} view`}
          >
            {days.map((d) => {
              const dayItems = itemsForDay(d);
              const isToday = dateKey(d) === dateKey(new Date());
              return (
                <div
                  key={d.toISOString()}
                  className={`lf-campaign-day${isToday ? ' lf-campaign-day--today' : ''}`}
                  role="gridcell"
                  aria-label={`${d.toDateString()}${dayItems.length > 0 ? `, ${dayItems.length} planned item${dayItems.length === 1 ? '' : 's'}` : ''}`}
                >
                  <span className="lf-campaign-day__num">{d.getDate()}</span>
                  {dayItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="lf-campaign-day__entry"
                      disabled={readOnly}
                      onClick={() => openMove(item)}
                      title="Move to a new planning date"
                    >
                      <GalleryIcon size={12} />
                      <span>
                        {formatTime(item.plannedPublishAt as string)} {titles[item.id] ?? 'Output'}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}

      <Modal
        open={moving !== null}
        onClose={() => setMoving(null)}
        title="Move planned date"
        description="Publishing connections are not configured yet."
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
        {moving ? (
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="move-date">Planned for</label>
            <input
              id="move-date"
              className="lf-input"
              type="date"
              value={moveDate}
              onChange={(e) => setMoveDate(e.target.value)}
            />
            <p className="lf-field__help">
              Updates this item's planning date only. No external scheduling, posts or provider calls happen.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
