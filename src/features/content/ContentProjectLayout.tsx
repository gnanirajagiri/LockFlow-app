/**
 * Content Studio project layout — header with plan status, tab strip
 * (Brief / Inputs / Storyboard / Review / Job) and the shared outlet context.
 */
import { useMemo } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { LibraryIcon, SparkIcon, StudioIcon } from '../../components/icons';
import { ContentStudioService } from '../../services/contentService';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { getContentRepository } from '../../data/contentFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import { useContentProjectData, type ContentProjectState } from './useContentProjectData';

type TabKey = 'brief' | 'inputs' | 'storyboard' | 'review' | 'job';

const TABS: Array<{ key: TabKey; label: string; to: string }> = [
  { key: 'brief', label: 'Brief', to: 'brief' },
  { key: 'inputs', label: 'Inputs', to: 'inputs' },
  { key: 'storyboard', label: 'Storyboard', to: 'storyboard' },
  { key: 'review', label: 'Review', to: 'review' },
  { key: 'job', label: 'Job', to: 'job' },
];

export interface ContentProjectOutletContext {
  service: ContentStudioService;
  data: ContentProjectState;
  basePath: string;
}

export function ContentProjectLayout() {
  const { projectId } = useParams();
  const location = useLocation();
  const service = useMemo(
    () =>
      new ContentStudioService(getContentRepository(), {
        library: new LibraryService(getLibraryRepository()),
        models: new ModelsService(getModelsRepository()),
        environments: new EnvironmentsService(getEnvironmentsRepository()),
      }),
    [],
  );
  const data = useContentProjectData(service, projectId, SEED_CONTENT_WORKSPACE_ID);
  const basePath = `/content-studio/${projectId ?? ''}`;

  const activeTab: TabKey = (() => {
    const segment = location.pathname.replace(basePath, '').replace(/^\//, '');
    const match = TABS.find((tab) => tab.to !== '' && segment.startsWith(tab.to));
    return match?.key ?? 'brief';
  })();

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

  if (data.state === 'error' || !data.project) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<StudioIcon size={22} />}
          title={data.error?.includes('not found') ? 'Content plan not found' : "Couldn't load this content plan"}
          description={data.error ?? undefined}
          actions={
            <Link className="lf-btn lf-btn--primary" to="/content-studio">
              Back to Content Studio
            </Link>
          }
        />
      </div>
    );
  }

  const { project } = data;

  return (
    <div className="lf-page">
      <header className="lf-envprofile__hero">
        <div className="lf-envprofile__portrait" aria-hidden="true">
          <StudioIcon size={36} />
        </div>
        <div className="lf-envprofile__id">
          <div className="lf-envprofile__title">
            <h1>{project.name}</h1>
            <span className="lf-envprofile__slug">/{project.slug}</span>
          </div>
          <div className="lf-envprofile__badges">
            <Badge tone={project.status === 'ready' ? 'success' : project.status === 'archived' ? 'warning' : 'neutral'} dot>
              {project.status}
            </Badge>
            <Badge tone="neutral">Content plan</Badge>
            {project.plannedOutputType ? (
              <Badge tone="info">{project.plannedOutputType.replace('_', ' ')}</Badge>
            ) : (
              <Badge tone="neutral">no output type yet</Badge>
            )}
          </div>
        </div>
        <div className="lf-envprofile__actions">
          <div className="lf-envprofile__actions-row">
            <Link className="lf-btn lf-btn--ghost lf-btn--sm" to="/content-studio">
              <span className="lf-btn__icon" aria-hidden="true">
                <LibraryIcon size={14} />
              </span>
              Back to Content Studio
            </Link>
          </div>
        </div>
      </header>

      <nav aria-label="Content plan sections">
        <div className="lf-tabs__list" style={{ borderBottom: '1px solid var(--lf-color-border)' }}>
          {TABS.map((tab) => {
            const to = `${basePath}/${tab.to}`;
            const selected = activeTab === tab.key;
            return (
              <NavLink
                key={tab.key}
                to={to}
                role="tab"
                aria-selected={selected}
                className="lf-tabs__tab"
                style={{ display: 'inline-flex' }}
              >
                {tab.label}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <Outlet context={{ service, data, basePath } satisfies ContentProjectOutletContext} />

      <p className="lf-library__note" role="note" style={{ marginTop: 'var(--lf-space-4)' }}>
        <SparkIcon size={14} /> Content Studio pins approved versions before generation. Generated
        work appears in Gallery.
      </p>
    </div>
  );
}
