/**
 * Campaign create (/campaigns/new) — simple draft-creation flow.
 */
import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { CampaignsService } from '../../services/campaignsService';
import { getCampaignsRepository } from '../../data/campaignsFactory';
import { getGalleryRepository } from '../../data/galleryFactory';
import { getContentRepository } from '../../data/contentFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { GalleryService } from '../../services/galleryService';
import { ContentStudioService } from '../../services/contentService';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';

export function CampaignCreatePage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const service = useMemo(() => {
    const content = new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
    return new CampaignsService(
      getCampaignsRepository(),
      new GalleryService(getGalleryRepository(), content, SEED_GALLERY_WORKSPACE_ID),
    );
  }, []);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [objective, setObjective] = useState('');
  const [audience, setAudience] = useState('');
  const [keyMessage, setKeyMessage] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);

  const nameValid = name.trim().length >= 1 && name.trim().length <= 120;
  const dateProblem =
    startDate && endDate && startDate > endDate ? 'Start date must not be after end date.' : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!nameValid || dateProblem) return;
    setBusy(true);
    try {
      const campaign = await service.createCampaign(
        {
          workspaceId: SEED_GALLERY_WORKSPACE_ID,
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(objective.trim() ? { objective: objective.trim() } : {}),
          ...(audience.trim() ? { audience: audience.trim() } : {}),
          ...(keyMessage.trim() ? { keyMessage: keyMessage.trim() } : {}),
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
        },
        'demo-user',
      );
      toast({ title: 'Draft campaign created.', tone: 'success' });
      navigate(`/campaigns/${campaign.id}/overview`);
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : 'Could not create the campaign.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Campaigns"
        title="New campaign"
        description="Create a planning shell first — you will add approved Gallery outputs and channels next."
      />
      <Card>
        <CardBody>
          <form onSubmit={(event) => void handleSubmit(event)} noValidate>
            <div className="lf-formgrid">
              <Input
                id="campaign-name"
                label="Campaign name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                required
              />
              <div className="lf-field lf-field--full">
                <label className="lf-field__label" htmlFor="campaign-description">Description</label>
                <textarea
                  id="campaign-description"
                  className="lf-input"
                  rows={2}
                  maxLength={600}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
              <Input
                id="campaign-objective"
                label="Objective"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                maxLength={600}
              />
              <Input
                id="campaign-audience"
                label="Audience"
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
                maxLength={400}
              />
              <Input
                id="campaign-key-message"
                label="Key message"
                value={keyMessage}
                onChange={(event) => setKeyMessage(event.target.value)}
                maxLength={400}
              />
              <Input
                id="campaign-start"
                label="Start date"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
              <Input
                id="campaign-end"
                label="End date"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                error={dateProblem}
              />
            </div>
            <div className="lf-dialogactions" style={{ marginTop: 'var(--lf-space-4)' }}>
              <Link className="lf-btn lf-btn--secondary" to="/campaigns">Cancel</Link>
              <Button type="submit" variant="primary" disabled={!nameValid || Boolean(dateProblem) || busy}>
                Create draft campaign
              </Button>
            </div>
            <p className="lf-tile__description" style={{ marginTop: 'var(--lf-space-4)' }}>
              Campaigns are created as drafts. Only approved, non-archived Gallery outputs can be
              attached as campaign content — you will choose them on the Content tab.
            </p>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
