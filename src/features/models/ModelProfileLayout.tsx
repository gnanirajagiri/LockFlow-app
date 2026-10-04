/**
 * Model profile layout — header, badges, primary action, secondary action
 * menu, and the tab strip (real routes, so tabs are links).
 *
 * Primary action follows the lock rules: a draft active version offers
 * "Continue editing"; a locked one offers "Create new draft version" (never a
 * direct Edit for locked versions).
 */
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { LockIcon, ModelIcon, PlusIcon } from '../../components/icons';
import { ModelsService } from '../../services/modelsService';
import { getModelsRepository } from '../../data';
import { SEED_WORKSPACE_ID } from '../../mock/modelsSeed';
import { useModelData } from './useModelData';
import type { ModelWithVersion } from '../../domain/models';

type TabKey = 'overview' | 'builder' | 'character-sheet' | 'looks' | 'closet-props' | 'versions' | 'usage-history';

const TABS: Array<{ key: TabKey; label: string; to: string }> = [
  { key: 'overview', label: 'Overview', to: '' },
  { key: 'builder', label: 'Builder', to: 'builder' },
  { key: 'character-sheet', label: 'Character Sheet', to: 'character-sheet' },
  { key: 'looks', label: 'Looks', to: 'looks' },
  { key: 'closet-props', label: 'Closet & Props', to: 'closet-props' },
  { key: 'versions', label: 'Versions', to: 'versions' },
  { key: 'usage-history', label: 'Usage history', to: 'usage-history' },
];

