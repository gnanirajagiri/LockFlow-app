import { PlaceholderPage } from './PlaceholderPage';
import { CampaignIcon } from '../components/icons';

export function CampaignsPage() {
  return (
    <PlaceholderPage
      title="Campaigns"
      description="Group content jobs into campaigns with shared assets and a common review flow."
      emptyTitle="No campaigns yet"
      emptyDescription={
        <>
          Campaigns organize related content jobs, reference locked versions from the
          Library and builders, and collect outputs back into the Gallery.
        </>
      }
      emptyIcon={<CampaignIcon size={22} />}
    />
  );
}
