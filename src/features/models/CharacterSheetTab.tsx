/**
 * Character Sheet tab — the versioned identity record.
 *
 * Draft versions render an accessible editing form (validated through the
 * domain schemas, saved via the service layer). Locked versions render every
 * field read-only with a visible locked state and the create-draft action —
 * no pathway in this UI updates a locked version directly.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { LockIcon, PlusIcon, UserIcon } from '../../components/icons';
import { ModelsService } from '../../services/modelsService';
import { SEED_WORKSPACE_ID } from '../../mock/modelsSeed';
import { findDraftVersion, type ModelState } from './useModelData';
import { validateUpdateCharacterSheet } from '../../domain/models';
import type {
  CharacterSheetRecord,
  ModelReferenceRecord,
  ModelVersionRecord,
  SheetTraits,
  UpdateCharacterSheetInput,
} from '../../domain/models';

const LOCKED_COPY =
  'Identity traits are protected in locked versions. Clothing, props and environments can change without changing this identity.';

interface CharacterSheetTabProps {
  service: ModelsService;
  versions: ModelVersionRecord[];
  activeVersionId: string | null;
  data: ModelState;
  basePath: string;
}

/** Local placeholder references so the panel never needs external imagery. */
const PLACEHOLDER_REFERENCES: Array<{
  referenceType: ModelReferenceRecord['referenceType'];
  caption: string;
}> = [
  { referenceType: 'portrait', caption: 'Portrait — neutral expression' },
  { referenceType: 'full_body', caption: 'Full body — relaxed posture' },
  { referenceType: 'profile', caption: 'Profile — hairline and jawline' },
];

interface SheetFormState {
  identitySummary: string;
  referenceNotes: string;
  faceFeatures: string;
  hairIdentity: string;
  complexion: string;
  bodyProportions: string;
  distinctiveDetails: string;
  lockRules: string;
}

type FieldKey = Exclude<keyof SheetFormState, 'identitySummary' | 'referenceNotes'>;

const TRAIT_FIELD_LABELS: Array<{ key: FieldKey; label: string; hint: string }> = [
  { key: 'faceFeatures', label: 'Face & features', hint: 'Shape, eyes, brows, nose, lips, jawline — one “key: value” line per trait.' },
  { key: 'hairIdentity', label: 'Hair identity', hint: 'Colour, texture, length, parting — identity traits only (styling layers stay replaceable).' },
  { key: 'complexion', label: 'Complexion', hint: 'Skin tone, undertone, permanent features.' },
  { key: 'bodyProportions', label: 'Body proportions', hint: 'Height, build, posture.' },
  { key: 'distinctiveDetails', label: 'Distinctive details', hint: 'Marks, permanent jewellery or features that make this person recognisable.' },
  { key: 'lockRules', label: 'Lock rules', hint: 'Notes about what locking protects for this identity.' },
];

function traitsToText(traits: SheetTraits | undefined): string {
  if (!traits) return '';
  return Object.entries(traits)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');
}

function textToTraits(text: string): SheetTraits {
  const traits: SheetTraits = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(':');
    if (separator === -1) {
      traits[trimmed] = '';
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key) continue;
    try {
      traits[key] = JSON.parse(rawValue);
    } catch {
      traits[key] = rawValue;
    }
  }
  return traits;
}

function sheetToForm(sheet: CharacterSheetRecord): SheetFormState {
  return {
    identitySummary: sheet.identitySummary,
    referenceNotes: sheet.referenceNotes,
    faceFeatures: traitsToText(sheet.faceFeatures),
    hairIdentity: traitsToText(sheet.hairIdentity),
    complexion: traitsToText(sheet.complexion),
    bodyProportions: traitsToText(sheet.bodyProportions),
    distinctiveDetails: traitsToText(sheet.distinctiveDetails),
    lockRules: traitsToText(sheet.lockRules),
  };
}