export function ModelProfileLayout() {
  const { modelId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const service = useRef(new ModelsService(getModelsRepository())).current;
  const { toast } = useToast();
  const data = useModelData(service, modelId, SEED_WORKSPACE_ID);

  const [menuOpen, setMenuOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the action menu on any navigation or outside click.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  // The base path of this profile, e.g. /models/<id> — used for tab links.
  const basePath = `/models/${modelId ?? ''}`;
  const activeTab: TabKey = (() => {
    const segment = location.pathname.replace(basePath, '').replace(/^\//, '');
    const match = TABS.find((tab) => tab.to !== '' && segment.startsWith(tab.to));
    return match?.key ?? 'overview';
  })();

  /**
   * "Create new draft version" routes into the Versions tab's create-draft
   * dialog so the required change summary is always collected first — the
   * single path for starting a draft from a locked version.
   */
  function handleCreateDraft() {
    if (!data.activeVersion) return;
    navigate(`${basePath}/versions?create-draft=${data.activeVersion.id}`);
  }

  async function handleArchive() {
    if (!data.model) return;
    try {
      await service.archiveModel(data.model.id, SEED_WORKSPACE_ID);
      toast({ title: 'Model archived', description: `${data.model.name} was archived.`, tone: 'success' });
      setArchiveOpen(false);
      data.reload();
    } catch (err) {
      toast({
        title: 'Archive failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    }
  }

  if (data.state === 'loading') {
    return (
      <div className="lf-page" aria-busy="true">
        <div className="lf-modelprofile__hero">
          <Skeleton variant="rect" width={96} height={96} />
          <div style={{ flex: 1, display: 'grid', gap: 'var(--lf-space-2)' }}>
            <Skeleton variant="title" />
            <Skeleton lines={1} />
          </div>
        </div>
        <Skeleton variant="rect" height={44} />
        <Skeleton lines={4} />
      </div>
    );
  }

  if (data.state === 'error' || !data.model) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<ModelIcon size={22} />}
          title={data.error?.includes('not found') ? 'Model not found' : "Couldn't load this model"}
          description={data.error ?? undefined}
          actions={
            <Link className="lf-btn lf-btn--primary" to="/models">
              Back to Models
            </Link>
          }
        />
      </div>
    );
  }

  const { model, activeVersion } = data;
  const modelWithVersion: ModelWithVersion = { ...model, activeVersion };

  return (
    <div className="lf-page">
      <header className="lf-modelprofile__hero">
        <div className="lf-modelprofile__portrait" aria-hidden="true">
          <ModelIcon size={36} />
        </div>
        <div className="lf-modelprofile__id">
          <div className="lf-modelprofile__title">
            <h1>{model.name}</h1>
            <span className="lf-modelprofile__slug">/{model.slug}</span>
          </div>
          <div className="lf-modelprofile__badges">
            <ActiveVersionBadge model={modelWithVersion} />
            <Badge tone={model.status === 'ready' ? 'success' : model.status === 'archived' ? 'warning' : 'neutral'} dot>
              {model.status}
            </Badge>
          </div>
        </div>
        <div className="lf-modelprofile__actions">
          <div className="lf-modelprofile__actions-row">
            {activeVersion?.status === 'draft' ? (
              <Button variant="primary" onClick={() => navigate(`${basePath}/character-sheet?version=${activeVersion.id}`)}>
                Continue editing
              </Button>
            ) : activeVersion ? (
              <Button variant="primary" leftIcon={<PlusIcon size={14} />} onClick={handleCreateDraft}>
                Create new draft version
              </Button>
            ) : null}
            <div className="lf-actionmenu" ref={menuRef}>
              <button
                type="button"
                className="lf-btn lf-btn--secondary"
                aria-haspopup="true"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                Actions
              </button>
              {menuOpen ? (
                <div className="lf-actionmenu__list" role="menu" aria-label={`${model.name} actions`}>
                  <button
                    type="button"
                    role="menuitem"
                    className="lf-actionmenu__item"
                    onClick={() => {
                      setMenuOpen(false);
                      toast({
                        title: 'Duplicate arrives with the Model Builder',
                        description: 'Duplicating a model (with its version history) is planned next.',
                        tone: 'info',
                      });
                    }}
                  >
                    Duplicate model
                    <span className="lf-actionmenu__hint">Placeholder — coming with the Model Builder</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="lf-actionmenu__item lf-actionmenu__item--danger"
                    onClick={() => {
                      setMenuOpen(false);
                      setArchiveOpen(true);
                    }}
                  >
                    Archive model
                    <span className="lf-actionmenu__hint">Soft archive — nothing is deleted</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <span className="lf-modelprofile__profilelink">
            {activeVersion
              ? `Active: v${activeVersion.versionNumber} (${activeVersion.status})`
              : 'No active version yet'}
          </span>
        </div>
      </header>

      <nav aria-label="Model sections">
        <div className="lf-tabs__list" style={{ borderBottom: '1px solid var(--lf-color-border)' }}>
          {TABS.map((tab) => {
            const to = tab.to === '' ? basePath : `${basePath}/${tab.to}`;
            const selected = activeTab === tab.key;
            return (
              <NavLink
                key={tab.key}
                to={to}
                role="tab"
                aria-selected={selected}
                className="lf-tabs__tab"
                style={{ display: 'inline-flex' }}
                end={tab.to === ''}
              >
                {tab.label}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <Outlet context={{ service, data, basePath }} />

      <Modal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title={model ? `Archive ${model.name}?` : 'Archive model'}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setArchiveOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void handleArchive()}>
              Archive model
            </Button>
          </div>
        }
      >
        <p>
          <strong>{model.name}</strong> will be marked archived and hidden from the default
          list. This is a soft archive — the model, its versions and its Character Sheets are
          preserved, and nothing is deleted.
        </p>
      </Modal>
    </div>
  );
}

export function ActiveVersionBadge({ model }: { model: ModelWithVersion }) {
  if (!model.activeVersion) return <Badge tone="neutral">no active version</Badge>;
  const { versionNumber, status } = model.activeVersion;
  const label = status === 'locked' ? `v${versionNumber} Locked` : `v${versionNumber} ${status}`;
  return (
    <Badge tone={status === 'locked' ? 'locked' : 'primary'}>
      {status === 'locked' ? <LockIcon size={12} /> : null}
      {label}
    </Badge>
  );
}

