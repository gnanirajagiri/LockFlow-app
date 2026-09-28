/**
 * Library asset Versions tab — timeline (number, status, change summary,
 * rights, dates), status filter, inspector, two-version comparison,
 * create-draft dialog (required change summary), and the rights-gated lock
 * confirmation dialog.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Drawer } from '../../components/ui/Drawer';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { CompareIcon, LockIcon, PlusIcon } from '../../components/icons';
import type {
  AssetVersionStatus,
  LibraryAssetVersionRecord,
} from '../../domain/library';
import {
  LIBRARY_LOCK_COPY,
  RIGHTS_LABELS,
  assertAssetLockAllowed,
  countDetailChanges,
  diffAssetDetails,
} from './libraryUi';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import { findDraftAssetVersion, type LibraryAssetState } from './useLibraryData';

type VersionFilter = 'all' | AssetVersionStatus;

const FILTERS: Array<{ value: VersionFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'locked', label: 'Locked' },
  { value: 'superseded', label: 'Superseded' },
];

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

interface VersionsTabProps {
  service: import('../../services/libraryService').LibraryService;
  versions: LibraryAssetVersionRecord[];
  data: LibraryAssetState;
  basePath: string;
}

export function LibraryAssetVersionsTab({ service, versions, data, basePath }: VersionsTabProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  const [filter, setFilter] = useState<VersionFilter>('all');
  const [inspected, setInspected] = useState<string | null>(null);
  const [locking, setLocking] = useState<LibraryAssetVersionRecord | null>(null);
  const [rightsAcknowledged, setRightsAcknowledged] = useState(false);
  const [draftFlowSource, setDraftFlowSource] = useState<LibraryAssetVersionRecord | null>(null);

  const draft = useMemo(() => findDraftAssetVersion(versions), [versions]);

  const createDraftParam = searchParams.get('create-draft');
  useEffect(() => {
    if (!createDraftParam) return;
    const source = versions.find((version) => version.id === createDraftParam);
    if (source && !draft) {
      setDraftFlowSource(source);
    } else if (source && draft) {
      toast({
        title: 'Finish the open draft first',
        description: `v${draft.versionNumber} is still open — lock it before starting another.`,
        tone: 'info',
      });
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createDraftParam]);

  const filtered = useMemo(
    () => (filter === 'all' ? versions : versions.filter((version) => version.status === filter)),
    [versions, filter],
  );

  async function handleLockConfirmed() {
    if (!locking) return;
    try {
      assertAssetLockAllowed(locking, { confirmed: true, rightsAcknowledged });
      await service.lockVersionWithRights(locking.id, { rightsAcknowledged }, SEED_LIBRARY_WORKSPACE_ID);
      setLocking(null);
      setRightsAcknowledged(false);
      toast({ title: `v${locking.versionNumber} locked`, description: 'This asset version is now read-only.', tone: 'success' });
      await data.reload();
    } catch (err) {
      toast({
        title: 'Lock failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
      setLocking(null);
      setRightsAcknowledged(false);
    }
  }

  return (
    <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
      <div className="lf-models-toolbar">
        <div className="lf-models-toolbar__filter">
          <label className="lf-field__label" htmlFor="library-versions-filter">Filter</label>
          <select
            id="library-versions-filter"
            className="lf-input"
            value={filter}
            onChange={(event) => setFilter(event.target.value as VersionFilter)}
          >
            {FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <Button
          variant="secondary"
          leftIcon={<PlusIcon size={14} />}
          onClick={() => setDraftFlowSource(versions[versions.length - 1] ?? null)}
          disabled={draft !== null}
        >
          Create new draft version
        </Button>
      </div>

      {draft ? (
        <Card>
          <CardBody>
            <div className="lf-models-toolbar">
              <Badge tone="primary" dot>Open draft</Badge>
              <span className="lf-tile__description">
                v{draft.versionNumber} — {draft.changeSummary || 'No change summary yet.'}
              </span>
              <div className="lf-modelcard__actions" style={{ marginLeft: 'auto' }}>
                <Button size="sm" onClick={() => setInspected(draft.id)}>Inspect</Button>
                <Button size="sm" onClick={() => navigate(`${basePath}/details?version=${draft.id}`)}>Edit</Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={draft.rightsStatus === 'unknown'}
                  title={draft.rightsStatus === 'unknown' ? 'Set the rights status before locking' : undefined}
                  onClick={() => setLocking(draft)}
                >
                  Lock version
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <ol className="lf-versionlist">
        {filtered.map((version) => (
          <li key={version.id} className="lf-versionrow">
            <div className="lf-versionrow__main">
              <Badge tone={version.status === 'locked' ? 'locked' : version.status === 'draft' ? 'primary' : 'neutral'}>
                {version.status === 'locked' ? <LockIcon size={12} /> : null}
                {`v${version.versionNumber} ${version.status}`}
              </Badge>
              <Badge tone={version.rightsStatus === 'confirmed' ? 'success' : version.rightsStatus === 'restricted' ? 'danger' : 'neutral'}>
                {RIGHTS_LABELS[version.rightsStatus]}
              </Badge>
              <span className="lf-tile__description">{version.changeSummary || 'No change summary.'}</span>
              <span className="lf-versionrow__dates">
                Created {formatDate(version.createdAt)}
                {version.lockedAt ? ` · Locked ${formatDate(version.lockedAt)}` : ''}
              </span>
            </div>
            <div className="lf-versionrow__actions">
              <Button size="sm" variant="ghost" onClick={() => setInspected(version.id)}>
                Inspect
              </Button>
              {version.status === 'draft' ? (
                <>
                  <Button size="sm" onClick={() => navigate(`${basePath}/details?version=${version.id}`)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={version.rightsStatus === 'unknown'}
                    title={version.rightsStatus === 'unknown' ? 'Set the rights status before locking' : undefined}
                    onClick={() => setLocking(version)}
                  >
                    Lock version
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  leftIcon={<PlusIcon size={12} />}
                  disabled={draft !== null}
                  title={draft !== null ? 'Finish the open draft first' : undefined}
                  onClick={() => setDraftFlowSource(version)}
                >
                  Create new draft from this version
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>

      <CompareSection versions={versions} />

      {inspected ? (
        <InspectVersionDrawer
          version={versions.find((version) => version.id === inspected) ?? null}
          onClose={() => setInspected(null)}
          onEdit={
            versions.find((version) => version.id === inspected)?.status === 'draft'
              ? () => navigate(`${basePath}/details?version=${inspected}`)
              : undefined
          }
        />
      ) : null}

      <Modal
        open={locking !== null}
        onClose={() => {
          setLocking(null);
          setRightsAcknowledged(false);
        }}
        title={locking ? `Lock version v${locking.versionNumber}?` : 'Lock version'}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button
              onClick={() => {
                setLocking(null);
                setRightsAcknowledged(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!rightsAcknowledged}
              title={rightsAcknowledged ? undefined : 'Confirm the rights acknowledgement first'}
              onClick={() => void handleLockConfirmed()}
            >
              Lock version
            </Button>
          </div>
        }
      >
        <p>{LIBRARY_LOCK_COPY}</p>
        {locking ? (
          <p className="lf-tile__description">
            v{locking.versionNumber} — {locking.changeSummary || 'No change summary.'} · {RIGHTS_LABELS[locking.rightsStatus]}
          </p>
        ) : null}
        <label className="lf-envlock__rights">
          <input
            type="checkbox"
            checked={rightsAcknowledged}
            onChange={(event) => setRightsAcknowledged(event.target.checked)}
          />
          <span>I have the rights to use the references and details of this asset version.</span>
        </label>
      </Modal>

      <CreateDraftDialog
        service={service}
        versions={versions}
        source={draftFlowSource}
        draftExists={draft !== null}
        onClose={() => setDraftFlowSource(null)}
        basePath={basePath}
        data={data}
      />
    </div>
  );
}

function InspectVersionDrawer({
  version,
  onClose,
  onEdit,
}: {
  version: LibraryAssetVersionRecord | null;
  onClose: () => void;
  onEdit?: () => void;
}) {
  if (!version) return null;
  const entries = Object.entries(version.structuredDetails);
  return (
    <Drawer open onClose={onClose} side="right" title={`v${version.versionNumber} — ${version.status}`}>
      <p className="lf-tile__description">{version.changeSummary || 'No change summary.'}</p>
      <p className="lf-tile__description">{RIGHTS_LABELS[version.rightsStatus]}</p>
      <div className="lf-formstack">
        {entries.length === 0 ? (
          <p className="lf-tile__description">No structured details recorded yet.</p>
        ) : (
          entries.map(([key, value]) => (
            <div className="lf-sheet__section" key={key}>
              <h4>{key}</h4>
              <div className="lf-readonly">
                {typeof value === 'string' ? value : JSON.stringify(value)}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="lf-dialogactions">
        {onEdit ? <Button onClick={onEdit}>Edit</Button> : null}
        <Button onClick={onClose}>Close</Button>
      </div>
    </Drawer>
  );
}

function CompareSection({ versions }: { versions: LibraryAssetVersionRecord[] }) {
  const [beforeId, setBeforeId] = useState(versions[0]?.id ?? '');
  const [afterId, setAfterId] = useState(versions[versions.length - 1]?.id ?? '');

  const before = versions.find((version) => version.id === beforeId);
  const after = versions.find((version) => version.id === afterId);
  const diffs = before && after ? diffAssetDetails(before.structuredDetails, after.structuredDetails) : null;
  const changed = diffs ? countDetailChanges(diffs) : 0;

  return (
    <Card>
      <CardBody>
        <h3 className="lf-envpanel__heading">
          <CompareIcon size={16} /> Compare versions
        </h3>
        <div className="lf-compare__choosers">
          <label className="lf-field">
            <span className="lf-field__label">Before</span>
            <select className="lf-input" value={beforeId} onChange={(event) => setBeforeId(event.target.value)}>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>v{version.versionNumber} — {version.status}</option>
              ))}
            </select>
          </label>
          <label className="lf-field">
            <span className="lf-field__label">After</span>
            <select className="lf-input" value={afterId} onChange={(event) => setAfterId(event.target.value)}>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>v{version.versionNumber} — {version.status}</option>
              ))}
            </select>
          </label>
          {diffs ? (
            <span className="lf-tile__description" role="status">
              {changed} of {diffs.length} detail fields changed
            </span>
          ) : null}
        </div>
        {diffs && diffs.length > 0 ? (
          <div className="lf-compare__tablewrap">
            <table className="lf-compare__table">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {diffs.map((diff) => (
                  <tr key={diff.field} className={diff.changed ? 'lf-compare__row--changed' : undefined}>
                    <th scope="row">{diff.label}</th>
                    <td>{diff.before || '—'}</td>
                    <td>{diff.after || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="lf-tile__description">No structured details to compare yet.</p>
        )}
      </CardBody>
    </Card>
  );
}

function CreateDraftDialog({
  service,
  versions,
  source,
  draftExists,
  onClose,
  basePath,
  data,
}: {
  service: import('../../services/libraryService').LibraryService;
  versions: LibraryAssetVersionRecord[];
  source: LibraryAssetVersionRecord | null;
  draftExists: boolean;
  onClose: () => void;
  basePath: string;
  data: LibraryAssetState;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState('');
  const [summary, setSummary] = useState('');
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (source) {
      setSelectedId(source.id);
      setSummary(`Revision based on v${source.versionNumber}: `);
      setSummaryError(null);
    }
  }, [source]);

  if (!source) return null;

  async function handleSubmit() {
    if (!selectedId || !source) return;
    if (summary.trim() === '') {
      setSummaryError('A change summary is required.');
      return;
    }
    if (draftExists) {
      toast({
        title: 'Finish the open draft first',
        description: 'Lock the open draft before starting another version.',
        tone: 'info',
      });
      return;
    }
    setBusy(true);
    try {
      const version = await service.createVersion(
        {
          libraryAssetId: source.libraryAssetId,
          sourceVersionId: selectedId,
          changeSummary: summary.trim(),
        },
        'demo-user',
        SEED_LIBRARY_WORKSPACE_ID,
      );
      toast({ title: `Draft v${version.versionNumber} created`, description: 'Now editing the new asset draft.', tone: 'success' });
      onClose();
      await data.reload();
      navigate(`${basePath}/details?version=${version.id}`);
    } catch (err) {
      toast({
        title: 'Could not create draft',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Create a new draft version"
      description="The new draft copies this version's structured details and references. The source version is never modified."
      size="sm"
      footer={
        <div className="lf-dialogactions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={busy}>
            {busy ? 'Creating…' : 'Create draft'}
          </Button>
        </div>
      }
    >
      <div className="lf-formstack">
        <label className="lf-field">
          <span className="lf-field__label" id="lib-draft-source-label">Source version</span>
          <select
            className="lf-input"
            aria-labelledby="lib-draft-source-label"
            value={selectedId}
            onChange={(event) => {
              const next = versions.find((version) => version.id === event.target.value);
              setSelectedId(event.target.value);
              if (next) setSummary(`Revision based on v${next.versionNumber}: `);
            }}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                v{version.versionNumber} ({version.status})
              </option>
            ))}
          </select>
        </label>
        <label className="lf-field">
          <span className="lf-field__label">Change summary</span>
          <input
            className="lf-input"
            required
            value={summary}
            aria-describedby="lib-draft-summary-hint"
            aria-invalid={summaryError ? true : undefined}
            onChange={(event) => setSummary(event.target.value)}
          />
          <span className="lf-field__hint" id="lib-draft-summary-hint">
            {summaryError ?? 'Required — describes what this draft changes.'}
          </span>
        </label>
      </div>
    </Modal>
  );
}
