/**
 * New template (/templates/new) — draft editor for a reusable plan.
 *
 * Required: name, category, default output type. Optional: description,
 * variants, brief template fields, creative direction. The prompt bar only
 * fills the creative-direction field — it never calls a provider and says so.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { TemplatesService } from '../../services/templatesService';
import { getTemplatesRepository } from '../../data/templatesFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import { TEMPLATE_CATEGORIES } from '../../domain/templates';
import type { ContentTemplateRecord, TemplateCategory } from '../../domain/templates';
import { ContentIntentBar } from '../content/ContentIntentBar';
import {
  NEW_TEMPLATE_PROMPT_PLACEHOLDER,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_OUTPUT_LABELS,
  TEMPLATE_PROMPT_NOTE,
} from './templatesUi';

export function TemplateCreatePage() {
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

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TemplateCategory>('product_launch');
  const [defaultOutputType, setDefaultOutputType] =
    useState<ContentTemplateRecord['defaultOutputType']>('content_set');
  const [defaultVariants, setDefaultVariants] = useState(1);
  const [objective, setObjective] = useState('');
  const [audience, setAudience] = useState('');
  const [brandVoice, setBrandVoice] = useState('');
  const [campaignBrief, setCampaignBrief] = useState('');
  const [creativeDirection, setCreativeDirection] = useState('');
  const [busy, setBusy] = useState(false);

  const canSave = name.trim() !== '';

  async function save(then: (template: ContentTemplateRecord) => void) {
    if (!canSave) return;
    setBusy(true);
    try {
      const template = await service.createTemplate(
        {
          workspaceId: SEED_CONTENT_WORKSPACE_ID,
          name: name.trim(),
          description: description.trim() || undefined,
          category,
          defaultOutputType,
          defaultVariants,
          briefTemplate: {
            objective: objective.trim() || null,
            audience: audience.trim() || null,
            brandVoice: brandVoice.trim() || null,
            campaignBrief: campaignBrief.trim() || null,
          },
          creativeDirection: creativeDirection.trim() || undefined,
        },
        'demo-user',
      );
      toast({ title: 'Template draft saved', description: `${template.name} was created.`, tone: 'success' });
      then(template);
    } catch (err) {
      toast({
        title: 'Could not save the template',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lf-page">
      <nav className="lf-library__filterreset" aria-label="Breadcrumb">
        <Link to="/templates">Templates</Link> / <span aria-current="page">New template</span>
      </nav>

      <PageHeader
        eyebrow="Planning"
        title="New template"
        description="A reusable plan: structure and creative direction only — no source versions, no media."
        actions={null}
      />

      <div className="lf-envlock__layout">
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)', minWidth: 0 }}>
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Template basics</h3>
              <div className="lf-formstack" style={{ marginTop: 'var(--lf-space-2)' }}>
                <Input
                  label="Template name (required)"
                  placeholder="e.g. “Morning skincare launch set”"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
                <div>
                  <label className="lf-field__label" htmlFor="tmpl-new-category">Category (required)</label>
                  <select
                    id="tmpl-new-category"
                    className="lf-input"
                    value={category}
                    onChange={(event) => setCategory(event.target.value as TemplateCategory)}
                  >
                    {TEMPLATE_CATEGORIES.map((value) => (
                      <option key={value} value={value}>{TEMPLATE_CATEGORY_LABELS[value]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="lf-field__label" htmlFor="tmpl-new-output">Default output type (required)</label>
                  <select
                    id="tmpl-new-output"
                    className="lf-input"
                    value={defaultOutputType}
                    onChange={(event) =>
                      setDefaultOutputType(event.target.value as ContentTemplateRecord['defaultOutputType'])
                    }
                  >
                    {(Object.keys(TEMPLATE_OUTPUT_LABELS) as Array<ContentTemplateRecord['defaultOutputType']>).map(
                      (value) => (
                        <option key={value} value={value}>{TEMPLATE_OUTPUT_LABELS[value]}</option>
                      ),
                    )}
                  </select>
                </div>
                <div>
                  <label className="lf-field__label" htmlFor="tmpl-new-variants">Default variants (1–10)</label>
                  <input
                    id="tmpl-new-variants"
                    className="lf-input"
                    type="number"
                    min={1}
                    max={10}
                    value={defaultVariants}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isInteger(value) && value >= 1 && value <= 10) setDefaultVariants(value);
                    }}
                  />
                </div>
                <label className="lf-field">
                  <span className="lf-field__label">Description (optional)</span>
                  <textarea
                    className="lf-input lf-envform__textarea"
                    rows={2}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="What is this template for?"
                  />
                </label>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Brief template</h3>
              <p className="lf-tile__description">
                Copied into every new content plan created from this template.
              </p>
              <div className="lf-formstack" style={{ marginTop: 'var(--lf-space-2)' }}>
                <Input
                  label="Objective (optional)"
                  value={objective}
                  onChange={(event) => setObjective(event.target.value)}
                />
                <Input
                  label="Audience (optional)"
                  value={audience}
                  onChange={(event) => setAudience(event.target.value)}
                />
                <Input
                  label="Brand voice (optional)"
                  value={brandVoice}
                  onChange={(event) => setBrandVoice(event.target.value)}
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
                  <span className="lf-field__label">Creative direction (optional)</span>
                  <textarea
                    className="lf-input lf-envform__textarea"
                    rows={3}
                    value={creativeDirection}
                    onChange={(event) => setCreativeDirection(event.target.value)}
                    placeholder="Lighting, camera, pacing and tone direction…"
                  />
                </label>
              </div>

              <div style={{ marginTop: 'var(--lf-space-3)' }}>
                <ContentIntentBar
                  label="Describe the template you want"
                  placeholder={NEW_TEMPLATE_PROMPT_PLACEHOLDER}
                  buttonLabel="Apply as draft direction"
                  savedNote={TEMPLATE_PROMPT_NOTE}
                  hasExistingText={creativeDirection.trim() !== ''}
                  onApply={(text, mode) =>
                    setCreativeDirection((prev) =>
                      mode === 'append' && prev.trim() !== '' ? `${prev}\n${text}` : text,
                    )
                  }
                />
              </div>
            </CardBody>
          </Card>
        </div>

        <aside className="lf-envlock__missingnote" style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">What a template is</h3>
              <ul className="lf-tile__description" style={{ paddingLeft: '1.2rem' }}>
                <li>A reusable structure: scenes, beats, brief and direction</li>
                <li>A starting point — every applied copy is a new editable draft</li>
              </ul>
              <p className="lf-lockedbanner__copy">
                Templates never generate media and never pin model, environment, Look or asset
                versions. You choose approved versions in Content Studio.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <div style={{ display: 'grid', gap: 'var(--lf-space-2)' }}>
                <Button variant="primary" disabled={!canSave || busy} onClick={() => void save(() => navigate('/templates'))}>
                  Save draft
                </Button>
                <Button
                  variant="secondary"
                  disabled={!canSave || busy}
                  onClick={() => void save((template) => navigate(`/templates/${template.id}/edit`))}
                >
                  Continue to storyboard
                </Button>
                <Link className="lf-btn lf-btn--ghost" to="/templates">
                  Cancel
                </Link>
              </div>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
