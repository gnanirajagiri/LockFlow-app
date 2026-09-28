/**
 * Corrections list (/corrections).
 *
 * Workspace-scoped list with search, status filter and sorting. Corrections
 * improve an output without changing its original approved inputs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { GalleryIcon } from '../../components/icons';
import { getQualityServices } from '../../quality/factory';
import { CORRECTION_STATUSES } from '../../quality/types';
import type { CorrectionRequestRecord, CorrectionRequestStatus } from '../../quality/types';
import { CORRECTION_STATUS_TONE, formatDate, statusLabel } from './qualityUi';

type LoadState = 'loading' | 'error' | 'ready';

export function CorrectionsPage() {
  const services = useMemo(() => getQualityServices(), []);

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<CorrectionRequestRecord[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CorrectionRequestStatus | ''>('');
  const [sort, setSort] = useState<'recently_updated' | 'status'>('recently_updated');

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const rows = await services.corrections.listCorrectionRequests('ws_demo', {
        search,
        status: statusFilter === '' ? undefined : statusFilter,
        sort,
      });
      setRequests(rows);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load correction requests.');
      setState('error');
    }
  }, [services, search, statusFilter, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const map = new Map<CorrectionRequestStatus, number>();
    for (const request of requests) {
      map.set(request.status, (map.get(request.status) ?? 0) + 1);
    }
    return map;
  }, [requests]);

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Quality"
        title="Correction requests"
        description="Controlled derivative jobs that improve an output without changing its original approved inputs."
        actions={null}
      />

      <Card>
        <CardBody>
          <div className="lf-sheet__toolbar" style={{ alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: 'var(--lf-space-1)' }}>
              <span className="lf-field__label">Search</span>
              <input
                className="lf-input"
                type="search"
                placeholder="Search by title or output…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 'var(--lf-space-1)' }}>
              <span className="lf-field__label">Status</span>
              <select
                className="lf-input"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as CorrectionRequestStatus | '')}
              >
                <option value="">All statuses</option>
                {CORRECTION_STATUSES.map((status) => (
                  <option key={status} value={status}>{statusLabel(status)}{counts.get(status) ? ` (${counts.get(status)})` : ''}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 'var(--lf-space-1)' }}>
              <span className="lf-field__label">Sort</span>
              <select
                className="lf-input"
                value={sort}
                onChange={(event) => setSort(event.target.value as 'recently_updated' | 'status')}
              >
                <option value="recently_updated">Recently updated</option>
                <option value="status">Status</option>
              </select>
            </label>
          </div>
        </CardBody>
      </Card>

      {state === 'loading' ? (
        <Skeleton variant="rect" height={120} />
      ) : state === 'error' ? (
        <div className="lf-page">
          <EmptyState
            icon={<GalleryIcon size={22} />}
            title="Couldn't load correction requests"
            description={error ?? 'Something went wrong.'}
          />
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={<GalleryIcon size={22} />}
          title="No correction requests yet"
          description="Correction requests help improve an output without changing its original approved inputs."
          actions={<Link className="lf-btn lf-btn--secondary" to="/gallery">Open Gallery</Link>}
        />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
          {requests.map((request) => (
            <Card key={request.id}>
              <CardBody>
                <div className="lf-envref__row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <Link to={`/corrections/${request.id}`} style={{ fontWeight: 600 }}>
                      {request.title}
                    </Link>
                    <p className="lf-tile__description" style={{ margin: 'var(--lf-space-1) 0 0' }}>
                      Output {request.sourceGalleryOutputId} · scope: {statusLabel(request.scope)} ·
                      updated {formatDate(request.updatedAt)}
                    </p>
                  </div>
                  <Badge tone={CORRECTION_STATUS_TONE[request.status]} dot>
                    {statusLabel(request.status)}
                  </Badge>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
