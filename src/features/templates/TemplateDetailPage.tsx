/**
 * Template detail (/templates/:templateId) — read-friendly preview of the
 * reusable plan: overview, brief/direction, suggested input roles, scene and
 * beat outline, status and recent activity. Archived templates render
 * read-only with restore available.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { TemplateIcon } from '../../components/icons';
import { TemplatesService } from '../../services/templatesService';
import { getTemplatesRepository } from '../../data/templatesFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import type {
  ContentTemplateBeatRecord,
  ContentTemplateEventRecord,
  ContentTemplateRecord,
  ContentTemplateSceneRecord,
  ContentTemplateSuggestionRecord,
} from '../../domain/templates';
import {
  SUGGESTION_ONLY_COPY,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_OUTPUT_LABELS,
  TEMPLATE_STATUS_TONE,
  formatTemplateDate,
} from './templatesUi';

type LoadState = 'loading' | 'error' | 'ready';

export function TemplateDetailPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const service = useMemo(
    () =>
      new TemplatesService(getTemplatesRepository(), {
        library: new LibraryService(getLibraryRepository()),
        models: new ModelsService(getModelsRepository()),
        environments: new EnvironmentsService(getEnvironmentsRepository()),
      }),
    [],
  );

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState<ContentTemplateRecord | null>(null);
  const [scenes, setScenes] = useState<ContentTemplateSceneRecord[]>([]);
  const [beatsByScene, setBeatsByScene] = useState<Record<string, ContentTemplateBeatRecord[]>>({});
  const [suggestions, setSuggestions] = useState<ContentTemplateSuggestionRecord[]>([]);
  const [events, setEvents] = useState<ContentTemplateEventRecord[]>([]);

  const load = useCallback(async () => {
    if (!templateId) return;
    setState('loading');
    setError(null);
    try {
      const record = await service.getTemplate(templateId, SEED_CONTENT_WORKSPACE_ID);
      const sceneList = await service.listScenes(templateId, SEED_CONTENT_WORKSPACE_ID);
      const beatMap: Record<string, ContentTemplateBeatRecord[]> = {};
      for (const scene of sceneList) {
        beatMap[scene.id] = await service.listBeats(scene.id, SEED_CONTENT_WORKSPACE_ID);
      }
      const [suggestionList, eventList] = await Promise.all([
        service.listSuggestions(templateId, SEED_CONTENT_WORKSPACE_ID),
        service.listEvents(templateId, SEED_CONTENT_WORKSPACE_ID),
      ]);
      setTemplate(record);
      setScenes(sceneList);
      setBeatsByScene(beatMap);
      setSuggestions(suggestionList);
      setEvents(eventList);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this template.');
      setState('error');
    }
  }, [service, templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatusAction(kind: 'archive' | 'restore') {
    if (!template) return;
    try {
      if (kind === 'archive') {
        await service.archiveTemplate(template.id, SEED_CONTENT_WORKSPACE_ID);
        toast({ title: 'Template archived', tone: 'success' });
      } else {
        await service.restoreTemplate(template.id, SEED_CONTENT_WORKSPACE_ID);
        toast({ title: 'Template restored to draft', tone: 'success' });
      }
      await load();
    } catch (err) {
      toast({
        title: 'Not allowed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    }
  }

  async function duplicate() {
    if (!template) return;
    try {
      const copy = await service.duplicateTemplate(
        template.id,
        `${template.name} (copy)`.slice(0, 80),
        SEED_CONTENT_WORKSPACE_ID,
      );
      toast({ title: 'Template duplicated', description: copy.name, tone: 'success' });
      navigate(`/templates/${copy.id}/edit`);
    } catch (err) {
      toast({
        title: 'Could not duplicate',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    }
  }

  if (!templateId || state === 'loading') {
    return (
      <div className="lf-page" aria-busy="true">
        <Skeleton variant="rect" height={56} />
        <Skeleton variant="rect" height={300} />
      </div>
    );
  }

  if (state === 'error' || !template) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<TemplateIcon size={22} />}
          title="Couldn't open this template"
          description={error ?? undefined}
          actions={<Link className="lf-btn lf-btn--secondary" to="/templates">Back to Templates</Link>}
        />
      </div>
    );
  }

  const archived = template.status === 'archived';
  const beatTotal = Object.values(beatsByScene).reduce((sum, beats) => sum + beats.length, 0);
  const recentEvents = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);

  return (
    <div className="lf-page">
      <nav className="lf-library__filterreset" aria-label="Breadcrumb">
        <Link to="/templates">Templates</Link> / <span aria-current="page">{template.name}</span>
      </nav>

      <PageHeader
        eyebrow={`${TEMPLATE_CATEGORY_LABELS[template.category]} · ${TEMPLATE_OUTPUT_LABELS[template.defaultOutputType]}`}
        title={template.name}
        description={template.description ?? 'Reusable creative plan.'}
        actions={
          <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge tone={TEMPLATE_STATUS_TONE[template.status]} dot>{template.status}</Badge>
            {!archived ? (
              <Link className="lf-btn lf-btn--primary" to={`/templates/${template.id}/apply`}>
                Use template
              </Link>
            ) : null}
            {!archived ? (
              <Link className="lf-btn lf-btn--secondary" to={`/templates/${template.id}/edit`}>
                Edit
              </Link>
            ) : null}
            <Button variant="ghost" onClick={() => void duplicate()}>
              Duplicate
            </Button>
            {archived ? (
              <Button variant="secondary" onClick={() => void setStatusAction('restore')}>
                Restore
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => void setStatusAction('archive')}>
                Archive
              </Button>
            )}
          </div>
        }
      />

      {archived ? (
        <p className="lf-library__note" role="note">
          This template is archived and read-only. Restore it to apply or edit it.
        </p>
      ) : null}

      <div className="lf-envlock__layout">
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)', minWidth: 0 }}>
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Overview</h3>
              <p className="lf-tile__description">
                {scenes.length} scene{scenes.length === 1 ? '' : 's'} · {beatTotal} beat
                {beatTotal === 1 ? '' : 's'} · {suggestions.length} suggested input
                {suggestions.length === 1 ? '' : 's'} · defaults to {template.defaultVariants}{' '}
                variant{template.defaultVariants === 1 ? '' : 's'} per plan.
              </p>
              {template.briefTemplate.objective ? (
                <p className="lf-tile__description">
                  <strong>Objective:</strong> {template.briefTemplate.objective}
                </p>
              ) : null}
              {template.briefTemplate.audience ? (
                <p className="lf-tile__description">
                  <strong>Audience:</strong> {template.briefTemplate.audience}
                </p>
              ) : null}
              {template.briefTemplate.brandVoice ? (
                <p className="lf-tile__description">
                  <strong>Brand voice:</strong> {template.briefTemplate.brandVoice}
                </p>
              ) : null}
              {template.briefTemplate.campaignBrief ? (
                <p className="lf-tile__description">
                  <strong>Campaign brief:</strong> {template.briefTemplate.campaignBrief}
                </p>
              ) : null}
              {template.creativeDirection ? (
                <p className="lf-tile__description" style={{ whiteSpace: 'pre-wrap' }}>
                  <strong>Creative direction:</strong> {template.creativeDirection}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Scene and beat outline</h3>
              {scenes.length === 0 ? (
                <p className="lf-tile__description">No scenes yet.</p>
              ) : (
                <ol className="lf-section" style={{ gap: 'var(--lf-space-2)', paddingLeft: '1.2rem' }}>
                  {scenes.map((scene) => (
                    <li key={scene.id}>
                      <strong>{scene.title}</strong>
                      {scene.purpose ? ` — ${scene.purpose}` : ''}
                      <ul style={{ paddingLeft: '1.2rem' }} className="lf-tile__description">
                        {(beatsByScene[scene.id] ?? []).map((beat) => (
                          <li key={beat.id}>
                            {beat.title}
                            {beat.durationSeconds != null ? ` (${beat.durationSeconds}s)` : ''}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="lf-envlock__missingnote" style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Suggested input roles</h3>
              <p className="lf-tile__description">{SUGGESTION_ONLY_COPY}</p>
              {suggestions.length === 0 ? (
                <p className="lf-tile__description">No suggestions.</p>
              ) : (
                <ul className="lf-envref__list">
                  {suggestions.map((suggestion) => (
                    <li key={suggestion.id} className="lf-envref__item">
                      <span className="lf-refcard__type">
                        {suggestion.suggestionType.replace(/_/g, ' ')}
                      </span>
                      <span className="lf-envref__row">
                        <strong>{suggestion.suggestedRole.replace(/_/g, ' ')}</strong>
                        <Badge tone="neutral">Suggestion only</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Recent activity</h3>
              <ul className="lf-section" style={{ gap: 'var(--lf-space-2)' }}>
                {recentEvents.map((event) => (
                  <li key={event.id} className="lf-tile__description">
                    <strong>{event.eventType.replace(/_/g, ' ')}</strong> — {event.message}
                    <span className="lf-tile__meta"> · {formatTemplateDate(event.createdAt)}</span>
                  </li>
                ))}
                {recentEvents.length === 0 ? <li className="lf-tile__description">No activity yet.</li> : null}
              </ul>
              <p className="lf-tile__description" style={{ marginTop: 'var(--lf-space-2)' }}>
                Updated {formatTemplateDate(template.updatedAt)}
                {template.archivedAt ? ` · archived ${formatTemplateDate(template.archivedAt)}` : ''}
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
