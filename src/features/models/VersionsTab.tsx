/**
 * Versions tab — the version history for one model.
 *
 * Stage-5 fidelity (board S34): a "Version history" header with a Compare
 * toggle and Create-new-version action, then a single timeline card where
 * each version row has a status-icon rail (pencil/lock/gear), a cover
 * thumbnail with initials fallback, a "v2 Draft"-style title, dates and a
 * usage line ("Used in N jobs · M campaigns"), and contextual actions.
 * Draft actions: Edit sheet, Lock version (confirm dialog required).
 * Locked actions: View only, Create new draft from this version. A footer
 * info banner reminds that jobs keep the version they were made with.
 * Two-version comparison with field-by-field diffs lives behind the
 * Compare toggle.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import {
  CheckIcon,
  CompareIcon,
  InfoIcon,
  LockIcon,
  PlusIcon,
} from '../../components/icons';
import { ModelsService } from '../../services/modelsService';
import { useAuth } from '../../auth/AuthProvider';
import { SEED_WORKSPACE_ID } from '../../mock/modelsSeed';
import { assertLockAllowed, LOCK_CONFIRMATION_COPY } from './lockFlow';
import { countChanged, diffCharacterSheets } from './modelDiff';
import { findDraftVersion, type ModelState } from './useModelData';
import type {
  CharacterSheetRecord,
  ModelVersionRecord,
  ModelVersionStatus,
} from '../../domain/models';

type VersionFilter = 'all' | ModelVersionStatus;

const FILTERS: Array<{ value: VersionFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'locked', label: 'Locked' },
  { value: 'superseded', label: 'Superseded' },
];

interface VersionsTabProps {
  service: ModelsService;
  modelId: string;
  versions: ModelVersionRecord[];
  activeVersionId: string | null;
  data: ModelState;
  basePath: string;
}

export function VersionsTab({
  service,
  modelId,
  versions,
  activeVersionId,
  data,
  basePath,
}: VersionsTabProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<VersionFilter>('all');
  const [inspected, setInspected] = useState<string | null>(null);
  const [locking, setLocking] = useState<ModelVersionRecord | null>(null);
  const [draftFlowSource, setDraftFlowSource] = useState<ModelVersionRecord | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

  const modelName = data.model?.name ?? 'Model';

  // Deep link: /versions?create-draft=<versionId> opens the create-draft
  // dialog with that source preselected (used by the profile header's
  // "Create new draft version" action and locked-sheet entry point).
  const createDraftParam = searchParams.get('create-draft');
  const draft = useMemo(() => findDraftVersion(versions), [versions]);
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

  const { toast } = useToast();

  // Newest first — the timeline reads top-down from the latest work.
  const ordered = useMemo(() => [...filtered].reverse(), [filtered]);

  async function handleLockConfirmed() {
    if (!locking) return;
    try {
      // The confirm dialog's OK is the recorded confirmation — the pure gate
      // mirrors the service guard (only drafts can be locked).
      assertLockAllowed(locking, { versionId: locking.id, confirmed: true });
      await service.lockVersion(locking.id, SEED_WORKSPACE_ID);
      setLocking(null);
      toast({ title: `v${locking.versionNumber} locked`, description: 'This identity version is now read-only.', tone: 'success' });
      data.reload();
    } catch (err) {
      toast({
        title: 'Lock failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
      setLocking(null);
    }
  }

  return (
    <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
      <div className="lf-models-toolbar">
        <h2 className="lf-section__title" style={{ margin: 0 }}>
          Version history
          {versions.length > 0 ? (
            <span className="lf-tile__description" style={{ marginLeft: 'var(--lf-space-2)' }}>
              {versions.length} version{versions.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </h2>
        <div className="lf-modelcard__actions">
          <select
            aria-label="Filter versions"
            className="lf-input"
            style={{ width: 'auto' }}
            value={filter}
            onChange={(event) => setFilter(event.target.value as VersionFilter)}
          >
            {FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {versions.length >= 2 ? (
            <Button
              variant="secondary"
              leftIcon={<CompareIcon size={14} />}
              aria-expanded={compareOpen}
              onClick={() => setCompareOpen((open) => !open)}
            >
              {compareOpen ? 'Hide compare' : `Compare v1 → v${versions[1].versionNumber}`}
            </Button>
          ) : null}
          <Button
            variant="primary"
            leftIcon={<PlusIcon size={14} />}
            onClick={() => setDraftFlowSource(versions[versions.length - 1] ?? null)}
            disabled={draft !== null}
            title={draft !== null ? 'Finish or lock the open draft first.' : undefined}
          >
            Create new version
          </Button>
        </div>
      </div>

      {versions.length === 0 ? (
        <EmptyState
          title="No versions yet"
          description="Versions appear here as this model's identity is drafted, locked and revised."
        />
      ) : (
        <Card>
          <CardBody flush>
            <ol className="lf-versionlist" aria-label="Version history" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {ordered.map((version) => (
                <li key={version.id}>
                  <div className="lf-versionrow">
                    <span className={`lf-versionrow__rail lf-versionrow__rail--${version.status}`} aria-hidden="true">
                      {version.status === 'locked' ? (
                        <LockIcon size={13} />
                      ) : version.status === 'draft' ? (
                        <CheckIcon size={13} />
                      ) : (
                        <InfoIcon size={13} />
                      )}
                    </span>
                    <VersionThumb version={version} />
                    <div className="lf-versionrow__main">
                      <div className="lf-versionrow__titleline">
                        <span className="lf-versionrow__number">
                          {modelName} v{version.versionNumber}
                        </span>
                        <Badge
                          tone={version.status === 'locked' ? 'locked' : version.status === 'draft' ? 'primary' : 'neutral'}
                          dot={version.status === 'draft'}
                        >
                          {version.status}
                        </Badge>
                        {version.id === activeVersionId ? (
                          <span className="lf-versionrow__activetag">active</span>
                        ) : null}
                      </div>
                      <span className="lf-versionrow__dates">
                        {version.status === 'draft' ? 'Started' : version.status === 'locked' ? 'Locked' : 'Created'}{' '}
                        {new Date(version.status === 'draft' ? version.createdAt : version.lockedAt ?? version.createdAt).toLocaleDateString()}
                        {' · '}
                        {version.changeSummary || 'No change summary.'}
                      </span>
                      <VersionUsageLine versionId={version.id} />
                    </div>
                    <div className="lf-versionrow__actions">
                      <Button size="sm" variant="ghost" onClick={() => setInspected(version.id)}>
                        Inspect
                      </Button>
                      {version.status === 'draft' ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => navigate(`${basePath}/character-sheet?version=${version.id}`)}
                          >
                            Edit sheet
                          </Button>
                          <Button size="sm" variant="primary" onClick={() => setLocking(version)}>
                            Lock version
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          leftIcon={<PlusIcon size={12} />}
                          disabled={draft !== null}
                          title={draft !== null ? 'Finish or lock the open draft first.' : undefined}
                          onClick={() => setDraftFlowSource(version)}
                        >
                          Duplicate as new draft
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      )}

      <p className="lf-library__note" role="note" style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-2)' }}>
        <InfoIcon size={14} /> Jobs keep the version they were made with. Locking a draft never
        changes anything made with an earlier locked version.
      </p>

      {compareOpen && versions.length >= 2 ? (
        <CompareSection service={service} versions={versions} />
      ) : null}
      {versions.length < 2 ? (
        <p className="lf-tile__description">
          Comparison unlocks once the model has at least two versions.
        </p>
      ) : null}

      {inspected ? (
        <InspectSheetDialog
          service={service}
          version={versions.find((version) => version.id === inspected) ?? null}
          onClose={() => setInspected(null)}
          onEdit={
            versions.find((version) => version.id === inspected)?.status === 'draft'
              ? () => navigate(`${basePath}/character-sheet?version=${inspected}`)
              : undefined
          }
        />
      ) : null}

      <Modal
        open={locking !== null}
        onClose={() => setLocking(null)}
        title={locking ? `Lock v${locking.versionNumber}?` : 'Lock version'}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setLocking(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void handleLockConfirmed()}>
              Lock version
            </Button>
          </div>
        }
      >
        <p>{LOCK_CONFIRMATION_COPY}</p>
        {locking ? (
          <p className="lf-tile__description">
            v{locking.versionNumber} — {locking.changeSummary || 'No change summary.'}
          </p>
        ) : null}
      </Modal>

      <CreateDraftDialog
        service={service}
        modelId={modelId}
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

/** Cover thumbnail with the model-initials fallback used across the profile. */
function VersionThumb({ version }: { version: ModelVersionRecord }) {
  if (version.coverImagePath) {
    return (
      <img
        className="lf-versionrow__thumb"
        src={version.coverImagePath}
        alt=""
        loading="lazy"
      />
    );
  }
  return (
    <span className="lf-versionrow__thumb lf-versionrow__thumb--fallback" aria-hidden="true">
      A
    </span>
  );
}

