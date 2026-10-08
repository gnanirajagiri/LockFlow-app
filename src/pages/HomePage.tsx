import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Card, CardBody } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { useAuth } from '../auth/AuthProvider';
import { ModelIcon, LockIcon, AlertIcon, CopyIcon, InfoIcon, ChevronRightIcon } from '../components/icons';
import { ModelsService } from '../services/modelsService';
import { EnvironmentsService } from '../services/environmentsService';
import { ContentStudioService } from '../services/contentService';
import { LibraryService } from '../services/libraryService';
import { GalleryService } from '../services/galleryService';
import { CampaignsService } from '../services/campaignsService';
import { getModelsRepository } from '../data';
import { getEnvironmentsRepository } from '../data/environmentsFactory';
import { getLibraryRepository } from '../data/libraryFactory';
import { getContentRepository } from '../data/contentFactory';
import { getGalleryRepository } from '../data/galleryFactory';
import { getCampaignsRepository } from '../data/campaignsFactory';
import { SEED_CONTENT_WORKSPACE_ID } from '../mock/contentSeed';
import { SEED_GALLERY_WORKSPACE_ID } from '../mock/gallerySeed';
import type { ModelRecord } from '../domain/models';
import type { EnvironmentRecord } from '../domain/environments';
import type { LibraryAssetRecord } from '../domain/library';
import type { GalleryOutputRecord } from '../domain/gallery/types';
import type { CampaignSummary } from '../data/campaignsRepository';
import type { ContentProjectSummary } from '../data/contentRepository';

/**
 * Stage-5 S06 home: greeting hero with live workspace stats, "Continue where
 * you left off" resume cards (draft models, environments and content plans),
 * the "Needs your attention" action list, active campaigns with approval
 * rings, and the recent-assets strip. Data comes from the same mock-backed
 * services the feature pages use.
 */

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

type LoadState = 'loading' | 'error' | 'ready';

interface ResumeCard {
  id: string;
  to: string;
  title: string;
  subtitle: string;
  progress: number;
  progressLabel: string;
}

interface AttentionItem {
  id: string;
  tone: 'ok' | 'error' | 'warn' | 'info';
  icon: React.ReactNode;
  title: string;
  detail: string;
  actionLabel: string;
  to: string;
}

const ATTENTION_ICONS: Record<AttentionItem['tone'], React.ReactNode> = {
  ok: <ModelIcon size={18} />,
  error: <CopyIcon size={18} />,
  warn: <AlertIcon size={18} />,
  info: <InfoIcon size={18} />,
};

function approvalPercent(summary: CampaignSummary): number {
  if (summary.itemCount === 0) return 0;
  return Math.round((summary.approvedOutputCount / summary.itemCount) * 100);
}

