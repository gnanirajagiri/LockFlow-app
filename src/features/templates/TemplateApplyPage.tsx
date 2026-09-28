/**
 * Apply template (/templates/:templateId/apply) — the explicit creation flow.
 *
 * Shows exactly what will be copied and requires an acknowledgement. On
 * success it redirects to the new Content Studio project's Brief step. No
 * Generate/Queue/Provider actions exist anywhere in Templates.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { TemplateIcon } from '../../components/icons';
import { TemplateApplicationService, TemplatesService } from '../../services/templatesService';
import { ContentStudioService } from '../../services/contentService';
import { getTemplatesRepository } from '../../data/templatesFactory';
import { getContentRepository } from '../../data/contentFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import type {
  ContentTemplateBeatRecord,
  ContentTemplateRecord,
  ContentTemplateSceneRecord,
  ContentTemplateSuggestionRecord,
} from '../../domain/templates';
import { APPLY_EXPLANATION_COPY, TEMPLATE_OUTPUT_LABELS } from './templatesUi';

type LoadState = 'loading' | 'error' | 'ready';

export function TemplateApplyPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const service = useMemo(() => {
    const templatesRepo = getTemplatesRepository();
    const bridges = {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    };
    return {
      templates: new TemplatesService(templatesRepo, bridges),
      apply: new TemplateApplicationService(
        templatesRepo,
        new ContentStudioService(getContentRepository(), bridges),
      ),
    };
  }, []);

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState<ContentTemplateRecord | null>(null);
  const [scenes, setScenes] = useState<ContentTemplateSceneRecord[]>([]);
  const [beatsByScene, setBeatsByScene] = useState<Record<string, ContentTemplateBeatRecord[]>>({});
  const [suggestions, setSuggestions] = useState<ContentTemplateSuggestionRecord[]>([]);

  const [projectName, setProjectName] = useState('');
  const [campaignBriefOverride, setCampaignBriefOverride] = useState('');
  const [variantsOverride, setVariantsOverride] = useState<number | ''>('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!templateId) return;
    setState('loading');
    setError(null);
    try {
      const record = await service.templates.getTemplate(templateId, SEED_CONTENT_WORKSPACE_ID);
      const sceneList = await service.templates.listScenes(templateId, SEED_CONTENT_WORKSPACE_ID);
      const beatMap: Record<string, ContentTemplateBeatRecord[]> = {};
      let beatTotal = 0;
      for (const scene of sceneList) {
        beatMap[scene.id] = await service.templates.listBeats(scene.id, SEED_CONTENT_WORKSPACE_ID);
        beatTotal += beatMap[scene.id].length;
      }
      const suggestionList = await service.templates.listSuggestions(templateId, SEED_CONTENT_WORKSPACE_ID);
      setTemplate(record);
      setScenes(sceneList);
      setBeatsByScene(beatMap);
      setSuggestions(suggestionList);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this template.');
      setState('error');
    }
  }, [service, templateId]);

  useEffect(() => {
    void load();
  }, [load]);

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
  const canApply =
    !archived && projectName.trim() !== '' && confirmed && !busy;

  async function apply() {
    if (!template) return;
    setBusy(true);
    try {
      const result = await service.apply.applyTemplate(
        template.id,
        {
          projectName: projectName.trim(),
          ...(campaignBriefOverride.trim() ? { campaignBriefOverride: campaignBriefOverride.trim() } : {}),
          ...(variantsOverride !== '' ? { requestedVariantsOverride: variantsOverride } : {}),
        },
        'demo-user',
        SEED_CONTENT_WORKSPACE_ID,
      );
      toast({
        title: 'Content plan created',
        description: `${result.project.name} was created from ${template.name}.`,
        tone: 'success',
      });
      navigate(`/content-studio/${result.project.id}/brief`);
    } catch (err) {
      toast({
        title: 'Could not create the content plan',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
      setBusy(false);
    }
  }

  return (
    <div className="lf-page">
      <nav className="lf-library__filterreset" aria-label="Breadcrumb">
        <Link to="/templates">Templates</Link> /{' '}
        <Link to={`/templates/${template.id}`}>{template.name}</Link> /{' '}
        <span aria-current="page">Use template</span>
      </nav>

      <PageHeader
        eyebrow="Use template"
        title={`Apply “${template.name}”`}
        description={template.description ?? 'Reusable creative plan.'}
        actions={null}
      />

      <div className="lf-envlock__layout">
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)', minWidth: 0 }}>
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">What will be created</h3>
              <ul className="lf-tile__description" style={{ paddingLeft: '1.2rem' }}>
                <li>
                  Output type: {TEMPLATE_OUTPUT_LABELS[template.defaultOutputType]} ·{' '}
                  {variantsOverride === '' ? template.defaultVariants : variantsOverride} variant
                  {(variantsOverride === '' ? template.defaultVariants : variantsOverride) === 1 ? '' : 's'} per plan
                </li>
                <li>
                  {scenes.length} scene{scenes.length === 1 ? '' : 's'} and {beatTotal} beat
                  {beatTotal === 1 ? '' : 's'} copied as editable draft structure
                </li>
                <li>Brief fields and creative direction copied into the new draft</li>
              </ul>
              <p className="lf-lockedbanner__copy" style={{ marginTop: 'var(--lf-space-2)' }}>
                {APPLY_EXPLANATION_COPY}
              </p>
              <p className="lf-tile__description" style={{ marginTop: 'var(--lf-space-2)' }}>
                The template itself is never modified, and no generation happens here.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">New content plan</h3>
              <div className="lf-formstack" style={{ marginTop: 'var(--lf-space-2)' }}>
                <Input
                  label="Content plan name (required)"
                  placeholder="e.g. “Autumn serum launch — week 1”"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  disabled={archived}
                  required
                />
                <label className="lf-field">
                  <span className="lf-field__label">Campaign brief override (optional)</span>
                  <textarea
                    className="lf-input lf-envform__textarea"
                    rows={3}
                    value={campaignBriefOverride}
                    onChange={(event) => setCampaignBriefOverride(event.target.value)}
                    placeholder={template.briefTemplate.campaignBrief ?? 'Leave empty to use the template brief.'}
                    disabled={archived}
                  />
                </label>
                <div>
                  <label className="lf-field__label" htmlFor="tmpl-apply-variants">
                    Default variants override (optional, 1–10)
                  </label>
                  <input
                    id="tmpl-apply-variants"
                    className="lf-input"
                    type="number"
                    min={1}
                    max={10}
                    value={variantsOverride}
                    onChange={(event) => {
                      const value = event.target.value === '' ? '' : Number(event.target.value);
                      if (value === '' || (Number.isInteger(value) && value >= 1 && value <= 10)) {
                        setVariantsOverride(value);
                      }
                    }}
                    disabled={archived}
                  />
                </div>
                <label className="lf-envref__row" style={{ alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    disabled={archived}
                  />
                  <span>I understand this will create a new editable Content Studio draft.</span>
                </label>
              </div>

              <div className="lf-dialogactions" style={{ justifyContent: 'flex-start', marginTop: 'var(--lf-space-3)' }}>
                <Button variant="primary" disabled={!canApply} onClick={() => void apply()}>
                  Create content plan
                </Button>
                <Link className="lf-btn lf-btn--secondary" to={`/templates/${template.id}`}>
                  Cancel
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>

        <aside className="lf-envlock__missingnote" style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Non-binding suggested inputs</h3>
              <p className="lf-tile__description">
                These hints travel with the template — nothing is selected or pinned by applying.
              </p>
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
        </aside>
      </div>
    </div>
  );
}
