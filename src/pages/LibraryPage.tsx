import { PlaceholderPage } from './PlaceholderPage';
import { LibraryIcon } from '../components/icons';

export function LibraryPage() {
  return (
    <PlaceholderPage
      title="Library"
      description="One unified reusable-asset system for products, props, wardrobe, saved Looks, scenes and brand assets."
      emptyTitle="The Library is empty"
      emptyDescription={
        <>
          Add products, props, wardrobe, saved Looks, scenes and brand assets here.
          Everything in the Library is versioned and reusable across content jobs.
        </>
      }
      emptyIcon={<LibraryIcon size={22} />}
      badges={['Products', 'Props', 'Wardrobe', 'Saved Looks', 'Scenes', 'Brand assets']}
    />
  );
}