export function CharacterSheetTab({
  service,
  versions,
  activeVersionId,
  data,
  basePath,
}: CharacterSheetTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  const requested = searchParams.get('version');
  const draft = useMemo(() => findDraftVersion(versions), [versions]);
  const selectedVersion = useMemo(() => {
    if (requested) {
      const match = versions.find((version) => version.id === requested);
      if (match) return match;
    }
    // Default: the open draft if one exists (so "Continue editing" and a
    // fresh draft land on the editable sheet), otherwise the active version.
    return draft ?? versions.find((version) => version.id === activeVersionId) ?? versions[0] ?? null;
  }, [requested, versions, draft, activeVersionId]);

  const [sheet, setSheet] = useState<CharacterSheetRecord | null>(null);
  const [sheetState, setSheetState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [form, setForm] = useState<SheetFormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!selectedVersion) return;
    let cancelled = false;
    setSheetState('loading');
    setSheetError(null);

    (async () => {
      try {
        const record = await service.getCharacterSheet(selectedVersion.id, SEED_WORKSPACE_ID);
        if (cancelled) return;
        setSheet(record);
        setForm(sheetToForm(record));
        setFieldErrors([]);
        setSheetState('ready');
      } catch (err) {
        if (cancelled) return;
        setSheetError(err instanceof Error ? err.message : 'Failed to load the Character Sheet.');
        setSheetState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [service, selectedVersion, retryTick]);

  if (data.state === 'ready' && versions.length === 0) {
    return (
      <EmptyState
        icon={<UserIcon size={22} />}
        title="No versions yet"
        description="This model has no Character Sheet versions. Create the first draft from the profile header."
      />
    );
  }

  if (sheetState === 'loading') {
    return (
      <div aria-busy="true">
        <Skeleton variant="rect" height={44} />
        <div style={{ height: 'var(--lf-space-4)' }} />
        <Skeleton lines={6} />
      </div>
    );
  }

  if (sheetState === 'error' || !sheet || !selectedVersion) {
    return (
      <EmptyState
        icon={<UserIcon size={22} />}
        title="Couldn't load the Character Sheet"
        description={sheetError ?? undefined}
        actions={
          <Button onClick={() => setRetryTick((tick) => tick + 1)}>Try again</Button>
        }
      />
    );
  }

  const isLocked = selectedVersion.status === 'locked';
  const isDraft = selectedVersion.status === 'draft';

  function updateField(key: keyof SheetFormState, value: string) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  async function handleSave() {
    if (!form || !selectedVersion || isLocked) return;

    // Build the patch locally, validate through the domain schema, then save
    // via the service (which re-checks the lock guard before writing).
    const patch: UpdateCharacterSheetInput = {
      identitySummary: form.identitySummary,
      referenceNotes: form.referenceNotes,
      faceFeatures: textToTraits(form.faceFeatures),
      hairIdentity: textToTraits(form.hairIdentity),
      complexion: textToTraits(form.complexion),
      bodyProportions: textToTraits(form.bodyProportions),
      distinctiveDetails: textToTraits(form.distinctiveDetails),
      lockRules: textToTraits(form.lockRules),
    };

    const result = validateUpdateCharacterSheet(patch);
    if (!result.ok) {
      setFieldErrors(result.errors);
      return;
    }
    setFieldErrors([]);
    setSaving(true);
    try {
      const saved = await service.updateCharacterSheet(selectedVersion.id, result.value, SEED_WORKSPACE_ID);
      setSheet(saved);
      setForm(sheetToForm(saved));
      toast({ title: 'Character Sheet saved', description: `v${selectedVersion.versionNumber} draft updated.`, tone: 'success' });
      data.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save the Character Sheet.';
      toast({ title: 'Save failed', description: message, tone: 'error' });
      setFieldErrors([message]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lf-sheet__layout">
      <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
        {isLocked ? (
          <div className="lf-lockedbanner">
            <LockIcon size={20} />
            <div className="lf-lockedbanner__copy">
              <strong>v{selectedVersion.versionNumber} — locked {selectedVersion.lockedAt ? new Date(selectedVersion.lockedAt).toLocaleDateString() : ''}</strong>
              {LOCKED_COPY}
            </div>
            <CreateDraftFromHere
              basePath={basePath}
              sourceVersionId={selectedVersion.id}
            />
          </div>
        ) : null}

        <Card>
          <CardBody>
            <div className="lf-sheet__form">
              {isDraft ? (
                <>
                  <SheetInput
                    label="Identity summary"
                    hint="One or two sentences that capture who this person is."
                    value={form?.identitySummary ?? ''}
                    onChange={(value) => updateField('identitySummary', value)}
                    multiline
                  />
                  {TRAIT_FIELD_LABELS.map(({ key, label, hint }) => (
                    <SheetInput
                      key={key}
                      label={label}
                      hint={hint}
                      value={form?.[key] ?? ''}
                      onChange={(value) => updateField(key, value)}
                      multiline
                    />
                  ))}
                  <SheetInput
                    label="Reference notes"
                    hint="Production notes — approvals, usage context."
                    value={form?.referenceNotes ?? ''}
                    onChange={(value) => updateField('referenceNotes', value)}
                    multiline
                  />
                  {fieldErrors.length > 0 ? (
                    <div className="lf-alertbox" role="alert">
                      <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
                        {fieldErrors.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="lf-modelprofile__actions-row" style={{ justifyContent: 'flex-start' }}>
                    <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
                      {saving ? 'Saving…' : 'Save draft'}
                    </Button>
                    <Button onClick={() => form && setForm(sheetToForm(sheet))} disabled={saving}>
                      Reset
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <ReadonlySection label="Identity summary" value={sheet.identitySummary} />
                  {TRAIT_FIELD_LABELS.map(({ key, label }) => (
                    <ReadonlySection key={key} label={label} value={form?.[key] ?? ''} />
                  ))}
                  <ReadonlySection label="Reference notes" value={sheet.referenceNotes} />
                </>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      <aside className="lf-sheet__aside">
        <Card>
          <CardBody>
            <div className="lf-sheet__section">
              <h3>Version</h3>
              <div className="lf-sheet__toolbar">
                <div className="lf-sheet__version-picker">
                  <label className="lf-visually-hidden" htmlFor="sheet-version-select">
                    Select version
                  </label>
                  <select
                    id="sheet-version-select"
                    className="lf-input"
                    value={selectedVersion.id}
                    onChange={(event) => setSearchParams({ version: event.target.value })}
                  >
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        v{version.versionNumber} — {version.status}
                      </option>
                    ))}
                  </select>
                </div>
                <Badge tone={isLocked ? 'locked' : 'primary'} dot>
                  {selectedVersion.status}
                </Badge>
              </div>
              <p className="lf-versionrow__dates">
                Created {new Date(selectedVersion.createdAt).toLocaleDateString()}
                {selectedVersion.lockedAt
                  ? ` · Locked ${new Date(selectedVersion.lockedAt).toLocaleDateString()}`
                  : ''}
              </p>
              {isDraft ? (
                <p className="lf-tile__description">
                  Draft — edit the fields, then lock the version from the Versions tab when the
                  identity is approved.
                </p>
              ) : (
                <LinkToVersions basePath={basePath} />
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody flush>
            <div style={{ padding: 'var(--lf-space-4)' }} className="lf-sheet__section">
              <h3>References</h3>
              <p className="lf-tile__description">
                Local placeholder frames — reference uploads arrive with the Model Builder.
              </p>
              <div className="lf-refgrid">
                {PLACEHOLDER_REFERENCES.map((reference) => (
                  <div key={reference.referenceType} className="lf-refcard">
                    <div className="lf-refcard__frame" aria-hidden="true">
                      <UserIcon size={20} />
                      <span className="lf-refcard__type">{reference.referenceType.replace('_', ' ')}</span>
                    </div>
                    <span className="lf-refcard__caption">{reference.caption}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}

function SheetInput({
  label,
  hint,
  value,
  onChange,
  multiline,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  const id = useMemo(() => `lf-sheet-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, [label]);
  return (
    <div className="lf-sheet__section">
      <label className="lf-field__label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          className="lf-textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      ) : (
        <input
          id={id}
          className="lf-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      )}
      {hint ? (
        <span className="lf-field__hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function ReadonlySection({ label, value }: { label: string; value: string }) {
  const isEmpty = value.trim() === '' || value.trim() === '—';
  return (
    <div className="lf-sheet__section">
      <h4>{label}</h4>
      <div className={`lf-readonly${isEmpty ? ' lf-readonly--empty' : ''}`}>
        {isEmpty ? 'Not recorded yet' : value}
      </div>
    </div>
  );
}

/**
 * Create-draft entry point on locked sheets. Rather than creating the draft
 * inline (which would bypass the required change summary), it routes into the
 * Versions tab's create-draft dialog with this version preselected — the
 * single path for starting a draft from a locked version.
 */
function CreateDraftFromHere({ basePath, sourceVersionId }: { basePath: string; sourceVersionId: string }) {
  const navigate = useNavigate();
  return (
    <Button
      variant="secondary"
      leftIcon={<PlusIcon size={14} />}
      onClick={() => navigate(`${basePath}/versions?create-draft=${sourceVersionId}`)}
    >
      Create new draft from this version
    </Button>
  );
}

function LinkToVersions({ basePath }: { basePath: string }) {
  return (
    <Link className="lf-linklike" to={`${basePath}/versions`}>
      Manage versions
    </Link>
  );
}