function assetTypeLabel(asset: LibraryAssetRecord): string {
  return asset.assetType
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function HomePage() {
  const { user } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentRecord[]>([]);
  const [assets, setAssets] = useState<LibraryAssetRecord[]>([]);
  const [outputs, setOutputs] = useState<GalleryOutputRecord[]>([]);
  const [projects, setProjects] = useState<ContentProjectSummary[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);

  const services = useMemo(
    () => ({
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
      content: new ContentStudioService(getContentRepository(), {
        library: new LibraryService(getLibraryRepository()),
        models: new ModelsService(getModelsRepository()),
        environments: new EnvironmentsService(getEnvironmentsRepository()),
      }),
      library: new LibraryService(getLibraryRepository()),
      gallery: new GalleryService(getGalleryRepository(), new ContentStudioService(getContentRepository(), {
        library: new LibraryService(getLibraryRepository()),
        models: new ModelsService(getModelsRepository()),
        environments: new EnvironmentsService(getEnvironmentsRepository()),
      }), SEED_GALLERY_WORKSPACE_ID),
      campaigns: null as CampaignsService | null,
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const workspaceId = SEED_CONTENT_WORKSPACE_ID;
        const content = services.content;
        const campaignsService = new CampaignsService(
          getCampaignsRepository(),
          services.gallery,
        );
        services.campaigns = campaignsService;
        const [modelList, environmentList, assetList, outputList, projectList, campaignList] =
          await Promise.all([
            services.models.listModels(workspaceId),
            services.environments.listEnvironments(workspaceId),
            services.library.listAssets(workspaceId),
            services.gallery.listOutputs(SEED_GALLERY_WORKSPACE_ID),
            content.listProjectSummaries(workspaceId),
            campaignsService.listCampaigns(workspaceId),
          ]);
        if (cancelled) return;
        setModels(modelList);
        setEnvironments(environmentList);
        setAssets(assetList);
        setOutputs(outputList);
        setProjects(projectList);
        setCampaigns(campaignList);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load the workspace.');
        setState('error');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [services]);

  const firstName = user?.name?.split(' ')[0] ?? 'there';

  /** Resume cards: draft items and plans in progress, most recently updated first. */
  const resumeCards: ResumeCard[] = useMemo(() => {
    const cards: ResumeCard[] = [];
    for (const project of projects) {
      const total = project.sceneCount + project.beatCount;
      cards.push({
        id: `project-${project.project.id}`,
        to: `/content-studio/${project.project.id}`,
        title: project.project.name,
        subtitle: 'Content plan · Studio',
        progress: project.project.status === 'draft' ? Math.min(60, total * 15) : 100,
        progressLabel: project.project.status === 'draft' ? `${project.sceneCount} scenes planned` : 'Ready',
      });
    }
    for (const model of models) {
      if (model.status !== 'ready') continue;
      cards.push({
        id: `model-${model.id}`,
        to: `/models/${model.id}`,
        title: model.name,
        subtitle: 'Model · Profile',
        progress: 100,
        progressLabel: 'Ready',
      });
    }
    for (const environment of environments) {
      cards.push({
        id: `env-${environment.id}`,
        to: `/environments/${environment.id}`,
        title: environment.name,
        subtitle: 'Environment · Profile',
        progress: environment.status === 'ready' ? 100 : 50,
        progressLabel: environment.status === 'ready' ? 'Ready' : 'Draft',
      });
    }
    return cards.slice(0, 4);
  }, [projects, models, environments]);

  /**
   * "Needs your attention" (S06): drafts ready for review, failed jobs,
   * environments needing review and draft expiries — max 5, urgency order.
   */
  const attention: AttentionItem[] = useMemo(() => {
    const items: AttentionItem[] = [];
    const reviewReady = outputs.filter((o) => o.status === 'ready_for_review');
    for (const output of reviewReady.slice(0, 2)) {
      items.push({
        id: `review-${output.id}`,
        tone: 'ok',
        icon: ATTENTION_ICONS.ok,
        title: 'Draft ready for review',
        detail: `${output.title} · Gallery`,
        actionLabel: 'Review',
        to: `/gallery/${output.id}/quality`,
      });
    }
    const failed = outputs.filter((o) => o.status === 'failed');
    for (const output of failed.slice(0, 1)) {
      items.push({
        id: `failed-${output.id}`,
        tone: 'error',
        icon: ATTENTION_ICONS.error,
        title: 'Render failed',
        detail: `${output.title} · no credits charged for failed scenes`,
        actionLabel: 'Retry',
        to: `/gallery/${output.id}`,
      });
    }
    const rejected = outputs.filter((o) => o.status === 'rejected');
    for (const output of rejected.slice(0, 1)) {
      items.push({
        id: `rejected-${output.id}`,
        tone: 'warn',
        icon: ATTENTION_ICONS.warn,
        title: 'Output needs a fix',
        detail: `${output.title} · rejected in review`,
        actionLabel: 'Open',
        to: `/gallery/${output.id}/corrections`,
      });
    }
    const draftOutputs = outputs.filter((o) => o.status === 'draft');
    for (const output of draftOutputs.slice(0, 1)) {
      items.push({
        id: `draft-${output.id}`,
        tone: 'info',
        icon: ATTENTION_ICONS.info,
        title: 'Draft expiring in 30 days',
        detail: `${output.title} · Gallery drafts expire after 30 days`,
        actionLabel: 'Finish',
        to: `/gallery/${output.id}`,
      });
    }
    return items.slice(0, 5);
  }, [outputs]);

  const activeCampaigns = campaigns
    .filter((summary) => summary.campaign.status === 'active')
    .slice(0, 2);

  const recentAssets = useMemo(() => {
    const byUpdated = (a: { updatedAt: string }, b: { updatedAt: string }) =>
      a.updatedAt < b.updatedAt ? 1 : -1;
    const pills: Array<{
      id: string;
      to: string;
      name: string;
      kind: string;
      pill: string;
      pillTone: 'ok' | 'lock' | 'lav';
    }> = [];
    for (const asset of [...assets].sort(byUpdated).slice(0, 4)) {
      pills.push({
        id: asset.id,
        to: `/library/${asset.id}`,
        name: asset.name,
        kind: assetTypeLabel(asset),
        pill: assetTypeLabel(asset),
        pillTone: 'lav',
      });
    }
    for (const output of [...outputs]
      .filter((o) => o.status === 'approved')
      .sort(byUpdated)
      .slice(0, 2)) {
      pills.push({
        id: output.id,
        to: `/gallery/${output.id}`,
        name: output.title,
        kind: 'Export',
        pill: 'Exported',
        pillTone: 'ok',
      });
    }
    return pills.slice(0, 6);
  }, [assets, outputs]);

  return (
    <div className="lf-page">
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        display
        description={
          state === 'ready'
            ? `${resumeCards.length} drafts in progress and ${activeCampaigns.length} active campaign${activeCampaigns.length === 1 ? '' : 's'}.`
            : 'Continuity first: reusable models, environments and assets are versioned and independently locked before use in content jobs.'
        }
        actions={
          <>
            <Link className="lf-btn lf-btn--secondary" to="/create">
              Create model
            </Link>
            <Link className="lf-btn lf-btn--primary" to="/content-studio/new">
              Create content
            </Link>
          </>
        }
      />

      {state === 'loading' ? (
        <Card>
          <CardBody>
            <div style={{ display: 'grid', gap: 'var(--lf-space-3)', maxWidth: 420 }}>
              <Skeleton variant="title" />
              <Skeleton lines={2} />
            </div>
          </CardBody>
        </Card>
      ) : null}

      {state === 'error' ? (
        <Card>
          <CardBody>
            <p className="lf-tile__description" role="alert">
              {error}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {state === 'ready' ? (
        <>
          <section className="lf-section" aria-labelledby="home-continue">
            <div className="lf-section__header">
              <h2 className="lf-section__title" id="home-continue">
                Continue where you left off
              </h2>
              <Link className="lf-section__link" to="/create">
                Saved drafts <ChevronRightIcon size={14} />
              </Link>
            </div>
            {resumeCards.length === 0 ? (
              <Card>
                <CardBody>
                  <p className="lf-tile__description">
                    Nothing in progress — start a model, environment or content plan.
                  </p>
                </CardBody>
              </Card>
            ) : (
              <div className="lf-home__resumegrid">
                {resumeCards.map((card) => (
                  <Card key={card.id}>
                    <CardBody>
                      <div className="lf-home__resumebody">
                        <span className="lf-home__resumetitle">{card.title}</span>
                        <span className="lf-home__resumesubtitle">{card.subtitle}</span>
                        <div className="lf-home__resumerow">
                          <span className="lf-home__meter" aria-hidden="true">
                            <span style={{ width: `${card.progress}%` }} />
                          </span>
                          <span className="lf-home__resumelabel">{card.progressLabel}</span>
                        </div>
                        <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={card.to}>
                          Resume
                        </Link>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <div className="lf-home__columns">
            <section className="lf-section" aria-labelledby="home-attention">
              <div className="lf-section__header">
                <h2 className="lf-section__title" id="home-attention">
                  Needs your attention
                </h2>
                {attention.length > 0 ? <Badge tone="danger">{attention.length}</Badge> : null}
              </div>
              <Card>
                <CardBody>
                  {attention.length === 0 ? (
                    <p className="lf-tile__description">You're all caught up.</p>
                  ) : (
                    <ul className="lf-home__attention">
                      {attention.map((item) => (
                        <li key={item.id} className="lf-home__attentionrow">
                          <span className={`lf-home__attentionicon lf-home__attentionicon--${item.tone}`}>
                            {item.icon}
                          </span>
                          <span className="lf-home__attentionbody">
                            <span className="lf-home__attentiontitle">{item.title}</span>
                            <span className="lf-home__attentiondetail">{item.detail}</span>
                          </span>
                          <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={item.to}>
                            {item.actionLabel}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </section>

            <section className="lf-section" aria-labelledby="home-campaigns">
              <div className="lf-section__header">
                <h2 className="lf-section__title" id="home-campaigns">
                  Active campaigns
                </h2>
                <Link className="lf-section__link" to="/campaigns">
                  All campaigns <ChevronRightIcon size={14} />
                </Link>
              </div>
              <Card>
                <CardBody>
                  {activeCampaigns.length === 0 ? (
                    <p className="lf-tile__description">No active campaigns right now.</p>
                  ) : (
                    <ul className="lf-home__campaignlist">
                      {activeCampaigns.map((summary) => {
                        const percent = approvalPercent(summary);
                        return (
                          <li key={summary.campaign.id} className="lf-home__campaignrow">
                            <span className="lf-home__campaignbody">
                              <Link to={`/campaigns/${summary.campaign.id}`} className="lf-home__campaigntitle">
                                {summary.campaign.name}
                              </Link>
                              <span className="lf-home__campaignmeta">
                                {summary.approvedOutputCount} of {summary.itemCount} approved
                              </span>
                            </span>
                            <span
                              className="lf-home__ring"
                              style={{ '--lf-ring-percent': percent } as React.CSSProperties}
                              role="img"
                              aria-label={`${percent}% approved`}
                            >
                              {percent}%
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </section>
          </div>

          <section className="lf-section" aria-labelledby="home-recent">
            <div className="lf-section__header">
              <h2 className="lf-section__title" id="home-recent">
                Recent assets
              </h2>
              <Link className="lf-section__link" to="/library">
                Open Library <ChevronRightIcon size={14} />
              </Link>
            </div>
            {recentAssets.length === 0 ? (
              <Card>
                <CardBody>
                  <p className="lf-tile__description">
                    Library items and approved exports appear here.
                  </p>
                </CardBody>
              </Card>
            ) : (
              <div className="lf-home__assetgrid">
                {recentAssets.map((asset) => (
                  <Link key={asset.id} to={asset.to} className="lf-home__assetcard">
                    <span className="lf-home__assetpill" data-tone={asset.pillTone}>
                      {asset.pillTone === 'lock' ? <LockIcon size={11} /> : null}
                      {asset.pill}
                    </span>
                    <span className="lf-home__assetname">{asset.name}</span>
                    <span className="lf-home__assetkind">{asset.kind}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
