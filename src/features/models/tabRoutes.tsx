/**
 * Route wrappers for the model profile tabs.
 *
 * ModelProfileLayout loads the shared model data once and exposes it through
 * the Outlet context; each tab route is a thin wrapper that pulls that
 * context and renders its panel. This keeps the router tree declarative in
 * App.tsx without prop-drilling through the layout.
 */
import { useOutletContext, useParams } from 'react-router-dom';
import { ModelsService } from '../../services/modelsService';
import { OverviewTab } from './OverviewTab';
import { CharacterSheetTab } from './CharacterSheetTab';
import { BuilderTab } from './BuilderTab';
import { VersionsTab } from './VersionsTab';
import { ClosetPropsTab, LooksTab, UsageHistoryTab } from './PlaceholderTabs';
import type { ModelState } from './useModelData';

export interface ModelOutletContext {
  service: ModelsService;
  data: ModelState;
  basePath: string;
}

export function useModelOutletContext(): ModelOutletContext {
  return useOutletContext<ModelOutletContext>();
}

/** /models/:modelId (index) — Overview tab. */
export function ModelOverviewRoute() {
  const { modelId } = useParams();
  const { data, basePath } = useModelOutletContext();
  if (!data.model || !modelId) return null;
  return (
    <OverviewTab
      modelId={modelId}
      modelName={data.model.name}
      activeVersion={data.activeVersion}
      basePath={basePath}
    />
  );
}

/** /models/:modelId/character-sheet */
export function ModelCharacterSheetRoute() {
  const { data, service, basePath } = useModelOutletContext();
  if (!data.model) return null;
  return (
    <CharacterSheetTab
      service={service}
      versions={data.versions}
      activeVersionId={data.model.activeVersionId}
      data={data}
      basePath={basePath}
    />
  );
}

/** /models/:modelId/builder */
export function ModelBuilderRoute() {
  return <BuilderTab />;
}

/** /models/:modelId/versions */
export function ModelVersionsRoute() {
  const { modelId } = useParams();
  const { data, service, basePath } = useModelOutletContext();
  if (!data.model || !modelId) return null;
  return (
    <VersionsTab
      service={service}
      modelId={modelId}
      versions={data.versions}
      activeVersionId={data.model.activeVersionId}
      data={data}
      basePath={basePath}
    />
  );
}

/** /models/:modelId/looks */
export function ModelLooksRoute() {
  return <LooksTab />;
}

/** /models/:modelId/closet-props */
export function ModelClosetPropsRoute() {
  return <ClosetPropsTab />;
}

/** /models/:modelId/usage-history */
export function ModelUsageHistoryRoute() {
  return <UsageHistoryTab />;
}
