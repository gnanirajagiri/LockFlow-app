/**
 * Maya Create overview — Stage-5 S08. Two builder hero cards (Model Builder
 * "Create your presenter" / Environment Builder "Create your setting") with
 * eyebrow labels and photo panels, the Saved drafts strip (unlocked model and
 * environment drafts + content plans, S09), and the Recently locked rail.
 * Data comes from the same mock-backed services as the feature pages.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Card, CardBody } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { EnvironmentIcon, LockIcon, ModelIcon } from '../components/icons';
import { ModelsService } from '../services/modelsService';
import { EnvironmentsService } from '../services/environmentsService';
import { ContentStudioService } from '../services/contentService';
import { LibraryService } from '../services/libraryService';
import { getModelsRepository } from '../data';
import { getEnvironmentsRepository } from '../data/environmentsFactory';
import { getContentRepository } from '../data/contentFactory';
import { getLibraryRepository } from '../data/libraryFactory';
import { SEED_GALLERY_WORKSPACE_ID } from '../mock/gallerySeed';
import { SEED_CONTENT_WORKSPACE_ID } from '../mock/contentSeed';
import type { ModelRecord, ModelVersionRecord } from '../domain/models';
import type { EnvironmentRecord, EnvironmentVersionRecord } from '../domain/environments';
import type { ContentProjectSummary } from '../data/contentRepository';

interface DraftCard {
  id: string;
  to: string;
  name: string;
  meta: string;
}

interface LockedCard {
  id: string;
  to: string;
  name: string;
  versionLabel: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function CreatePage() {
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [modelVersions, setModelVersions] = useState<Record<string, ModelVersionRecord[]>>({});
  const [environments, setEnvironments] = useState<EnvironmentRecord[]>([]);
  const [environmentVersions, setEnvironmentVersions] = useState<Record<string, EnvironmentVersionRecord[]>>({});
  const [projects, setProjects] = useState<ContentProjectSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const modelsService = new ModelsService(getModelsRepository());
        const environmentsService = new EnvironmentsService(getEnvironmentsRepository());
        const content = new ContentStudioService(getContentRepository(), {
          library: new LibraryService(getLibraryRepository()),
          models: modelsService,
          environments: environmentsService,
        });
        const [modelRows, environmentRows, projectRows] = await Promise.all([
          modelsService.listModels(SEED_GALLERY_WORKSPACE_ID),
          environmentsService.listEnvironments(SEED_GALLERY_WORKSPACE_ID),
          content.listProjectSummaries(SEED_CONTENT_WORKSPACE_ID),
        ]);
        const versionMap: Record<string, ModelVersionRecord[]> = {};
        for (const model of modelRows) {
          versionMap[model.id] = await modelsService.getVersions(model.id, SEED_GALLERY_WORKSPACE_ID);
        }
        const envVersionMap: Record<string, EnvironmentVersionRecord[]> = {};
        for (const environment of environmentRows) {
          envVersionMap[environment.id] = await environmentsService.getVersions(
            environment.id,
            SEED_GALLERY_WORKSPACE_ID,
          );
        }
        if (cancelled) return;
        setModels(modelRows);
        setModelVersions(versionMap);
        setEnvironments(environmentRows);
        setEnvironmentVersions(envVersionMap);
        setProjects(projectRows);
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** S09: only unlocked model and environment drafts, newest first. */
  const savedDrafts = useMemo<DraftCard[]>(() => {
    const cards: DraftCard[] = [];
    for (const model of models) {
      const drafts = (modelVersions[model.id] ?? []).filter((v) => v.status === 'draft');
      for (const draft of drafts) {
        cards.push({
          id: `m-${draft.id}`,
          to: `/models/${model.id}/versions`,
          name: `${model.name} v${draft.versionNumber}`,
          meta: `Model version · ${relativeTime(draft.updatedAt)}`,
        });
      }
      if (model.status === 'draft') {
        cards.push({
          id: `m-${model.id}`,
          to: `/models/${model.id}`,
          name: model.name,
          meta: `Model · ${relativeTime(model.updatedAt)}`,
        });
      }
    }
    for (const environment of environments) {
      const drafts = (environmentVersions[environment.id] ?? []).filter((v) => v.status === 'draft');
      for (const draft of drafts) {
        cards.push({
          id: `e-${draft.id}`,
          to: `/environments/${environment.id}/versions`,
          name: `${environment.name} v${draft.versionNumber}`,
          meta: `Environment draft · ${relativeTime(draft.updatedAt)}`,
        });
      }
    }
    for (const project of projects) {
      cards.push({
        id: `p-${project.project.id}`,
        to: `/content-studio/${project.project.id}`,
        name: project.project.name,
        meta: `Content set · Plan · ${relativeTime(project.project.updatedAt)}`,
      });
    }
    return cards.slice(0, 4);
  }, [models, modelVersions, environments, environmentVersions, projects]);

  /** S08 "Recently locked": newest locked versions across both systems. */
  const recentlyLocked = useMemo<LockedCard[]>(() => {
    const locked: Array<LockedCard & { at: string }> = [];
    for (const model of models) {
      for (const version of modelVersions[model.id] ?? []) {
        if (version.status === 'locked' && version.lockedAt) {
          locked.push({
            id: `m-${version.id}`,
            to: `/models/${model.id}`,
            name: `${model.name} v${version.versionNumber}`,
            versionLabel: `v${version.versionNumber}`,
            at: version.lockedAt,
          });
        }
      }
    }
    for (const environment of environments) {
      for (const version of environmentVersions[environment.id] ?? []) {
        if (version.status === 'locked' && version.lockedAt) {
          locked.push({
            id: `e-${version.id}`,
            to: `/environments/${environment.id}`,
            name: `${environment.name} v${version.versionNumber}`,
            versionLabel: `v${version.versionNumber}`,
            at: version.lockedAt,
          });
        }
      }
    }
    return locked.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 3);
  }, [models, modelVersions, environments, environmentVersions]);

  return (
    <div className="lf-page">
      <PageHeader
        title="Create"
        description="Build your model and your environment separately, then combine them in Content Studio."
      />

      <div className="lf-createheroes">
        <Card className="lf-createhero">
          <CardBody>
            <div className="lf-createhero__copy">
              <span className="lf-createhero__icon" aria-hidden="true">
                <ModelIcon size={22} />
              </span>
              <span className="lf-createhero__eyebrow">Model Builder</span>
              <h2 className="lf-createhero__title">Create your presenter</h2>
              <p className="lf-createhero__body">
                Face, skin, hair, body, fine details and a Character Sheet — then lock it.
              </p>
              <Link className="lf-btn lf-btn--primary" to="/models">
                Start Model Builder
              </Link>
            </div>
            <div className="lf-createhero__media lf-createhero__media--model" aria-hidden="true">
              <ModelIcon size={48} />
            </div>
          </CardBody>
        </Card>

        <Card className="lf-createhero">
          <CardBody>
            <div className="lf-createhero__copy">
              <span className="lf-createhero__icon" aria-hidden="true">
                <EnvironmentIcon size={22} />
              </span>
              <span className="lf-createhero__eyebrow">Environment Builder</span>
              <h2 className="lf-createhero__title">Create your setting</h2>
              <p className="lf-createhero__body">
                Start from samples, shape rooms, anchors and a product zone — then lock it.
              </p>
              <Link className="lf-btn lf-btn--primary" to="/environments">
                Start Environment Builder
              </Link>
            </div>
            <div className="lf-createhero__media lf-createhero__media--env" aria-hidden="true">
              <EnvironmentIcon size={48} />
            </div>
          </CardBody>
        </Card>
      </div>

      <section className="lf-section" aria-labelledby="create-drafts">
        <div className="lf-section__header">
          <h2 className="lf-section__title" id="create-drafts">
            Saved drafts
          </h2>
          <Link className="lf-section__link" to="/gallery">
            See all
          </Link>
        </div>
        {loading ? (
          <Card>
            <CardBody>
              <Skeleton lines={2} />
            </CardBody>
          </Card>
        ) : savedDrafts.length === 0 ? (
          <Card>
            <CardBody>
              <p className="lf-tile__description">
                No drafts yet — everything you start will be saved here.
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="lf-home__resumegrid">
            {savedDrafts.map((draft) => (
              <Card key={draft.id}>
                <CardBody>
                  <div className="lf-createhero__draftpill" aria-hidden="true">
                    <span className="lf-createhero__pill">Draft</span>
                  </div>
                  <div className="lf-home__resumebody">
                    <span className="lf-home__resumetitle">{draft.name}</span>
                    <span className="lf-home__resumesubtitle">{draft.meta}</span>
                    <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={draft.to}>
                      Resume
                    </Link>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="lf-section" aria-labelledby="create-locked">
        <div className="lf-section__header">
          <h2 className="lf-section__title" id="create-locked">
            Recently locked
          </h2>
        </div>
        {loading ? (
          <Card>
            <CardBody>
              <Skeleton lines={1} />
            </CardBody>
          </Card>
        ) : recentlyLocked.length === 0 ? (
          <Card>
            <CardBody>
              <p className="lf-tile__description">
                Nothing locked yet — locked versions appear here once you lock a model or environment.
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="lf-createhero__lockedrow">
            {recentlyLocked.map((item) => (
              <Link key={item.id} to={item.to} className="lf-createhero__lockedcard">
                <span className="lf-createhero__lockedthumb" aria-hidden="true">
                  {item.to.startsWith('/models') ? <ModelIcon size={18} /> : <EnvironmentIcon size={18} />}
                </span>
                <span className="lf-createhero__lockedname">{item.name}</span>
                <LockIcon size={13} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
