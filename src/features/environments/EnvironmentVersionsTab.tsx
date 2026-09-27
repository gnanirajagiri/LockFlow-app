/**
 * Versions tab — version timeline for an environment.
 *
 * Timeline rows show version number, status, change summary, lock level and
 * dates; a status filter narrows the list. Draft rows offer Edit and
 * "Lock environment" (deep-links to the /lock review page, where confirmation
 * + rights acknowledgement happen). Locked rows offer View and "Create new
 * draft from this version" (through the required-change-summary dialog).
 * The two-version comparison shows changed AND unchanged fields.
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
  EnvironmentSpecRecord,
  EnvironmentVersionRecord,
  EnvironmentVersionStatus,
} from '../../domain/environments';
import type { EnvironmentsService } from '../../services/environmentsService';
import { SEED_ENVIRONMENT_WORKSPACE_ID } from '../../mock/environmentsSeed';
import { countSpecChanges, diffEnvironmentSpecs } from './envDiff';
import { findDraftEnvironmentVersion, type EnvironmentState } from './useEnvironmentData';

type VersionFilter = 'all' | EnvironmentVersionStatus;

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
  service: EnvironmentsService;
  environmentId: string;
  versions: EnvironmentVersionRecord[];
  data: EnvironmentState;
  basePath: string;
}

export function EnvironmentVersionsTab({
  service,
  environmentId,
  versions,
  data,
  basePath,
}: VersionsTabProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  const [filter, setFilter] = useState<VersionFilter>('all');
  const [inspected, setInspected] = useState<string | null>(null);
  const [draftFlowSource, setDraftFlowSource] = useState<EnvironmentVersionRecord | null>(null);

  const draft = useMemo(() => findDraftEnvironmentVersion(versions), [versions]);

  // Deep link: /versions?create-draft=<versionId> opens the create-draft
  // dialog with that source preselected (used by the profile header's
  // "Create new draft version" action and locked-version entry points).
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

  return (
    <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
      <div className="lf-models-toolbar">
        <div className="lf-models-toolbar__filter">
          <label className="lf-field__label" htmlFor="env-versions-filter">Filter</label>
          <select
            id="env-versions-filter"
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
                <Button size="sm" variant="primary" onClick={() => navigate(`${basePath}/lock?version=${draft.id}`)}>
                  Lock environment
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
              <Badge tone="info">{version.lockLevel} lock</Badge>
              <span className="lf-tile__description">
                {version.changeSummary || 'No change summary.'}
              </span>
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
                  <Button size="sm" onClick={() => navigate(`${basePath}/edit?version=${version.id}`)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => navigate(`${basePath}/lock?version=${version.id}`)}
                  >
                    Lock environment
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

      <CompareSection service={service} versions={versions} />

      {inspected ? (
        <InspectSpecDrawer
          service={service}
          version={versions.find((version) => version.id === inspected) ?? null}
          onClose={() => setInspected(null)}
          onEdit={
            versions.find((version) => version.id === inspected)?.status === 'draft'
              ? () => navigate(`${basePath}/edit?version=${inspected}`)
              : undefined
          }
        />
      ) : null}

      <CreateDraftDialog
        service={service}
        environmentId={environmentId}
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

/** Inspect drawer showing the version's key Environment Specs. */
function InspectSpecDrawer({
  service,
  version,
  onClose,
  onEdit,
}: {
  service: EnvironmentsService;
  version: EnvironmentVersionRecord | null;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const [spec, setSpec] = useState<EnvironmentSpecRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    setSpec(null);
    setError(null);
    service
      .getSpec(version.id, SEED_ENVIRONMENT_WORKSPACE_ID)
      .then((record) => {
        if (!cancelled) setSpec(record);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load.');
      });
    return () => {
      cancelled = true;
    };
  }, [service, version?.id]);

  if (!version) return null;

  return (
    <Drawer open onClose={onClose} side="right" title={`v${version.versionNumber} — ${version.status}`}>
      <p className="lf-tile__description">{version.changeSummary || 'No change summary.'}</p>
      {error ? (
        <div className="lf-alertbox" role="alert">{error}</div>
      ) : !spec ? (
        <p>Loading…</p>
      ) : (
        <div className="lf-formstack">
          <ReadonlyRow label="Room type" value={spec.roomType} />
          <ReadonlyRow label="Layout feel" value={spec.layoutFeel} />
          <ReadonlyRow label="Hero angle" value={spec.heroAngle} />
          <ReadonlyRow label="Lighting style" value={spec.lightingStyle} />
          <ReadonlyRow label="Furniture anchors" value={spec.furnitureAnchors} />
          <ReadonlyRow label="Signature props" value={spec.signatureProps} />
          <ReadonlyRow label="Palette & materials" value={spec.paletteMaterials} />
          <ReadonlyRow label="Product zone" value={spec.productZone} />
          <ReadonlyRow label="Continuity notes" value={spec.continuityNotes} />
        </div>
      )}
      <div className="lf-dialogactions">
        {onEdit ? <Button onClick={onEdit}>Edit</Button> : null}
        <Button onClick={onClose}>Close</Button>
      </div>
    </Drawer>
  );
}

