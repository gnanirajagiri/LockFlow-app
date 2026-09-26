import { PlaceholderPage } from './PlaceholderPage';
import { ModelIcon } from '../components/icons';

export function ModelsPage() {
  return (
    <PlaceholderPage
      eyebrow="Builder"
      title="Models"
      description="The Model Builder is one of two independent builder systems, each with its own versions and locks."
      emptyTitle="No models yet"
      emptyDescription={
        <>
          Create your first model in the Model Builder. Versions are recorded
          automatically, and locking a version makes it immutable and referenceable by
          content jobs.
        </>
      }
      emptyIcon={<ModelIcon size={22} />}
      badges={['Model Builder', 'Independent locks', 'Independent versions']}
    />
  );
}
