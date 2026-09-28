/**
 * New Look — creates a complete Look in one flow: a look-type Library asset,
 * its first draft version, look details linked to a model, and canonical
 * item references into the one shared Library. The model's Character Sheet
 * is never written — the association is presentation only.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/Toast';
import { CloseIcon, SearchIcon, SparkIcon } from '../components/icons';
import { LibraryService } from '../services/libraryService';
import { ModelsService } from '../services/modelsService';
import { getLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository } from '../data';
import { SEED_LIBRARY_WORKSPACE_ID } from '../mock/librarySeed';
import { LOOK_IDENTITY_NOTE, LOOKS_HEADER_COPY } from '../features/library/libraryUi';
import type { LookItemRole } from '../domain/library';
import type { LibraryAssetRecord } from '../domain/library';
import type { ModelRecord } from '../domain/models';

/** Look items may only link these canonical asset types. */
const ITEM_ELIGIBLE_TYPES: ReadonlySet<string> = new Set([
  'wardrobe',
  'accessory',
  'personal_item',
  'product',
  'creator_tool',
]);

interface PickedItem {
  key: string;
  asset: LibraryAssetRecord;
  role: LookItemRole;
  /** Warns when the asset's type doesn't map cleanly onto a look role. */
  typeWarning: string | null;
}

const ROLE_FOR_TYPE: Record<string, LookItemRole> = {
  wardrobe: 'wardrobe',
  accessory: 'accessory',
  personal_item: 'personal_item',
  product: 'product',
  creator_tool: 'creator_tool',
};

function suggestedRole(assetType: string): LookItemRole {
  return ROLE_FOR_TYPE[assetType] ?? 'other';
}