function ReadonlyRow({
  label,
  value,
}: {
  label: string;
  value: string | Record<string, unknown> | null;
}) {
  const text =
    typeof value === 'string'
      ? value
      : value === null || value === undefined
        ? ''
        : Object.keys(value).length === 0
          ? ''
          : Object.entries(value)
              .map(([key, val]) => `${key}: ${typeof val === 'string' ? val : JSON.stringify(val)}`)
              .join('\n');
  const isEmpty = text.trim() === '';
  return (
    <div className="lf-sheet__section">
      <h4>{label}</h4>
      <div className={`lf-readonly${isEmpty ? ' lf-readonly--empty' : ''}`}>
        {isEmpty ? 'Not recorded yet' : text}
      </div>
    </div>
  );
}

/** Two-version comparison — changed and unchanged fields side by side. */
function CompareSection({
  service,
  versions,
}: {
  service: EnvironmentsService;
  versions: EnvironmentVersionRecord[];
}) {
  const comparable = versions; // any two versions can be compared
  const [beforeId, setBeforeId] = useState<string>(comparable[0]?.id ?? '');
  const [afterId, setAfterId] = useState<string>(comparable[comparable.length - 1]?.id ?? '');
  const [sheets, setSheets] = useState<Record<string, EnvironmentSpecRecord>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded: Record<string, EnvironmentSpecRecord> = { ...sheets };
        for (const version of comparable) {
          if (!loaded[version.id]) {
            loaded[version.id] = await service.getSpec(version.id, SEED_ENVIRONMENT_WORKSPACE_ID);
          }
        }
        if (!cancelled) {
          setSheets(loaded);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load specs.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, comparable.map((version) => version.id).join('|')]);

  const before = sheets[beforeId];
  const after = sheets[afterId];
  const diffs = before && after ? diffEnvironmentSpecs(before, after) : null;
  const changedCount = diffs ? countSpecChanges(diffs) : 0;

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
              {comparable.map((version) => (
                <option key={version.id} value={version.id}>v{version.versionNumber} — {version.status}</option>
              ))}
            </select>
          </label>
          <label className="lf-field">
            <span className="lf-field__label">After</span>
            <select className="lf-input" value={afterId} onChange={(event) => setAfterId(event.target.value)}>
              {comparable.map((version) => (
                <option key={version.id} value={version.id}>v{version.versionNumber} — {version.status}</option>
              ))}
            </select>
          </label>
          {diffs ? (
            <span className="lf-tile__description" role="status">
              {changedCount} of {diffs.length} fields changed
            </span>
          ) : null}
        </div>

        {error ? (
          <div className="lf-alertbox" role="alert">{error}</div>
        ) : !diffs ? (
          <p className="lf-tile__description">Loading specs…</p>
        ) : (
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
        )}
      </CardBody>
    </Card>
  );
}

/** Create-draft dialog — requires a change summary before creating. */
function CreateDraftDialog({
  service,
  environmentId,
  versions,
  source,
  draftExists,
  onClose,
  basePath,
  data,
}: {
  service: EnvironmentsService;
  environmentId: string;
  versions: EnvironmentVersionRecord[];
  source: EnvironmentVersionRecord | null;
  draftExists: boolean;
  onClose: () => void;
  basePath: string;
  data: EnvironmentState;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string>('');
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
    if (!selectedId) return;
    // A change summary is required before a new draft is created.
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
        { environmentId, sourceVersionId: selectedId, changeSummary: summary.trim() },
        'demo-user',
        SEED_ENVIRONMENT_WORKSPACE_ID,
      );
      toast({ title: `Draft v${version.versionNumber} created`, description: 'Now editing the new environment draft.', tone: 'success' });
      onClose();
      // Refresh the layout's version list first — the new version does not
      // exist in it yet, so navigating before reload would render a fallback.
      await data.reload();
      navigate(`${basePath}/edit?version=${version.id}`);
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
      description="The new draft copies the selected version's Environment Spec and references. The source version is never modified."
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
          <span className="lf-field__label" id="env-draft-source-label">Source version</span>
          <select
            className="lf-input"
            aria-labelledby="env-draft-source-label"
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
            aria-describedby="env-draft-summary-hint"
            aria-invalid={summaryError ? true : undefined}
            onChange={(event) => setSummary(event.target.value)}
          />
          <span className="lf-field__hint" id="env-draft-summary-hint">
            {summaryError ?? 'Required — describes what this draft changes.'}
          </span>
        </label>
      </div>
    </Modal>
  );
}
