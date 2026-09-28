/**
 * Library asset profile layout — header, badges, primary action, archive
 * menu and the tab strip (Overview / Details / References / Versions).
 *
 * Primary action follows the lock rules: draft → "Continue editing";
 * locked → "Create new draft version" (never direct edits).
 */
import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { LibraryIcon, LockIcon, PlusIcon } from '../../components/icons';
import { LibraryService } from '../../services/libraryService';
import { getLibraryRepository } from '../../data/libraryFactory';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import { RIGHTS_LABELS } from './libraryUi';
import { useLibraryAssetData, type LibraryAssetState } from './useLibraryData';
import type { LibraryAssetRecord, LibraryAssetVersionRecord } from '../../domain/library';

type TabKey = 'overview' | 'details' | 'references' | 'versions';

const TABS: Array<{ key: TabKey; label: string; to: string }> = [
  { key: 'overview', label: 'Overview', to: '' },
  { key: 'details', label: 'Details', to: 'details' },
  { key: 'references', label: 'References', to: 'references' },
  { key: 'versions', label: 'Versions', to: 'versions' },
];

export interface LibraryOutletContext {
  service: LibraryService;
  data: LibraryAssetState;
  basePath: string;
}

export function LibraryAssetProfileLayout() {
  const { assetId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const service = useMemo(() => new LibraryService(getLibraryRepository()), []);
  const { toast } = useToast();
  const data = useLibraryAssetData(service, assetId, SEED_LIBRARY_WORKSPACE_ID);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const basePath = `/library/${assetId ?? ''}`;

  const activeTab: TabKey = (() => {
    const segment = location.pathname.replace(basePath, '').replace(/^\//, '');
    const match = TABS.find((tab) => tab.to !== '' && segment.startsWith(tab.to));
    return match?.key ?? 'overview';
  })();

  function startCreateDraft(sourceVersionId: string) {
    navigate(`${basePath}/versions?create-draft=${sourceVersionId}`);
  }

  async function handleArchive() {
    if (!data.asset) return;
    try {
      await service.archiveAsset(data.asset.id, SEED_LIBRARY_WORKSPACE_ID);
      toast({ title: 'Asset archived', description: `${data.asset.name} was archived.`, tone: 'success' });
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

  if (data.state === 'error' || !data.asset) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<LibraryIcon size={22} />}
          title={data.error?.includes('not found') ? 'Asset not found' : "Couldn't load this asset"}
          description={data.error ?? undefined}
          actions={
            <Link className="lf-btn lf-btn--primary" to="/library">
              Back to Library
            </Link>
          }
        />
      </div>
    );
  }

  const { asset, activeVersion } = data;
  const isLook = asset.assetType === 'look';

  return (
    <div className="lf-page">
      <header className="lf-envprofile__hero">
        <div className="lf-envprofile__portrait" aria-hidden="true">
          <LibraryIcon size={36} />
        </div>
        <div className="lf-envprofile__id">
          <div className="lf-envprofile__title">
            <h1>{asset.name}</h1>
            <span className="lf-envprofile__slug">/{asset.slug}</span>
          </div>
          <div className="lf-envprofile__badges">
            <ActiveAssetVersionBadge asset={asset} activeVersion={activeVersion} />
            <Badge tone={asset.status === 'ready' ? 'success' : asset.status === 'archived' ? 'warning' : 'neutral'} dot>
              {asset.status}
            </Badge>
            <Badge tone="neutral">{asset.assetType === 'look' ? 'Saved Look' : asset.assetType.replace('_', ' ')}</Badge>
            {activeVersion ? <Badge tone={activeVersion.rightsStatus === 'confirmed' ? 'success' : activeVersion.rightsStatus === 'restricted' ? 'danger' : 'neutral'}>{RIGHTS_LABELS[activeVersion.rightsStatus]}</Badge> : null}
          </div>
        </div>
        <div className="lf-envprofile__actions">
          <div className="lf-envprofile__actions-row">
            {activeVersion?.status === 'draft' ? (
              <Button variant="primary" onClick={() => navigate(`${basePath}/details?version=${activeVersion.id}`)}>
                Continue editing
              </Button>
            ) : activeVersion ? (
              <Button variant="primary" leftIcon={<PlusIcon size={14} />} onClick={() => startCreateDraft(activeVersion.id)}>
                Create new draft version
              </Button>
            ) : null}
          </div>
          <div className="lf-envprofile__actions-row">
            <Link className="lf-btn lf-btn--ghost lf-btn--sm" to="/library">
              Back to Library
            </Link>
            <button
              type="button"
              className="lf-btn lf-btn--secondary lf-btn--sm"
              onClick={() => setArchiveOpen(true)}
            >
              Archive
            </button>
          </div>
          <span className="lf-modelprofile__profilelink">
            {activeVersion
              ? `Active: v${activeVersion.versionNumber} (${activeVersion.status})`
              : 'No active version yet'}
          </span>
        </div>
      </header>

      <nav aria-label="Asset sections">
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

      <Outlet context={{ service, data, basePath } satisfies LibraryOutletContext} />

      <Modal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title={`Archive ${asset.name}?`}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setArchiveOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void handleArchive()}>
              Archive asset
            </Button>
          </div>
        }
      >
        <p>
          <strong>{asset.name}</strong> will be marked archived and hidden from the default list.
          This is a soft archive — the asset, its versions and references are preserved, and
          nothing is deleted.
        </p>
      </Modal>

      {isLook ? (
        <p className="lf-library__note" role="note" style={{ marginTop: 'var(--lf-space-4)' }}>
          Looks change presentation, not protected identity.
        </p>
      ) : null}
    </div>
  );
}

export function ActiveAssetVersionBadge({
  asset,
  activeVersion,
}: {
  asset: LibraryAssetRecord;
  activeVersion: LibraryAssetVersionRecord | null;
}) {
  void asset;
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
