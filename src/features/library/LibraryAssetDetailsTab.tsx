/**
 * Library asset Details tab — structured details of the selected version.
 *
 * Draft: validated editable form (colour, material, dimensions/fit,
 * condition, key details, usage notes + any extra keys) with explicit
 * "Save draft". Locked/superseded: read-only with lock indicator and
 * "Create new draft version" as the only modification path.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { EnvironmentIcon, LockIcon, PlusIcon } from '../../components/icons';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import type { LibraryAssetVersionRecord } from '../../domain/library';
import { RIGHTS_LABELS } from './libraryUi';
import { useLibraryOutletContext } from './tabRoutes';
import { findDraftAssetVersion, useSelectedAssetVersion } from './useLibraryData';

const DETAIL_FIELDS: Array<{ key: string; label: string; hint?: string }> = [
  { key: 'colour', label: 'Colour' },
  { key: 'material', label: 'Material' },
  { key: 'dimensions', label: 'Dimensions / fit' },
  { key: 'condition', label: 'Condition' },
  { key: 'keyDetails', label: 'Key details' },
  { key: 'usageNotes', label: 'Usage notes' },
];

type DetailsForm = Record<string, string>;

function detailsToForm(details: Record<string, unknown>): DetailsForm {
  const form: DetailsForm = {};
  for (const [key, value] of Object.entries(details)) {
    form[key] =
      value === null || value === undefined
        ? ''
        : typeof value === 'string'
          ? value
          : JSON.stringify(value);
  }
  return form;
}

function formToDetails(form: DetailsForm): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(form)) {
    if (value.trim() === '') continue;
    try {
      details[key] = JSON.parse(value);
    } catch {
      details[key] = value;
    }
  }
  return details;
}

export function LibraryAssetDetailsTab() {
  const { service, data, basePath } = useLibraryOutletContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const requested = searchParams.get('version');
  const selectedVersion = useSelectedAssetVersion(data.versions, data.asset?.activeVersionId ?? null, requested);
  const draft = findDraftAssetVersion(data.versions);

  const [details, setDetails] = useState<Record<string, unknown> | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<DetailsForm | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedVersion) return;
    let cancelled = false;
    setLoadState('loading');
    // Details live on the version itself; fetch it through the service.
    service
      .getVersion(selectedVersion.id, SEED_LIBRARY_WORKSPACE_ID)
      .then((version: LibraryAssetVersionRecord) => {
        if (!cancelled) {
          setDetails(version.structuredDetails);
          setForm(detailsToForm(version.structuredDetails));
          setLoadState('ready');
          setLoadError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load details.');
          setLoadState('error');
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, selectedVersion?.id]);

  if (data.state === 'ready' && data.versions.length === 0) {
    return (
      <EmptyState
        icon={<EnvironmentIcon size={22} />}
        title="No versions yet"
        description="This asset has no versions. Create the first draft from the profile header."
      />
    );
  }

  if (loadState === 'loading') {
    return (
      <div aria-busy="true">
        <Skeleton variant="rect" height={44} />
        <div style={{ height: 'var(--lf-space-4)' }} />
        <Skeleton lines={6} />
      </div>
    );
  }

  if (loadState === 'error' || !details || !form || !selectedVersion) {
    return (
      <EmptyState
        icon={<EnvironmentIcon size={22} />}
        title="Couldn't load the details"
        description={loadError ?? undefined}
        actions={<Button onClick={() => void data.reload()}>Try again</Button>}
      />
    );
  }

  const editable = selectedVersion.status === 'draft';
  const extraKeys = Object.keys(form).filter((key) => !DETAIL_FIELDS.some((field) => field.key === key));

  async function saveDraft() {
    if (!form || !selectedVersion) return;
    setSaving(true);
    try {
      await service.updateVersionDraft(
        selectedVersion.id,
        { structuredDetails: formToDetails(form) },
        SEED_LIBRARY_WORKSPACE_ID,
      );
      toast({ title: 'Draft saved', description: 'Asset details updated on this draft.', tone: 'success' });
      await data.reload();
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  if (!editable) {
    return (
      <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
        <div className="lf-lockedbanner">
          <LockIcon size={20} />
          <div className="lf-lockedbanner__copy">
            <strong>
              v{selectedVersion.versionNumber} — {selectedVersion.status}
              {selectedVersion.lockedAt ? ` ${new Date(selectedVersion.lockedAt).toLocaleDateString()}` : ''}
            </strong>
            This approved configuration is protected and read-only. To change the asset, create a
            new draft version — the locked version stays available for consistent reuse.
          </div>
        </div>
        <Card>
          <CardBody>
            <div className="lf-models-toolbar">
              <Badge tone="locked"><LockIcon size={12} /> Read-only</Badge>
              <Badge tone="neutral">{RIGHTS_LABELS[selectedVersion.rightsStatus]}</Badge>
              <div className="lf-modelcard__actions" style={{ marginLeft: 'auto' }}>
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<PlusIcon size={12} />}
                  disabled={draft !== null}
                  title={draft !== null ? 'Finish the open draft first' : undefined}
                  onClick={() => navigate(`${basePath}/versions?create-draft=${selectedVersion.id}`)}
                >
                  Create new draft version
                </Button>
              </div>
            </div>
            <div className="lf-formstack">
              {DETAIL_FIELDS.map((field) => (
                <div className="lf-sheet__section" key={field.key}>
                  <h4>{field.label}</h4>
                  <div className={String(form[field.key] ?? '').trim() === '' ? 'lf-readonly lf-readonly--empty' : 'lf-readonly'}>
                    {String(form[field.key] ?? '').trim() === '' ? 'Not recorded yet' : form[field.key]}
                  </div>
                </div>
              ))}
              {extraKeys.map((key) => (
                <div className="lf-sheet__section" key={key}>
                  <h4>{key}</h4>
                  <div className="lf-readonly">{form[key]}</div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <form
      className="lf-section"
      style={{ gap: 'var(--lf-space-4)' }}
      onSubmit={(event) => {
        event.preventDefault();
        void saveDraft();
      }}
    >
      <Card>
        <CardBody>
          <div className="lf-models-toolbar">
            <Badge tone="primary" dot>Draft — editing v{selectedVersion.versionNumber}</Badge>
            <div className="lf-modelcard__actions" style={{ marginLeft: 'auto' }}>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save draft'}
              </Button>
            </div>
          </div>
          <div className="lf-formstack">
            {DETAIL_FIELDS.map((field) => (
              <Input
                key={field.key}
                label={field.label}
                value={form[field.key] ?? ''}
                hint={field.hint}
                onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
              />
            ))}
            {extraKeys.map((key) => (
              <Input
                key={key}
                label={key}
                value={form[key] ?? ''}
                onChange={(event) => setForm({ ...form, [key]: event.target.value })}
              />
            ))}
          </div>
        </CardBody>
      </Card>
      <div className="lf-enveditor__mobilesave">
        <Button type="submit" variant="primary" style={{ width: '100%' }} disabled={saving}>
          {saving ? 'Saving…' : 'Save draft'}
        </Button>
      </div>
    </form>
  );
}
