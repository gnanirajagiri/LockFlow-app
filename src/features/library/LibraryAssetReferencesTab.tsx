/**
 * Library asset References tab — reference metadata grouped by type
 * (Front, Back, Detail, In context, Label, Material, Other). Draft versions
 * may add, rename, reorder and remove; locked versions are read-only.
 * A disabled zone marks where secure upload lands next — no image
 * recognition or upload processing is claimed or implemented.
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
  LibraryReferenceRecord,
  LibraryReferenceType,
} from '../../domain/library';
import { REFERENCE_TYPE_LABELS } from './libraryUi';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import { useLibraryOutletContext } from './tabRoutes';
import { useSelectedAssetVersion } from './useLibraryData';

const REFERENCE_TYPES = Object.keys(REFERENCE_TYPE_LABELS) as LibraryReferenceType[];

export function LibraryAssetReferencesTab() {
  const { service, data, basePath } = useLibraryOutletContext();
  void basePath;
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const requested = searchParams.get('version');
  const selectedVersion = useSelectedAssetVersion(
    data.versions,
    data.asset?.activeVersionId ?? null,
    requested,
  );
  const editable = selectedVersion?.status === 'draft';

  const [references, setReferences] = useState<LibraryReferenceRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<LibraryReferenceType | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Array<{ id: string; type: LibraryReferenceType; caption: string; path: string }>>([]);

  useEffect(() => {
    if (!selectedVersion) return;
    let cancelled = false;
    service
      .getReferences(selectedVersion.id, SEED_LIBRARY_WORKSPACE_ID)
      .then((records) => {
        if (!cancelled) {
          setReferences(records);
          setRows(records.map((r) => ({ id: r.id, type: r.referenceType, caption: r.caption, path: r.storagePath })));
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
    () => (references ?? []).filter((r) => groupFilter === 'all' || r.referenceType === groupFilter),
    [references, groupFilter],
  );

  async function persist() {
    if (!selectedVersion || !editable || !references) return;
    setBusy(true);
    try {
      const keep = new Set(rows.map((row) => row.id).filter((id) => references.some((r) => r.id === id)));
      for (const record of references) {
        if (!keep.has(record.id)) {
          await service.removeReference(selectedVersion.id, record.id, SEED_LIBRARY_WORKSPACE_ID);
        }
      }
      for (const row of rows) {
        const existing = references.find((r) => r.id === row.id);
        if (!existing) {
          await service.addReference(
            selectedVersion.id,
            { storagePath: row.path, referenceType: row.type, caption: row.caption },
            SEED_LIBRARY_WORKSPACE_ID,
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
            SEED_LIBRARY_WORKSPACE_ID,
          );
        }
      }
      const fresh = await service.getReferences(selectedVersion.id, SEED_LIBRARY_WORKSPACE_ID);
      setReferences(fresh);
      setRows(fresh.map((r) => ({ id: r.id, type: r.referenceType, caption: r.caption, path: r.storagePath })));
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
          <label className="lf-field__label" htmlFor="libref-type">Reference type</label>
          <select
            id="libref-type"
            className="lf-input"
            value={groupFilter}
            onChange={(event) => setGroupFilter(event.target.value as LibraryReferenceType | 'all')}
          >
            <option value="all">All types</option>
            {REFERENCE_TYPES.map((type) => (
              <option key={type} value={type}>{REFERENCE_TYPE_LABELS[type]}</option>
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

      {!editable && references !== null && visible.length > 0 ? (
        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">References (read-only)</h3>
            <ul className="lf-envref__list">
              {visible.map((record) => (
                <li key={record.id} className="lf-envref__item">
                  <div className="lf-envref__frame" aria-hidden="true" />
                  <div>
                    <strong>{record.caption || 'Untitled reference'}</strong>
                    <span className="lf-tile__description">
                      {REFERENCE_TYPE_LABELS[record.referenceType]} · {record.storagePath}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {editable && references !== null ? (
        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Reference metadata (draft)</h3>
            <p className="lf-tile__description">
              Rename, retype or reorder entries. Paths are local placeholders until secure
              uploads connect — nothing is scanned or processed.
            </p>
            <ol className="lf-envform__list">
              {rows.map((row, index) => (
                <li key={row.id} className="lf-envform__listitem lf-envform__listitem--stacked">
                  <div className="lf-envref__row">
                    <Input
                      label={`Reference ${index + 1} caption`}
                      hideLabel
                      value={row.caption}
                      onChange={(event) =>
                        setRows((current) => current.map((r, i) => (i === index ? { ...r, caption: event.target.value } : r)))
                      }
                    />
                    <select
                      className="lf-input"
                      aria-label={`Reference ${index + 1} type`}
                      value={row.type}
                      onChange={(event) =>
                        setRows((current) => current.map((r, i) => (i === index ? { ...r, type: event.target.value as LibraryReferenceType } : r)))
                      }
                    >
                      {REFERENCE_TYPES.map((type) => (
                        <option key={type} value={type}>{REFERENCE_TYPE_LABELS[type]}</option>
                      ))}
                    </select>
                    <div className="lf-envform__listactions">
                      <button
                        type="button"
                        className="lf-iconbtn"
                        aria-label={`Move reference ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() =>
                          setRows((current) => {
                            const next = [...current];
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
                        disabled={index === rows.length - 1}
                        onClick={() =>
                          setRows((current) => {
                            const next = [...current];
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
                        onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <Input
                    label={`Reference ${index + 1} storage path`}
                    hideLabel
                    value={row.path}
                    hint="Local placeholder path (e.g. placeholders/library/…)"
                    onChange={(event) =>
                      setRows((current) => current.map((r, i) => (i === index ? { ...r, path: event.target.value } : r)))
                    }
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
                  setRows((current) => [
                    ...current,
                    {
                      id: `new-${crypto.randomUUID()}`,
                      type: 'other',
                      caption: '',
                      path: `placeholders/library/new-${current.length + 1}.svg`,
                    },
                  ])
                }
              >
                Add reference
              </Button>
              <Button type="button" variant="primary" onClick={() => void persist()} disabled={busy}>
                {busy ? 'Saving…' : 'Save references'}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody>
          <div className="lf-envref__upload" aria-disabled="true">
            <strong>Secure reference upload will be connected next.</strong>
            <span className="lf-tile__description">
              Until then this page manages reference metadata with local placeholders only — no
              image recognition or upload processing exists.
            </span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
