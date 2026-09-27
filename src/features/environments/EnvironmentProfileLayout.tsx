/**
 * Environment profile layout — header, badges, primary action, secondary
 * action menu, and the tab strip (real routes, so tabs are links).
 *
 * Primary action follows the lock rules: a draft active version offers
 * "Continue editing"; a locked one offers "Create new draft version" (never
 * direct editing for locked versions).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { EnvironmentIcon, LockIcon, PlusIcon } from '../../components/icons';
import { EnvironmentsService } from '../../services/environmentsService';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { SEED_ENVIRONMENT_WORKSPACE_ID } from '../../mock/environmentsSeed';
import { useEnvironmentData } from './useEnvironmentData';
import type { EnvironmentRecord, EnvironmentVersionRecord } from '../../domain/environments';

type TabKey = 'overview' | 'edit' | 'references' | 'versions';

const TABS: Array<{ key: TabKey; label: string; to: string }> = [
  { key: 'overview', label: 'Overview', to: '' },
  { key: 'edit', label: 'Environment Specs', to: 'edit' },
  { key: 'references', label: 'References', to: 'references' },
  { key: 'versions', label: 'Versions', to: 'versions' },
];

export interface EnvironmentOutletContext {
  service: EnvironmentsService;
  data: ReturnType<typeof useEnvironmentData>;
  basePath: string;
  /** Navigates to the Versions tab's create-draft dialog (required summary). */
  startCreateDraft: (sourceVersionId: string) => void;
}

export function EnvironmentProfileLayout() {
  const { environmentId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const service = useMemo(
    () => new EnvironmentsService(getEnvironmentsRepository()),
    [],
  );
  const { toast } = useToast();
  const data = useEnvironmentData(service, environmentId, SEED_ENVIRONMENT_WORKSPACE_ID);

  const [menuOpen, setMenuOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  const basePath = `/environments/${environmentId ?? ''}`;
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
  function startCreateDraft(sourceVersionId: string) {
    navigate(`${basePath}/versions?create-draft=${sourceVersionId}`);
  }

  async function handleArchive() {
    if (!data.environment) return;
    try {
      await service.archiveEnvironment(data.environment.id, SEED_ENVIRONMENT_WORKSPACE_ID);
      toast({ title: 'Environment archived', description: `${data.environment.name} was archived.`, tone: 'success' });
      setArchiveOpen(false);
      await data.reload();
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
        <div className="lf-envprofile__hero">
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

  if (data.state === 'error' || !data.environment) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<EnvironmentIcon size={22} />}
          title={data.error?.includes('not found') ? 'Environment not found' : "Couldn't load this environment"}
          description={data.error ?? undefined}
          actions={
            <Link className="lf-btn lf-btn--primary" to="/environments">
              Back to Environments
            </Link>
          }
        />
      </div>
    );
  }

  const { environment, activeVersion } = data;

  return (
    <div className="lf-page">
      <header className="lf-envprofile__hero">
        <div className="lf-envprofile__portrait" aria-hidden="true">
          <EnvironmentIcon size={36} />
        </div>
        <div className="lf-envprofile__id">
          <div className="lf-envprofile__title">
            <h1>{environment.name}</h1>
            <span className="lf-envprofile__slug">/{environment.slug}</span>
          </div>
          <div className="lf-envprofile__badges">
            <ActiveEnvironmentVersionBadge environment={environment} activeVersion={activeVersion} />
            <Badge tone={environment.status === 'ready' ? 'success' : environment.status === 'archived' ? 'warning' : 'neutral'} dot>
              {environment.status}
            </Badge>
            {activeVersion ? <Badge tone="info">{activeVersion.lockLevel} lock</Badge> : null}
          </div>
        </div>
        <div className="lf-envprofile__actions">
          <div className="lf-envprofile__actions-row">
            {activeVersion?.status === 'draft' ? (
              <Button
                variant="primary"
                onClick={() => navigate(`${basePath}/edit?version=${activeVersion.id}`)}
              >
                Continue editing
              </Button>
            ) : activeVersion ? (
              <Button variant="primary" leftIcon={<PlusIcon size={14} />} onClick={() => startCreateDraft(activeVersion.id)}>
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
                <div className="lf-actionmenu__list" role="menu" aria-label={`${environment.name} actions`}>
                  <button
                    type="button"
                    role="menuitem"
                    className="lf-actionmenu__item"
                    onClick={() => {
                      setMenuOpen(false);
                      toast({
                        title: 'Duplicate arrives with the Environment Builder',
                        description: 'Duplicating an environment (with its version history) is planned next.',
                        tone: 'info',
                      });
                    }}
                  >
                    Duplicate environment
                    <span className="lf-actionmenu__hint">Placeholder — coming with the Builder</span>
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
                    Archive environment
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

      <nav aria-label="Environment sections">
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

      <Outlet context={{ service, data, basePath, startCreateDraft } satisfies EnvironmentOutletContext} />

      <Modal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title={environment ? `Archive ${environment.name}?` : 'Archive environment'}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setArchiveOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void handleArchive()}>
              Archive environment
            </Button>
          </div>
        }
      >
        <p>
          <strong>{environment.name}</strong> will be marked archived and hidden from the default
          list. This is a soft archive — the environment, its versions and its specs are
          preserved, and nothing is deleted.
        </p>
      </Modal>
    </div>
  );
}

export function ActiveEnvironmentVersionBadge({
  environment,
  activeVersion,
}: {
  environment: EnvironmentRecord;
  activeVersion: EnvironmentVersionRecord | null;
}) {
  void environment;
  if (!activeVersion) return <Badge tone="neutral">no active version</Badge>;
  const { versionNumber, status } = activeVersion;
  const label = status === 'locked' ? `v${versionNumber} Locked` : `v${versionNumber} ${status}`;
  return (
    <Badge tone={status === 'locked' ? 'locked' : 'primary'}>
      {status === 'locked' ? <LockIcon size={12} /> : null}
      {label}
    </Badge>
  );
}
