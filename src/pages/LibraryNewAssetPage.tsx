/**
 * Add asset — a real manual asset-add flow. AI classification, image
 * scanning and secure uploads are future integrations (shown disabled, never
 * implied). Creates the asset + first draft version via the Library service.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/Toast';
import { CameraIcon, ScanIcon, SparkIcon } from '../components/icons';
import { LibraryService } from '../services/libraryService';
import { getLibraryRepository } from '../data/libraryFactory';
import { LIBRARY_ASSET_TYPES, normalizeTagName } from '../domain/library';
import { SEED_LIBRARY_WORKSPACE_ID } from '../mock/librarySeed';
import { ASSET_ADD_COPY, LIBRARY_HELPER_COPY } from '../features/library/libraryUi';
import type { LibraryAssetType } from '../domain/library';

const TYPE_OPTIONS: Array<{ value: LibraryAssetType; label: string }> = LIBRARY_ASSET_TYPES.filter(
  (type) => type !== 'look',
).map((type) => ({
  value: type,
  label: type === 'creator_tool' ? 'Creator tool' : type.replace('_', ' '),
}));

const FUTURE_CHOICES = [
  { icon: <CameraIcon size={18} />, label: 'Upload images', description: 'Secure storage integration comes next.' },
  { icon: <ScanIcon size={18} />, label: 'Scan an item', description: 'Item scanning is a future integration.' },
  { icon: <SparkIcon size={18} />, label: 'Describe with AI', description: 'AI classification is a future integration.' },
];

const STRUCTURED_FIELDS: Array<{ key: string; label: string; hint?: string }> = [
  { key: 'colour', label: 'Colour' },
  { key: 'material', label: 'Material' },
  { key: 'dimensions', label: 'Dimensions / fit' },
  { key: 'condition', label: 'Condition' },
  { key: 'keyDetails', label: 'Key details' },
  { key: 'usageNotes', label: 'Usage notes' },
];

export function LibraryNewAssetPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const service = useMemo(() => new LibraryService(getLibraryRepository()), []);

  const [name, setName] = useState('');
  const [assetType, setAssetType] = useState<LibraryAssetType | ''>('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [rightsStatus, setRightsStatus] = useState<'unknown' | 'confirmed' | 'restricted'>('unknown');
  const [rightsAcknowledged, setRightsAcknowledged] = useState(false);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function handleSaveDraft() {
    setSaving(true);
    setErrors([]);
    try {
      if (name.trim() === '') throw new Error('Asset name is required.');
      if (assetType === '') throw new Error('Choose an asset type.');

      const asset = await service.createAsset(
        {
          workspaceId: SEED_LIBRARY_WORKSPACE_ID,
          name: name.trim(),
          assetType: assetType as LibraryAssetType,
          ...(description.trim() ? { description: description.trim() } : {}),
        },
        'demo-user',
      );

      // Tags: create-or-link workspace-scoped tags from the comma list.
      const tagNames = tagsText
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => normalizeTagName(entry).length > 0);
      for (const tagName of tagNames) {
        await service.addTagToAsset({ libraryAssetId: asset.id, name: tagName }, SEED_LIBRARY_WORKSPACE_ID);
      }

      // First draft version: rights status + structured details.
      const versions = await service.getVersions(asset.id, SEED_LIBRARY_WORKSPACE_ID);
      const structuredDetails: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(details)) {
        if (value.trim() !== '') structuredDetails[key] = value.trim();
      }
      if (Object.keys(structuredDetails).length > 0 || rightsStatus !== 'unknown') {
        await service.updateVersionDraft(
          versions[0].id,
          {
            ...(Object.keys(structuredDetails).length > 0 ? { structuredDetails } : {}),
            ...(rightsStatus !== 'unknown' ? { rightsStatus } : {}),
          },
          SEED_LIBRARY_WORKSPACE_ID,
        );
      }

      toast({
        title: 'Asset created',
        description: `${asset.name} starts with a draft version — refine details, then lock when approved.`,
        tone: 'success',
      });
      navigate(`/library/${asset.id}/details`);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Could not create the asset.']);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Library"
        title="Add asset"
        description={ASSET_ADD_COPY}
        actions={
          <Link className="lf-btn lf-btn--secondary" to="/library">
            Back to Library
          </Link>
        }
      />

      <p className="lf-library__note" role="note">{LIBRARY_HELPER_COPY}</p>

      <div className="lf-library__choices">
        {FUTURE_CHOICES.map((choice) => (
          <Card key={choice.label}>
            <CardBody>
              <div className="lf-library__choice" aria-disabled="true">
                <span className="lf-library__choiceicon" aria-hidden="true">{choice.icon}</span>
                <strong>{choice.label}</strong>
                <span className="lf-tile__description">{choice.description}</span>
                <span className="lf-library__comingnext">Coming next</span>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <form
        className="lf-section"
        style={{ gap: 'var(--lf-space-4)' }}
        onSubmit={(event) => {
          event.preventDefault();
          void handleSaveDraft();
        }}
      >
        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Describe the asset manually</h3>
            <Input
              label="Asset name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              hint="A reusable, specific name — e.g. Luma Dew Serum Bottle"
            />
            <label className="lf-field">
              <span className="lf-field__label">Asset type</span>
              <select
                className="lf-input"
                required
                value={assetType}
                onChange={(event) => setAssetType(event.target.value as LibraryAssetType)}
              >
                <option value="" disabled>Choose a type…</option>
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <span className="lf-field__hint">Saved Looks are created from the Looks area instead.</span>
            </label>
            <label className="lf-field">
              <span className="lf-field__label">Description</span>
              <textarea
                className="lf-input lf-envform__textarea"
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <Input
              label="Tags"
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              hint="Comma-separated, workspace-scoped — e.g. skincare, countertop"
            />
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Structured details</h3>
            <div className="lf-formstack">
              {STRUCTURED_FIELDS.map((field) => (
                <Input
                  key={field.key}
                  label={field.label}
                  value={details[field.key] ?? ''}
                  hint={field.hint}
                  onChange={(event) => setDetails({ ...details, [field.key]: event.target.value })}
                />
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Rights</h3>
            <label className="lf-field">
              <span className="lf-field__label">Rights status</span>
              <select
                className="lf-input"
                value={rightsStatus}
                onChange={(event) => setRightsStatus(event.target.value as 'unknown' | 'confirmed' | 'restricted')}
              >
                <option value="unknown">Unknown</option>
                <option value="confirmed">Confirmed</option>
                <option value="restricted">Restricted</option>
              </select>
              <span className="lf-field__hint">
                Versions with unknown rights cannot be locked. The confirmation checkbox below is
                required before any version lock.
              </span>
            </label>
            <label className="lf-envlock__rights">
              <input
                type="checkbox"
                checked={rightsAcknowledged}
                onChange={(event) => setRightsAcknowledged(event.target.checked)}
              />
              <span>I have the rights to use any uploaded or imported material for this asset.</span>
            </label>
            <p className="lf-tile__description">
              Local placeholder cover selection only — real uploads arrive with secure storage.
              The cover is assigned from the asset profile later.
            </p>
          </CardBody>
        </Card>

        {errors.length > 0 ? (
          <div className="lf-alertbox" role="alert">
            <ul>
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="lf-dialogactions">
          <Link className="lf-btn lf-btn--secondary" to="/library">Cancel</Link>
          <Button type="submit" variant="primary" disabled={saving || name.trim() === '' || assetType === ''}>
            {saving ? 'Creating…' : 'Save draft'}
          </Button>
        </div>
      </form>
    </div>
  );
}


