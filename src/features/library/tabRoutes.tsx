/**
 * Route wrappers for the Library asset profile tabs.
 */
import { useOutletContext } from 'react-router-dom';
import { LibraryAssetOverviewTab } from './LibraryAssetOverviewTab';
import { LibraryAssetDetailsTab } from './LibraryAssetDetailsTab';
import { LibraryAssetReferencesTab } from './LibraryAssetReferencesTab';
import { LibraryAssetVersionsTab } from './LibraryAssetVersionsTab';
import type { LibraryOutletContext } from './LibraryAssetProfileLayout';

export function useLibraryOutletContext(): LibraryOutletContext {
  return useOutletContext<LibraryOutletContext>();
}

export function LibraryOverviewRoute() {
  return <LibraryAssetOverviewTab />;
}

export function LibraryDetailsRoute() {
  return <LibraryAssetDetailsTab />;
}

export function LibraryReferencesRoute() {
  return <LibraryAssetReferencesTab />;
}

export function LibraryVersionsRoute() {
  const { service, data, basePath } = useLibraryOutletContext();
  return <LibraryAssetVersionsTab service={service} versions={data.versions} data={data} basePath={basePath} />;
}
