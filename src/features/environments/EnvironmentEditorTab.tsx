/**
 * Environment editor — the guided spec form for DRAFT versions.
 *
 * Sections: basic setting, visual anchors, physical anchors (ordered
 * structured entries the user can add/edit/delete/reorder — defining anchors,
 * not generated media), and lock configuration. Locked versions render a
 * protected read-only state with "Create new draft version" as the only
 * modification path. Saving goes through the service layer with
 * schema-validated payloads; there is no autosave (explicit "Save draft").
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { EnvironmentIcon, LockIcon, PlusIcon } from '../../components/icons';
import {
  validateUpdateEnvironmentSpec,
  validateUpdateEnvironmentVersionDraft,
} from '../../domain/environments';
import type {
  EnvironmentSpecRecord,
  EnvironmentVersionRecord,
  SpecJson,
} from '../../domain/environments';
import type { EnvironmentsService } from '../../services/environmentsService';
import { SEED_ENVIRONMENT_WORKSPACE_ID } from '../../mock/environmentsSeed';
import { LOCK_LEVEL_HELP } from './envLockReview';
import { findDraftEnvironmentVersion, type EnvironmentState } from './useEnvironmentData';
import { jsonToText } from './envDiff';

const LOCK_LEVELS = ['flexible', 'balanced', 'strict'] as const;

interface EditorFormState {
  name: string;
  roomType: string;
  layoutFeel: string;
  continuityNotes: string;
  heroAngle: string;
  lightingStyle: string;
  paletteText: string;
  productZoneText: string;
  furnitureItems: string[];
  signatureItems: string[];
  lockLevel: (typeof LOCK_LEVELS)[number];
}

function orderedItems(json: SpecJson | undefined): string[] {
  if (!json) return [];
  const raw = Array.isArray(json.items) ? json.items : Object.keys(json);
  return raw.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
}

function specToForm(
  spec: EnvironmentSpecRecord,
  version: EnvironmentVersionRecord,
  name: string,
): EditorFormState {
  return {
    name,
    roomType: spec.roomType,
    layoutFeel: spec.layoutFeel,
    continuityNotes: spec.continuityNotes,
    heroAngle: spec.heroAngle,
    lightingStyle: spec.lightingStyle,
    paletteText: jsonToText(spec.paletteMaterials),
    productZoneText: jsonToText(spec.productZone),
    furnitureItems: orderedItems(spec.furnitureAnchors),
    signatureItems: orderedItems(spec.signatureProps),
    lockLevel: version.lockLevel,
  };
}

/** Build a JSON payload from the ordered editor list, preserving structure. */
function itemsToJson(
  current: SpecJson | undefined,
  items: string[],
): SpecJson {
  const base = current && !Array.isArray(current) ? { ...current } : {};
  const previous = Array.isArray((current as { items?: unknown })?.items)
    ? ((current as { items: unknown[] }).items as unknown[])
    : [];
  return {
    ...base,
    items: items.map((item, index) => {
      // Keep non-string previous entries stable; text entries map by position.
      const prior = previous[index];
      return typeof prior === 'string' ? item : prior ?? item;
    }),
  };
}

function paletteTextToJson(current: SpecJson | undefined, text: string): SpecJson {
  const base = current && !Array.isArray(current) ? { ...current } : {};
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const entries: Record<string, string> = {};
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      entries[`material${Object.keys(entries).length + 1}`] = line;
    } else {
      entries[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }
  return { ...base, ...entries };
}

function productZoneTextToJson(current: SpecJson | null, text: string): SpecJson | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const base = current && !Array.isArray(current) ? { ...current } : {};
  return { ...base, ...paletteTextToJson(undefined, trimmed) };
}

interface OrderedAnchorListProps {
  label: string;
  hint: string;
  items: string[];
  onChange: (items: string[]) => void;
}