export function LibraryNewLookPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const service = useMemo(
    () => new LibraryService(getLibraryRepository(), { getModel: (modelId, workspaceId) => modelsService.getModel(modelId, workspaceId) }),
    // modelsService is stable below; the bridge only forwards the call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const modelsService = useMemo(() => new ModelsService(getModelsRepository()), []);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [presentationNotes, setPresentationNotes] = useState('');
  const [models, setModels] = useState<ModelRecord[] | null>(null);
  const [modelId, setModelId] = useState('');
  const [catalog, setCatalog] = useState<LibraryAssetRecord[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [items, setItems] = useState<PickedItem[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Eligible canonical assets (never look/scene/brand/reference types).
  const eligible = useMemo(
    () => (catalog ?? []).filter((asset) => ITEM_ELIGIBLE_TYPES.has(asset.assetType) && asset.status !== 'archived'),
    [catalog],
  );

  const alreadyLinked = useMemo(() => new Set(items.map((item) => item.asset.id)), [items]);

  const filteredCatalog = useMemo(() => {
    const needle = itemSearch.trim().toLowerCase();
    if (!needle) return eligible;
    return eligible.filter((asset) => asset.name.toLowerCase().includes(needle));
  }, [eligible, itemSearch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const workspaceId = SEED_LIBRARY_WORKSPACE_ID;
        const [modelList, assetList] = await Promise.all([
          modelsService.listModels(workspaceId),
          service.listAssets(workspaceId),
        ]);
        if (cancelled) return;
        setModels(modelList);
        setCatalog(assetList);
        if (modelList.length > 0) setModelId((current) => current || modelList[0].id);
      } catch (err) {
        if (!cancelled) setCatalogError(err instanceof Error ? err.message : 'Could not load models and assets.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelsService, service]);

  function addAsset(asset: LibraryAssetRecord) {
    if (alreadyLinked.has(asset.id)) return;
    const role = suggestedRole(asset.assetType);
    setItems((current) => [
      ...current,
      {
        key: `${asset.id}-${crypto.randomUUID()}`,
        asset,
        role,
        typeWarning:
          asset.assetType === 'prop' || asset.assetType === 'other'
            ? `"${asset.assetType}" is not a typical Look item — it will be linked with role "${role}".`
            : null,
      },
    ]);
  }

  function move(index: number, delta: number) {
    setItems((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleCreate() {
    setErrors([]);
    const problems: string[] = [];
    if (name.trim() === '') problems.push('Look name is required.');
    if (modelId === '') problems.push('Choose the model this Look is for.');
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }

    setSaving(true);
    try {
      const asset = await service.createLook(
        {
          name: name.trim(),
          modelId,
          ...(presentationNotes.trim() ? { presentationNotes: presentationNotes.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          items: items.map((item, index) => ({
            libraryAssetId: item.asset.id,
            role: item.role,
            sortOrder: index,
          })),
        },
        'demo-user',
        SEED_LIBRARY_WORKSPACE_ID,
      );
      toast({
        title: 'Look created',
        description: `${asset.name} starts as a draft version linked to canonical Library items.`,
        tone: 'success',
      });
      navigate(`/library/looks/${asset.id}`);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Could not create the Look.']);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Library"
        title="New Look"
        description={LOOKS_HEADER_COPY}
        actions={
          <Link className="lf-btn lf-btn--secondary" to="/library/looks">
            Back to Looks
          </Link>
        }
      />

      <p className="lf-library__note" role="note">{LOOK_IDENTITY_NOTE}</p>

      <form
        className="lf-section"
        style={{ gap: 'var(--lf-space-4)' }}
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreate();
        }}
      >
        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Look identity</h3>
            <Input
              label="Look name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              hint="A reusable styling setup — e.g. Neutral creator outfit"
            />
            <label className="lf-field">
              <span className="lf-field__label">Model</span>
              <select
                className="lf-input"
                required
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
              >
                <option value="" disabled>
                  {models === null ? 'Loading models…' : 'Choose a model…'}
                </option>
                {(models ?? []).map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
              <span className="lf-field__hint">
                The Look is associated with this model for presentation only — the model's
                protected Character Sheet is never changed.
              </span>
            </label>
            <label className="lf-field">
              <span className="lf-field__label">Presentation notes</span>
              <textarea
                className="lf-input lf-envform__textarea"
                rows={2}
                value={presentationNotes}
                onChange={(event) => setPresentationNotes(event.target.value)}
                placeholder="How the items come together — fit, styling, mood."
              />
            </label>
            <label className="lf-field">
              <span className="lf-field__label">Description (optional)</span>
              <textarea
                className="lf-input lf-envform__textarea"
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Items from your Library</h3>
            <p className="lf-tile__description">
              Link wardrobe, accessories, personal items, products and creator tools from the one
              shared Library. Items reference the canonical records — nothing is copied into the
              Look.
            </p>

            {items.length > 0 ? (
              <ul className="lf-library__lookitems">
                {items.map((item, index) => (
                  <li key={item.key} className="lf-library__lookitem">
                    <span className="lf-library__lookitemnum" aria-hidden="true">{index + 1}</span>
                    <span className="lf-library__lookitembody">
                      <strong>{item.asset.name}</strong>
                      <span className="lf-library__lookitemmeta">
                        {item.asset.assetType.replace('_', ' ')} · role: {item.role}
                      </span>
                      {item.typeWarning ? (
                        <span className="lf-library__lookitemmeta">{item.typeWarning}</span>
                      ) : null}
                    </span>
                    <span className="lf-library__lookitemactions">
                      <button
                        type="button"
                        className="lf-iconbtn"
                        aria-label={`Move ${item.asset.name} up`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <span aria-hidden="true">↑</span>
                      </button>
                      <button
                        type="button"
                        className="lf-iconbtn"
                        aria-label={`Move ${item.asset.name} down`}
                        disabled={index === items.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <span aria-hidden="true">↓</span>
                      </button>
                      <button
                        type="button"
                        className="lf-iconbtn"
                        aria-label={`Remove ${item.asset.name}`}
                        onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}
                      >
                        <CloseIcon size={14} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lf-tile__description">No items linked yet — pick from the list below.</p>
            )}

            <label className="lf-field" style={{ marginTop: 'var(--lf-space-3)' }}>
              <span className="lf-field__label">Search Library assets</span>
              <div className="lf-models-toolbar__search">
                <span className="lf-models-toolbar__search-icon" aria-hidden="true">
                  <SearchIcon size={16} />
                </span>
                <Input
                  label="Search Library assets"
                  hideLabel
                  placeholder="Search by name"
                  value={itemSearch}
                  onChange={(event) => setItemSearch(event.target.value)}
                  type="search"
                />
              </div>
            </label>

            {catalogError ? (
              <div className="lf-alertbox" role="alert">{catalogError}</div>
            ) : catalog === null ? (
              <p className="lf-tile__description">Loading Library assets…</p>
            ) : filteredCatalog.length === 0 ? (
              <p className="lf-tile__description">
                No eligible assets match. Look items can link wardrobe, accessory, personal item,
                product and creator tool assets.
              </p>
            ) : (
              <div className="lf-library__assetpick" role="listbox" aria-label="Library assets">
                {filteredCatalog.map((asset) => {
                  const linked = alreadyLinked.has(asset.id);
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      role="option"
                      aria-selected={linked}
                      className="lf-library__assetoption"
                      disabled={linked}
                      onClick={() => addAsset(asset)}
                    >
                      <SparkIcon size={14} />
                      <span>{asset.name}</span>
                      <span className="lf-library__assetoptionmeta">
                        {linked ? 'already linked' : asset.assetType.replace('_', ' ')}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
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
          <Link className="lf-btn lf-btn--secondary" to="/library/looks">Cancel</Link>
          <Button type="submit" variant="primary" disabled={saving || name.trim() === '' || modelId === ''}>
            {saving ? 'Creating…' : 'Create Look'}
          </Button>
        </div>
      </form>
    </div>
  );
}
