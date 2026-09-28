/**
 * New content plan — creates a draft Content Project through the service
 * layer (name required; brief, objective, planned output type and requested
 * variants optional) and redirects to the Brief tab. No provider job is
 * created automatically.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/Toast';
import { CONTENT_OUTPUT_TYPES } from '../domain/content';
import type { ContentOutputType } from '../domain/content';
import { ContentStudioService } from '../services/contentService';
import { LibraryService } from '../services/libraryService';
import { ModelsService } from '../services/modelsService';
import { EnvironmentsService } from '../services/environmentsService';
import { getContentRepository } from '../data/contentFactory';
import { getLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository } from '../data';
import { getEnvironmentsRepository } from '../data/environmentsFactory';
import { SEED_CONTENT_WORKSPACE_ID } from '../mock/contentSeed';
import { STUDIO_HELPER_COPY } from '../features/content/contentUi';

const OUTPUT_OPTIONS = CONTENT_OUTPUT_TYPES.map((value) => ({
  value,
  label: value === 'content_set' ? 'Content set' : value.charAt(0).toUpperCase() + value.slice(1),
}));

export function ContentStudioNewPlanPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const service = useMemo(
    () =>
      new ContentStudioService(getContentRepository(), {
        library: new LibraryService(getLibraryRepository()),
        models: new ModelsService(getModelsRepository()),
        environments: new EnvironmentsService(getEnvironmentsRepository()),
      }),
    [],
  );

  const [name, setName] = useState('');
  const [campaignBrief, setCampaignBrief] = useState('');
  const [objective, setObjective] = useState('');
  const [plannedOutputType, setPlannedOutputType] = useState<ContentOutputType | ''>('');
  const [requestedVariants, setRequestedVariants] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const project = await service.createProject(
        {
          workspaceId: SEED_CONTENT_WORKSPACE_ID,
          name: name.trim(),
          ...(campaignBrief.trim() ? { campaignBrief: campaignBrief.trim() } : {}),
          ...(objective.trim() ? { objective: objective.trim() } : {}),
          ...(plannedOutputType !== '' ? { plannedOutputType } : {}),
          ...(requestedVariants !== 1 ? { requestedVariants } : {}),
        },
        'demo-user',
      );
      toast({
        title: 'Content plan created',
        description: `${project.name} starts as a draft — build the brief next.`,
        tone: 'success',
      });
      navigate(`/content-studio/${project.id}/brief`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the content plan.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Content Studio"
        title="New content plan"
        description="Start a working brief, then assemble approved inputs into scenes and beats."
        actions={
          <Link className="lf-btn lf-btn--secondary" to="/content-studio">
            Back to Content Studio
          </Link>
        }
      />

      <p className="lf-library__note" role="note">{STUDIO_HELPER_COPY}</p>

      <form
        className="lf-section"
        style={{ maxWidth: 640, gap: 'var(--lf-space-4)' }}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() !== '') void handleCreate();
        }}
      >
        <Card>
          <CardBody>
            <div className="lf-formstack">
              <Input
                label="Project name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                hint="e.g. Morning Skincare Routine"
              />
              <label className="lf-field">
                <span className="lf-field__label">Campaign brief (optional)</span>
                <textarea
                  className="lf-input lf-envform__textarea"
                  rows={3}
                  value={campaignBrief}
                  onChange={(event) => setCampaignBrief(event.target.value)}
                />
              </label>
              <label className="lf-field">
                <span className="lf-field__label">Objective (optional)</span>
                <textarea
                  className="lf-input lf-envform__textarea"
                  rows={2}
                  value={objective}
                  onChange={(event) => setObjective(event.target.value)}
                />
              </label>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Planned output</h3>
            <div className="lf-formstack">
              <label className="lf-field">
                <span className="lf-field__label">Planned output type</span>
                <select
                  className="lf-input"
                  value={plannedOutputType}
                  onChange={(event) => setPlannedOutputType(event.target.value as ContentOutputType | '')}
                >
                  <option value="">Choose a format…</option>
                  {OUTPUT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <span className="lf-field__hint">
                  Content set: a coordinated combination of photos, videos and stories from one brief.
                </span>
              </label>
              <label className="lf-field">
                <span className="lf-field__label">Requested variants</span>
                <input
                  type="number"
                  className="lf-input"
                  min={1}
                  max={10}
                  value={requestedVariants}
                  onChange={(event) => setRequestedVariants(Number(event.target.value))}
                />
                <span className="lf-field__hint">1–10 variants per planned output.</span>
              </label>
            </div>
          </CardBody>
        </Card>

        {error ? (
          <div className="lf-alertbox" role="alert">{error}</div>
        ) : null}

        <div className="lf-dialogactions">
          <Link className="lf-btn lf-btn--secondary" to="/content-studio">Cancel</Link>
          <Button type="submit" variant="primary" disabled={creating || name.trim() === ''}>
            {creating ? 'Creating…' : 'Create draft plan'}
          </Button>
        </div>
        <p className="lf-tile__description">
          The plan is created as a draft. Nothing is submitted to any provider — generation is not
          configured yet.
        </p>
      </form>
    </div>
  );
}
