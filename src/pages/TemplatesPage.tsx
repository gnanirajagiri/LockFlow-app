import { PlaceholderPage } from './PlaceholderPage';
import { TemplateIcon } from '../components/icons';

export function TemplatesPage() {
  return (
    <PlaceholderPage
      title="Templates"
      description="Reusable starting points for content jobs — each template pins exact locked versions of models, environments and assets."
      emptyTitle="No templates yet"
      emptyDescription={
        <>
          Templates will pin exact locked versions of models, environments and Library
          assets, so every job starts from the same baseline.
        </>
      }
      emptyIcon={<TemplateIcon size={22} />}
    />
  );
}