/**
 * Per-version usage line ("Used in N jobs · M campaigns"). Reads the same
 * provenance pins the Overview tab uses; hidden entirely when a version has
 * no usage so rows stay calm.
 */
function VersionUsageLine({ versionId }: { versionId: string }) {
  const [usage, setUsage] = useState<{ jobs: number; campaigns: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ContentStudioService } = await import('../../services/contentService');
        const { GalleryService } = await import('../../services/galleryService');
        const { getContentRepository } = await import('../../data/contentFactory');
        const { getGalleryRepository } = await import('../../data/galleryFactory');
        const { getLibraryRepository } = await import('../../data/libraryFactory');
        const { getModelsRepository } = await import('../../data');
        const { getEnvironmentsRepository } = await import('../../data/environmentsFactory');
        const { LibraryService } = await import('../../services/libraryService');
        const { ModelsService: ModelsServiceForUsage } = await import('../../services/modelsService');
        const { EnvironmentsService } = await import('../../services/environmentsService');
        const { SEED_LIBRARY_WORKSPACE_ID } = await import('../../mock/librarySeed');

        const content = new ContentStudioService(getContentRepository(), {
          library: new LibraryService(getLibraryRepository()),
          models: new ModelsServiceForUsage(getModelsRepository()),
          environments: new EnvironmentsService(getEnvironmentsRepository()),
        });
        const gallery = new GalleryService(
          getGalleryRepository(),
          content,
          SEED_LIBRARY_WORKSPACE_ID,
        );

        const outputs = await gallery.listOutputs(SEED_LIBRARY_WORKSPACE_ID).catch(() => []);
        const jobIds = new Set<string>();
        const campaignNames = new Set<string>();
        for (const output of outputs) {
          const provenance = await gallery
            .resolveProvenance(output.id, SEED_LIBRARY_WORKSPACE_ID)
            .catch(() => null);
          if (!provenance) continue;
          if (provenance.pins.some((pin) => pin.sourceVersionId === versionId)) {
            jobIds.add(provenance.job.id);
            if (provenance.project?.name) campaignNames.add(provenance.project.name);
          }
        }
        if (!cancelled) setUsage({ jobs: jobIds.size, campaigns: campaignNames.size });
      } catch {
        if (!cancelled) setUsage({ jobs: 0, campaigns: 0 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [versionId]);

  if (usage === null || (usage.jobs === 0 && usage.campaigns === 0)) return null;
  return (
    <span className="lf-versionrow__usage">
      Used in {usage.jobs} job{usage.jobs === 1 ? '' : 's'}
      {usage.campaigns > 0 ? ` · ${usage.campaigns} campaign${usage.campaigns === 1 ? '' : 's'}` : ''}
    </span>
  );
}

function InspectSheetDialog({
  service,
  version,
  onClose,
  onEdit,
}: {
  service: ModelsService;
  version: ModelVersionRecord | null;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const [sheet, setSheet] = useState<CharacterSheetRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    setSheet(null);
    setError(null);
    service
      .getCharacterSheet(version.id, SEED_WORKSPACE_ID)
      .then((record) => {
        if (!cancelled) setSheet(record);
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
    <Modal
      open
      onClose={onClose}
      title={`v${version.versionNumber} — ${version.status}`}
      description={version.changeSummary || 'No change summary.'}
      size="lg"
      footer={
        <div className="lf-dialogactions">
          {onEdit ? <Button onClick={onEdit}>Edit sheet</Button> : null}
          <Button onClick={onClose}>Close</Button>
        </div>
      }
    >
      {error ? (
        <div className="lf-alertbox" role="alert">{error}</div>
      ) : !sheet ? (
        <p>Loading…</p>
      ) : (
        <div className="lf-formstack">
          <ReadonlyRow label="Identity summary" value={sheet.identitySummary} />
          <ReadonlyRow label="Face & features" value={sheet.faceFeatures} />
          <ReadonlyRow label="Hair identity" value={sheet.hairIdentity} />
          <ReadonlyRow label="Complexion" value={sheet.complexion} />
          <ReadonlyRow label="Body proportions" value={sheet.bodyProportions} />
          <ReadonlyRow label="Distinctive details" value={sheet.distinctiveDetails} />
          <ReadonlyRow label="Reference notes" value={sheet.referenceNotes} />
          <ReadonlyRow label="Lock rules" value={sheet.lockRules} />
        </div>
      )}
    </Modal>
  );
}

function ReadonlyRow({
  label,
  value,
}: {
  label: string;
  value: string | Record<string, unknown>;
}) {
  const text =
    typeof value === 'string'
      ? value
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

function CompareSection({
  service,
  versions,
}: {
  service: ModelsService;
  versions: ModelVersionRecord[];
}) {
  const comparable = versions.filter((version) => version.status !== 'draft' || versions.length >= 2);
  const [leftId, setLeftId] = useState<string | null>(comparable[0]?.id ?? null);
  const [rightId, setRightId] = useState<string | null>(comparable[1]?.id ?? null);
  const [sheets, setSheets] = useState<Record<string, CharacterSheetRecord>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ids = [leftId, rightId].filter((id): id is string => Boolean(id));
    const missing = ids.filter((id) => !sheets[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const loaded = await Promise.all(
          missing.map(async (id) => [id, await service.getCharacterSheet(id, SEED_WORKSPACE_ID)] as const),
        );
        if (cancelled) return;
        setSheets((current) => ({ ...current, ...Object.fromEntries(loaded) }));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load comparison.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service, leftId, rightId, sheets]);

  const diffs = useMemo(() => {
    const left = leftId ? sheets[leftId] : null;
    const right = rightId ? sheets[rightId] : null;
    if (!left || !right) return null;
    return diffCharacterSheets(left, right);
  }, [sheets, leftId, rightId]);

  if (versions.length < 2) {
    return (
      <p className="lf-tile__description">
        Comparison unlocks once the model has at least two versions.
      </p>
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="lf-section">
          <h3>Compare versions</h3>
          <div className="lf-compare__pickers">
            <label className="lf-visually-hidden" htmlFor="compare-left">Compare from</label>
            <select
              id="compare-left"
              className="lf-input"
              value={leftId ?? ''}
              onChange={(event) => setLeftId(event.target.value)}
            >
              {versions.map((version) => (
                <option key={version.id} value={version.id}>v{version.versionNumber} ({version.status})</option>
              ))}
            </select>
            <span aria-hidden="true">→</span>
            <label className="lf-visually-hidden" htmlFor="compare-right">Compare to</label>
            <select
              id="compare-right"
              className="lf-input"
              value={rightId ?? ''}
              onChange={(event) => setRightId(event.target.value)}
            >
              {versions.map((version) => (
                <option key={version.id} value={version.id}>v{version.versionNumber} ({version.status})</option>
              ))}
            </select>
          </div>

          {error ? <div className="lf-alertbox" role="alert">{error}</div> : null}

          {diffs ? (
            <table className="lf-compare__table">
              <caption>
                {countChanged(diffs)} of {diffs.length} identity fields differ.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {diffs.map((diff) => (
                  <tr key={diff.field} className={diff.changed ? 'lf-compare__row--changed' : ''}>
                    <th scope="row" className="lf-compare__field">{diff.label}</th>
                    <td>{diff.before}</td>
                    <td>{diff.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="lf-tile__description">Loading sheets…</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function CreateDraftDialog({
  service,
  modelId,
  versions,
  source,
  draftExists,
  onClose,
  basePath,
  data,
}: {
  service: ModelsService;
  modelId: string;
  versions: ModelVersionRecord[];
  source: ModelVersionRecord | null;
  draftExists: boolean;
  onClose: () => void;
  basePath: string;
  data: ModelState;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
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

  async function handleSubmit() {
    if (!selectedId) return;
    // A change summary is required before a new draft is created.
    if (summary.trim() === '') {
      setSummaryError('A change summary is required.');
      return;
    }
    setBusy(true);
    try {
      const version = await service.createVersion(
        { modelId, sourceVersionId: selectedId, changeSummary: summary.trim() },
        user?.id ?? 'demo-user',
        SEED_WORKSPACE_ID,
      );
      toast({ title: `Draft v${version.versionNumber} created`, description: 'Now editing the new Character Sheet draft.', tone: 'success' });
      onClose();
      // Refresh the layout's version list first — the new version does not
      // exist in it yet, so navigating before reload would render a fallback
      // (previously the stale-list bug).
      await data.reload();
      navigate(`${basePath}/character-sheet?version=${version.id}`);
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
      open={source !== null}
      onClose={onClose}
      title="Create a new draft version"
      description="The new draft copies the selected version's Character Sheet and references. The source version is never modified."
      size="sm"
      footer={
        <div className="lf-dialogactions">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={busy || draftExists}>
            Create draft
          </Button>
        </div>
      }
    >
      <div className="lf-formstack">
        {draftExists ? (
          <div className="lf-alertbox" role="alert">
            A draft version already exists for this model. Lock it before starting another.
          </div>
        ) : null}
        <div className="lf-sheet__section">
          <label className="lf-field__label" htmlFor="draft-source-select">Source version</label>
          <select
            id="draft-source-select"
            className="lf-input"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                v{version.versionNumber} ({version.status})
              </option>
            ))}
          </select>
        </div>
        <Input
          label="Change summary"
          required
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          error={summaryError ?? undefined}
          hint="Required — describes what this draft changes."
        />
      </div>
    </Modal>
  );
}
