import { PlaceholderPage } from './PlaceholderPage';
import { StudioIcon } from '../components/icons';

export function StudioPage() {
  return (
    <PlaceholderPage
      eyebrow="Builder"
      title="Content Studio"
      description="The Environment Builder lives here — a separate system from the Model Builder, with independent locks and versions."
      emptyTitle="No environments yet"
      emptyDescription={
        <>
          Compose scene environments, then version and lock them independently of
          models. Locked environment versions are what content jobs reference.
        </>
      }
      emptyIcon={<StudioIcon size={22} />}
      badges={['Environment Builder', 'Independent locks', 'Independent versions']}
    />
  );
}
