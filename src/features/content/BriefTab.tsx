/**
 * Brief tab — the working brief for a draft content plan. Includes the
 * natural-language intent bar (captures creative direction text; no AI).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { CONTENT_OUTPUT_TYPES } from '../../domain/content';
import type { ContentOutputType } from '../../domain/content';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import { ContentIntentBar } from './ContentIntentBar';
import { useContentProjectOutletContext } from './tabRoutes';

const OUTPUT_OPTIONS = CONTENT_OUTPUT_TYPES.map((value) => ({
  value,
  label: value === 'content_set' ? 'Content set' : value.charAt(0).toUpperCase() + value.slice(1),
}));

export function BriefTab() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { service, data, basePath } = useContentProjectOutletContext();
  const project = data.project;

  const [name, setName] = useState('');
  const [campaignBrief, setCampaignBrief] = useState('');
  const [objective, setObjective] = useState('');
  const [audience, setAudience] = useState('');
  const [brandVoice, setBrandVoice] = useState('');
  const [creativeDirection, setCreativeDirection] = useState('');
  const [plannedOutputType, setPlannedOutputType] = useState<ContentOutputType | ''>('');
  const [requestedVariants, setRequestedVariants] = useState(1);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!project || hydrated) return;
    setName(project.name);
    setCampaignBrief(project.campaignBrief ?? '');
    setObjective(project.objective ?? '');
    setAudience(project.audience ?? '');
    setBrandVoice(project.brandVoice ?? '');
    setCreativeDirection(project.creativeDirection ?? '');
    setPlannedOutputType(project.plannedOutputType ?? '');
    setRequestedVariants(project.requestedVariants);
    setHydrated(true);
  }, [hydrated, project]);

  if (!project) return null;
  const isDraft = project.status === 'draft';

  async function handleSave() {
    if (!project) return;
    setSaving(true);
    setErrors([]);
    try {
      await service.updateProjectDraft(
        project.id,
        {
          name: name.trim(),
          campaignBrief: campaignBrief.trim() === '' ? null : campaignBrief.trim(),
          objective: objective.trim() === '' ? null : objective.trim(),
          audience: audience.trim() === '' ? null : audience.trim(),
          brandVoice: brandVoice.trim() === '' ? null : brandVoice.trim(),
          plannedOutputType: plannedOutputType === '' ? null : plannedOutputType,
          requestedVariants,
          creativeDirection: creativeDirection.trim() === '' ? null : creativeDirection.trim(),
        },
        SEED_CONTENT_WORKSPACE_ID,
      );
      toast({ title: 'Draft saved', description: `${name.trim()} was updated.`, tone: 'success' });
      await data.reload();
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Could not save the draft.']);
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!project) return;
    try {
      await service.archiveProject(project.id, SEED_CONTENT_WORKSPACE_ID);
      toast({ title: 'Plan archived', description: `${project.name} was archived.`, tone: 'success' });
      setArchiveOpen(false);
      navigate('/content-studio');
    } catch (err) {
      toast({
        title: 'Archive failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    }
  }

  return (
    <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
      <Card>
        <CardBody>
          <h3 className="lf-envpanel__heading">Brief</h3>
          {project.sourceTemplateName ? (
            <p className="lf-tile__description" role="note">
              Created from template: <strong>{project.sourceTemplateName}</strong>
            </p>
          ) : null}
          <div className="lf-formstack">
            <Input
              label="Project name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!isDraft}
              required
            />
            <label className="lf-field">
              <span className="lf-field__label">Campaign brief</span>
              <textarea
                className="lf-input lf-envform__textarea"
                rows={3}
                value={campaignBrief}
                onChange={(event) => setCampaignBrief(event.target.value)}
                disabled={!isDraft}
              />
            </label>
            <label className="lf-field">
              <span className="lf-field__label">Objective</span>
              <textarea
                className="lf-input lf-envform__textarea"
                rows={2}
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                disabled={!isDraft}
              />
            </label>
            <Input
              label="Audience"
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              disabled={!isDraft}
            />
            <Input
              label="Brand voice"
              value={brandVoice}
              onChange={(event) => setBrandVoice(event.target.value)}
              disabled={!isDraft}
            />
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
                disabled={!isDraft}
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
                disabled={!isDraft}
              />
              <span className="lf-field__hint">1–10 variants per planned output.</span>
            </label>
            <label className="lf-field">
              <span className="lf-field__label">Creative direction</span>
              <textarea
                className="lf-input lf-envform__textarea"
                rows={3}
                value={creativeDirection}
                onChange={(event) => setCreativeDirection(event.target.value)}
                disabled={!isDraft}
              />
              <span className="lf-field__hint">
                Creative direction is saved to this draft. AI-assisted planning will be connected later.
              </span>
            </label>
          </div>
        </CardBody>
      </Card>

      {isDraft ? (
        <Card>
          <CardBody>
            <ContentIntentBar
              label="Describe your creative direction"
              placeholder="For example: calm morning skincare routine, warm window light, confident and practical tone…"
              buttonLabel="Apply to brief"
              savedNote="Creative direction is saved to this draft. AI-assisted planning will be connected later."
              hasExistingText={creativeDirection.trim() !== ''}
              onApply={(text, mode) => {
                setCreativeDirection(mode === 'append' && creativeDirection.trim() !== ''
                  ? `${creativeDirection.trim()} ${text}`
                  : text);
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      {errors.length > 0 ? (
        <div className="lf-alertbox" role="alert">
          <ul>
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="lf-dialogactions">
        <Button variant="secondary" onClick={() => void handleSave()} disabled={!isDraft || saving}>
          {saving ? 'Saving…' : 'Save draft'}
        </Button>
        <Button variant="primary" onClick={() => navigate(`${basePath}/inputs`)}>
          Continue to inputs
        </Button>
        {isDraft ? (
          <Button variant="ghost" onClick={() => setArchiveOpen(true)}>
            Archive plan
          </Button>
        ) : null}
      </div>

      <Modal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title={`Archive ${project.name}?`}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setArchiveOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void handleArchive()}>
              Archive plan
            </Button>
          </div>
        }
      >
        <p>
          <strong>{project.name}</strong> will be marked archived and hidden from the default list.
          This is a soft archive — the plan, its scenes and beats are preserved, and nothing is
          deleted.
        </p>
      </Modal>
    </div>
  );
}
