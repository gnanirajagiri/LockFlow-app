import { PlaceholderPage } from './PlaceholderPage';
import { GalleryIcon } from '../components/icons';

export function GalleryPage() {
  return (
    <PlaceholderPage
      title="Gallery"
      description="Generated content jobs and outputs — queued, rendering, drafts, review-ready work and exports."
      emptyTitle="Nothing in the Gallery yet"
      emptyDescription={
        <>
          The Gallery fills up as content jobs run. It shows queued and rendering jobs,
          drafts, review-ready outputs and exports — nothing else.
        </>
      }
      emptyIcon={<GalleryIcon size={22} />}
      badges={['Queued', 'Rendering', 'Drafts', 'Review-ready', 'Exports']}
    />
  );
}