/** Add / edit / delete / reorder list for structured anchor entries. */
function OrderedAnchorList({ label, hint, items, onChange }: OrderedAnchorListProps) {
  function update(index: number, value: string) {
    onChange(items.map((item, i) => (i === index ? value : item)));
  }
  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }
  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <fieldset className="lf-envform__group">
      <legend className="lf-field__label">{label}</legend>
      <p className="lf-field__hint">{hint}</p>
      {items.length === 0 ? (
        <p className="lf-tile__description">No entries yet — add the first one below.</p>
      ) : (
        <ol className="lf-envform__list">
          {items.map((item, index) => (
            <li key={index} className="lf-envform__listitem">
              <span className="lf-envform__index" aria-hidden="true">{index + 1}</span>
              <Input
                label={`${label} entry ${index + 1}`}
                hideLabel
                value={item}
                onChange={(event) => update(index, event.target.value)}
              />
              <div className="lf-envform__listactions">
                <button
                  type="button"
                  className="lf-iconbtn"
                  aria-label={`Move ${label} entry ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="lf-iconbtn"
                  aria-label={`Move ${label} entry ${index + 1} down`}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="lf-iconbtn"
                  aria-label={`Remove ${label} entry ${index + 1}`}
                  onClick={() => remove(index)}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        leftIcon={<PlusIcon size={14} />}
        onClick={() => onChange([...items, ''])}
      >
        Add entry
      </Button>
    </fieldset>
  );
}

interface EditorTabProps {
  service: EnvironmentsService;
  versions: EnvironmentVersionRecord[];
  activeVersionId: string | null;
  data: EnvironmentState;
  basePath: string;
}

export function EnvironmentEditorTab({
  service,
  versions,
  activeVersionId,
  data,
  basePath,
}: EditorTabProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const requested = searchParams.get('version');
  const draft = useMemo(() => findDraftEnvironmentVersion(versions), [versions]);
  const selectedVersion = useMemo(() => {
    if (requested) {
      const match = versions.find((version) => version.id === requested);
      if (match) return match;
    }
    // Default: the open draft, otherwise the active version.
    return draft ?? versions.find((version) => version.id === activeVersionId) ?? versions[0] ?? null;
  }, [requested, versions, draft, activeVersionId]);

  const [spec, setSpec] = useState<EnvironmentSpecRecord | null>(null);
  const [sheetState, setSheetState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [form, setForm] = useState<EditorFormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedVersion) return;
    let cancelled = false;
    setSheetState('loading');
    setSheetError(null);

    (async () => {
      try {
        const record = await service.getSpec(selectedVersion.id, SEED_ENVIRONMENT_WORKSPACE_ID);
        if (cancelled) return;
        setSpec(record);
        setForm(specToForm(record, selectedVersion, data.environment?.name ?? ''));
        setFieldErrors([]);
        setSheetState('ready');
      } catch (err) {
        if (cancelled) return;
        setSheetError(err instanceof Error ? err.message : 'Failed to load the spec.');
        setSheetState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, selectedVersion?.id]);

  if (data.state === 'ready' && versions.length === 0) {
    return (
      <EmptyState
        icon={<EnvironmentIcon size={22} />}
        title="No versions yet"
        description="This environment has no spec versions. Create the first draft from the profile header."
      />
    );
  }

  if (sheetState === 'loading') {
    return (
      <div aria-busy="true">
        <Skeleton variant="rect" height={44} />
        <div style={{ height: 'var(--lf-space-4)' }} />
        <Skeleton lines={8} />
      </div>
    );
  }

  if (sheetState === 'error' || !spec || !selectedVersion || !form) {
    return (
      <EmptyState
        icon={<EnvironmentIcon size={22} />}
        title="Couldn't load the Environment Specs"
        description={sheetError ?? undefined}
        actions={<Button onClick={() => data.reload()}>Try again</Button>}
      />
    );
  }

  const isLocked = selectedVersion.status === 'locked';
  const isSuperseded = selectedVersion.status === 'superseded';
  const editable = selectedVersion.status === 'draft';

  function updateField<K extends keyof EditorFormState>(key: K, value: EditorFormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  async function saveDraft(thenReview: boolean) {
    if (!form || !spec || !selectedVersion) return;
    setSaving(true);
    setFieldErrors([]);
    try {
      // 1. Environment-level fields (name) — validated separately.
      if (form.name.trim() !== (data.environment?.name ?? '')) {
        await service.updateEnvironmentDraft(
          data.environment!.id,
          validateEnvironmentName(form.name),
          SEED_ENVIRONMENT_WORKSPACE_ID,
        );
      }

      // 2. Version-level fields (lock level) — draft-only, validated.
      if (form.lockLevel !== selectedVersion.lockLevel) {
        const versionPatch = { lockLevel: form.lockLevel };
        const check = validateUpdateEnvironmentVersionDraft(versionPatch);
        if (!check.ok) throw new Error(check.errors.join('; '));
        await service.updateVersionDraft(selectedVersion.id, versionPatch, SEED_ENVIRONMENT_WORKSPACE_ID);
      }

      // 3. Spec anchors — validated through the domain schema, service-guarded.
      const patch = {
        roomType: form.roomType,
        layoutFeel: form.layoutFeel,
        continuityNotes: form.continuityNotes,
        heroAngle: form.heroAngle,
        lightingStyle: form.lightingStyle,
        paletteMaterials: paletteTextToJson(spec.paletteMaterials, form.paletteText),
        productZone: productZoneTextToJson(spec.productZone, form.productZoneText),
        furnitureAnchors: itemsToJson(spec.furnitureAnchors, form.furnitureItems),
        signatureProps: itemsToJson(spec.signatureProps, form.signatureItems),
      };
      const check = validateUpdateEnvironmentSpec(patch);
      if (!check.ok) throw new Error(check.errors.join('; '));
      await service.updateSpec(selectedVersion.id, check.value, SEED_ENVIRONMENT_WORKSPACE_ID);

      toast({ title: 'Draft saved', description: 'Your environment spec changes are stored.', tone: 'success' });
      await data.reload();
      if (thenReview) navigate(`${basePath}/lock?version=${selectedVersion.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save the draft.';
      toast({ title: 'Save failed', description: message, tone: 'error' });
      setFieldErrors([message]);
    } finally {
      setSaving(false);
    }
  }

  function validateEnvironmentName(name: string): { name: string } {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      throw new Error('name must be 1–80 characters');
    }
    return { name: trimmed };
  }

  if (isLocked || isSuperseded) {
    return (
      <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
        <div className="lf-lockedbanner">
          <LockIcon size={20} />
          <div className="lf-lockedbanner__copy">
            <strong>
              v{selectedVersion.versionNumber} — {selectedVersion.status}
              {selectedVersion.lockedAt ? ` ${new Date(selectedVersion.lockedAt).toLocaleDateString()}` : ''}
            </strong>
            This version is protected. Its defining anchors are read-only and can never be
            overwritten. To change the environment, create a new draft version — the locked one
            stays available for every future content job.
          </div>
        </div>

        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Protected spec (read-only)</h3>
            <ReadonlySection label="Room type" value={spec.roomType} />
            <ReadonlySection label="Layout feel" value={spec.layoutFeel} />
            <ReadonlySection label="Hero angle" value={spec.heroAngle} />
            <ReadonlySection label="Lighting style" value={spec.lightingStyle} />
            <ReadonlySection label="Furniture anchors" value={jsonToText(spec.furnitureAnchors)} />
            <ReadonlySection label="Signature props" value={jsonToText(spec.signatureProps)} />
            <ReadonlySection label="Palette & materials" value={jsonToText(spec.paletteMaterials)} />
            <ReadonlySection label="Product zone" value={jsonToText(spec.productZone)} />
            <ReadonlySection label="Continuity notes" value={spec.continuityNotes} />
            <div className="lf-envpanel__actions">
              <Button
                variant="primary"
                leftIcon={<PlusIcon size={14} />}
                onClick={() => navigate(`${basePath}/versions?create-draft=${selectedVersion.id}`)}
              >
                Create new draft version
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="lf-enveditor">
      <form
        className="lf-enveditor__form"
        onSubmit={(event) => {
          event.preventDefault();
          void saveDraft(false);
        }}
      >
        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">1. Basic setting</h3>
            <Input
              label="Environment name"
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              disabled={!editable}
            />
            <Input
              label="Room type"
              value={form.roomType}
              onChange={(event) => updateField('roomType', event.target.value)}
              disabled={!editable}
              hint="e.g. bedroom creator setup, loft kitchen"
            />
            <Input
              label="Layout feel"
              value={form.layoutFeel}
              onChange={(event) => updateField('layoutFeel', event.target.value)}
              disabled={!editable}
              hint="The mood of the layout, e.g. warm, lived-in, clean creator corner"
            />
            <label className="lf-field">
              <span className="lf-field__label">Continuity notes</span>
              <textarea
                className="lf-input lf-envform__textarea"
                rows={3}
                value={form.continuityNotes}
                disabled={!editable}
                onChange={(event) => updateField('continuityNotes', event.target.value)}
              />
              <span className="lf-field__hint">
                What must stay consistent between jobs (composition, light direction…).
              </span>
            </label>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">2. Visual anchors</h3>
            <Input
              label="Hero camera angle"
              value={form.heroAngle}
              onChange={(event) => updateField('heroAngle', event.target.value)}
              disabled={!editable}
              hint="The signature viewing angle, e.g. three-quarter angle facing desk and vanity"
            />
            <Input
              label="Lighting style"
              value={form.lightingStyle}
              onChange={(event) => updateField('lightingStyle', event.target.value)}
              disabled={!editable}
              hint="e.g. soft morning window light with warm practical lamp"
            />
            <label className="lf-field">
              <span className="lf-field__label">Palette / material direction</span>
              <textarea
                className="lf-input lf-envform__textarea"
                rows={3}
                value={form.paletteText}
                disabled={!editable}
                onChange={(event) => updateField('paletteText', event.target.value)}
              />
              <span className="lf-field__hint">One “key: value” line per palette or material entry.</span>
            </label>
            <label className="lf-field">
              <span className="lf-field__label">Product zone (optional)</span>
              <textarea
                className="lf-input lf-envform__textarea"
                rows={2}
                value={form.productZoneText}
                disabled={!editable}
                onChange={(event) => updateField('productZoneText', event.target.value)}
              />
              <span className="lf-field__hint">
                Where products are presented, if this environment showcases them.
              </span>
            </label>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">3. Physical anchors</h3>
            <p className="lf-tile__description">
              These entries are defining anchors of the environment — descriptions the content
              jobs will follow, not generated media.
            </p>
            <OrderedAnchorList
              label="Furniture anchors"
              hint="Key furniture that anchors the layout, in order of importance."
              items={form.furnitureItems}
              onChange={(items) => updateField('furnitureItems', items)}
            />
            <OrderedAnchorList
              label="Signature props"
              hint="Recognisable dressing that makes the setting feel continuous."
              items={form.signatureItems}
              onChange={(items) => updateField('signatureItems', items)}
            />
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">4. Lock configuration</h3>
            <fieldset className="lf-envform__group">
              <legend className="lf-field__label">Lock level</legend>
              <div className="lf-envform__segments" role="radiogroup" aria-label="Lock level">
                {LOCK_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={form.lockLevel === level}
                    className={`lf-envform__segment${form.lockLevel === level ? ' lf-envform__segment--active' : ''}`}
                    disabled={!editable}
                    onClick={() => updateField('lockLevel', level)}
                  >
                    <strong>{level}</strong>
                    <span>{LOCK_LEVEL_HELP[level]}</span>
                  </button>
                ))}
              </div>
              <p className="lf-field__hint">
                Stored on this version and frozen when it locks.
              </p>
            </fieldset>
          </CardBody>
        </Card>

        {fieldErrors.length > 0 ? (
          <div className="lf-alertbox" role="alert">
            <ul>
              {fieldErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </form>

      <div className="lf-enveditor__side">
        <Card>
          <CardBody>
            <div className="lf-enveditor__status">
              <Badge tone={editable ? 'primary' : 'locked'}>
                {editable ? 'Draft — editing' : `v${selectedVersion.versionNumber} ${selectedVersion.status}`}
              </Badge>
              <span className="lf-tile__description">
                {editable
                  ? 'Saving updates this draft only. Locked versions are never touched.'
                  : 'This version is protected.'}
              </span>
            </div>
            {editable ? (
              <div className="lf-enveditor__actions">
                <Button type="button" onClick={() => void saveDraft(false)} disabled={saving}>
                  {saving ? 'Saving…' : 'Save draft'}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void saveDraft(true)}
                  disabled={saving}
                >
                  Save & review to lock
                </Button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {/* Sticky mobile save action */}
      {editable ? (
        <div className="lf-enveditor__mobilesave">
          <Button
            type="button"
            variant="primary"
            style={{ width: '100%' }}
            onClick={() => void saveDraft(false)}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save draft'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ReadonlySection({ label, value }: { label: string; value: string }) {
  return (
    <div className="lf-sheet__section">
      <h4>{label}</h4>
      <div className={value.trim() === '' ? 'lf-readonly lf-readonly--empty' : 'lf-readonly'}>
        {value.trim() === '' ? 'Not recorded yet' : value}
      </div>
    </div>
  );
}
