/**
 * References tab — reference-metadata management for the selected version.
 *
 * Draft versions may add, rename, reorder and remove reference metadata
 * (storage paths stay local placeholders; uploads arrive with secure storage
 * next). Locked and superseded versions are read-only. There is no image
 * scanning or AI here — captions and paths only.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { EnvironmentIcon, LockIcon, PlusIcon } from '../../components/icons';
import type {
  EnvironmentReferenceRecord,
  EnvironmentReferenceType,
  EnvironmentVersionRecord,
} from '../../domain/environments';
import type { EnvironmentsService } from '../../services/environmentsService';
import { SEED_ENVIRONMENT_WORKSPACE_ID } from '../../mock/environmentsSeed';
import { findDraftEnvironmentVersion, type EnvironmentState } from './useEnvironmentData';

const REFERENCE_TYPES: Array<{ value: EnvironmentReferenceType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'wide', label: 'Wide' },
  { value: 'hero_angle', label: 'Hero angle' },
  { value: 'detail', label: 'Detail' },
  { value: 'layout', label: 'Layout' },
  { value: 'lighting', label: 'Lighting' },
  { value: 'product_zone', label: 'Product zone' },
  { value: 'other', label: 'Other' },
];

interface ReferencesTabProps {
  service: EnvironmentsService;
  versions: EnvironmentVersionRecord[];
  data: EnvironmentState;
  basePath: string;
}

export function EnvironmentReferencesTab({ service, versions, data, basePath }: ReferencesTabProps) {
  void basePath;
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const requested = searchParams.get('version');
  const draft = useMemo(() => findDraftEnvironmentVersion(versions), [versions]);
  const selectedVersion = useMemo(() => {
    if (requested) {
      const match = versions.find((version) => version.id === requested);
      if (match) return match;
    }
    return draft ?? versions.find((version) => version.id === data.environment?.activeVersionId) ?? versions[0] ?? null;
  }, [requested, versions, draft, data.environment?.activeVersionId]);

  const [references, setReferences] = useState<EnvironmentReferenceRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<EnvironmentReferenceType | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [draftRows, setDraftRows] = useState<Array<{ id: string; type: EnvironmentReferenceType; caption: string; path: string }>>([]);

  const editable = selectedVersion?.status === 'draft';

  useEffect(() => {
    if (!selectedVersion) return;
    let cancelled = false;
    service
      .getReferences(selectedVersion.id, SEED_ENVIRONMENT_WORKSPACE_ID)
      .then((rows) => {
        if (!cancelled) {
          setReferences(rows);
          setDraftRows(
            rows.map((row) => ({ id: row.id, type: row.referenceType, caption: row.caption, path: row.storagePath })),
          );
          setLoadError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load references.');
      });
    return () => {
      cancelled = true;
    };
  }, [service, selectedVersion?.id]);

  const visible = useMemo(
    () => (references ?? []).filter((row) => filter === 'all' || row.referenceType === filter),
    [references, filter],
  );

  async function persistDraftRows() {
    if (!selectedVersion || !editable || !references) return;
    setBusy(true);
    try {
      // Simplest honest persistence for metadata-only rows: rewrite the draft's
      // reference set via add/remove on the service boundary. The mock keeps
      // metadata in memory; the Supabase path inserts/removes rows by id.
      const keep = new Set(draftRows.map((row) => row.id).filter((id) => references.some((r) => r.id === id)));
      for (const row of references) {
        if (!keep.has(row.id)) {
          await service.removeReference(selectedVersion.id, row.id, SEED_ENVIRONMENT_WORKSPACE_ID);
        }
      }
      for (const row of draftRows) {
        const existing = references.find((r) => r.id === row.id);
        if (!existing) {
          await service.addReference(
            selectedVersion.id,
            { storagePath: row.path, referenceType: row.type, caption: row.caption },
            SEED_ENVIRONMENT_WORKSPACE_ID,
          );
        } else if (
          existing.caption !== row.caption ||
          existing.referenceType !== row.type ||
          existing.storagePath !== row.path
        ) {
          await service.updateReference(
            selectedVersion.id,
            row.id,
            { caption: row.caption, referenceType: row.type, storagePath: row.path },
            SEED_ENVIRONMENT_WORKSPACE_ID,
          );
        }
      }
      const fresh = await service.getReferences(selectedVersion.id, SEED_ENVIRONMENT_WORKSPACE_ID);
      setReferences(fresh);
      setDraftRows(fresh.map((row) => ({ id: row.id, type: row.referenceType, caption: row.caption, path: row.storagePath })));
      toast({ title: 'References saved', description: 'Reference metadata updated on this draft.', tone: 'success' });
      await data.reload();
    } catch (err) {
      toast({
        title: 'Could not save references',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  if (!selectedVersion) {
    return (
      <EmptyState
        icon={<EnvironmentIcon size={22} />}
        title="No versions yet"
        description="References attach to versions. Create the first draft from the profile header."
      />
    );
  }

  return (
    <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
      <div className="lf-models-toolbar">
        <div className="lf-models-toolbar__filter">
          <label className="lf-field__label" htmlFor="envref-type">Reference type</label>
          <select
            id="envref-type"
            className="lf-input"
            value={filter}
            onChange={(event) => setFilter(event.target.value as EnvironmentReferenceType | 'all')}
          >
            {REFERENCE_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="lf-envref__state">
          {selectedVersion.status === 'locked' ? (
            <Badge tone="locked"><LockIcon size={12} /> Read-only — version locked</Badge>
          ) : selectedVersion.status === 'superseded' ? (
            <Badge tone="neutral">Read-only — superseded</Badge>
          ) : (
            <Badge tone="primary">Draft — metadata editable</Badge>
          )}
        </div>
      </div>

      {loadError ? <div className="lf-alertbox" role="alert">{loadError}</div> : null}
      {references === null && !loadError ? <Skeleton lines={4} /> : null}

      {references !== null && visible.length === 0 ? (
        <EmptyState
          icon={<EnvironmentIcon size={22} />}
          title="No references of this type"
          description="Add reference metadata below on a draft, or pick another type filter."
        />
      ) : null}

      {editable && references !== null ? (
        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Reference metadata (draft)</h3>
            <p className="lf-tile__description">
              Rename, retype or reorder entries. Paths are local placeholders until uploads are
              connected — no images are scanned or generated.
            </p>
            <ol className="lf-envform__list">
              {draftRows.map((row, index) => (
                <li key={row.id} className="lf-envform__listitem lf-envform__listitem--stacked">
                  <div className="lf-envref__row">
                    <Input
                      label={`Reference ${index + 1} caption`}
                      hideLabel
                      value={row.caption}
                      onChange={(event) =>
                        setDraftRows((rows) => rows.map((r, i) => (i === index ? { ...r, caption: event.target.value } : r)))
                      }
                    />
                    <select
                      className="lf-input"
                      aria-label={`Reference ${index + 1} type`}
                      value={row.type}
                      onChange={(event) =>
                        setDraftRows((rows) => rows.map((r, i) => (i === index ? { ...r, type: event.target.value as EnvironmentReferenceType } : r)))
                      }
                    >
                      {REFERENCE_TYPES.filter((t) => t.value !== 'all').map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <div className="lf-envform__listactions">
                      <button
                        type="button"
                        className="lf-iconbtn"
                        aria-label={`Move reference ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() =>
                          setDraftRows((rows) => {
                            const next = [...rows];
                            [next[index - 1], next[index]] = [next[index], next[index - 1]];
                            return next;
                          })
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="lf-iconbtn"
                        aria-label={`Move reference ${index + 1} down`}
                        disabled={index === draftRows.length - 1}
                        onClick={() =>
                          setDraftRows((rows) => {
                            const next = [...rows];
                            [next[index + 1], next[index]] = [next[index], next[index + 1]];
                            return next;
                          })
                        }
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="lf-iconbtn"
                        aria-label={`Remove reference ${index + 1}`}
                        onClick={() => setDraftRows((rows) => rows.filter((_, i) => i !== index))}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <Input
                    label={`Reference ${index + 1} storage path`}
                    hideLabel
                    value={row.path}
                    onChange={(event) =>
                      setDraftRows((rows) => rows.map((r, i) => (i === index ? { ...r, path: event.target.value } : r)))
                    }
                    hint="Local placeholder path (e.g. placeholders/environments/…)"
                  />
                </li>
              ))}
            </ol>
            <div className="lf-envpanel__actions">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leftIcon={<PlusIcon size={14} />}
                onClick={() =>
                  setDraftRows((rows) => [
                    ...rows,
                    {
                      id: `new-${crypto.randomUUID()}`,
                      type: 'other',
                      caption: '',
                      path: `placeholders/environments/${data.environment?.slug ?? 'env'}/new-${rows.length + 1}.svg`,
                    },
                  ])
                }
              >
                Add reference
              </Button>
              <Button type="button" variant="primary" onClick={() => void persistDraftRows()} disabled={busy}>
                {busy ? 'Saving…' : 'Save references'}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {!editable && references !== null && references.length > 0 ? (
        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">References (read-only)</h3>
            <ul className="lf-envref__list">
              {visible.map((row) => (
                <li key={row.id} className="lf-envref__item">
                  <div className="lf-envref__frame" aria-hidden="true" />
                  <div>
                    <strong>{row.caption || 'Untitled reference'}</strong>
                    <span className="lf-tile__description">
                      {row.referenceType.replace('_', ' ')} · {row.storagePath}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody>
          <div className="lf-envref__upload" aria-disabled="true">
            <strong>Reference upload will be connected to secure storage next</strong>
            <span className="lf-tile__description">
              Until then this page manages reference metadata with local placeholders only.
            </span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
