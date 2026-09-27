/**
 * Route wrappers for the environment profile tabs.
 *
 * EnvironmentProfileLayout loads the shared environment data once and exposes
 * it through the Outlet context; each tab route is a thin wrapper, matching
 * the Models convention.
 */
import { Navigate, useOutletContext, useParams } from 'react-router-dom';
import { EnvironmentOverviewTab } from './EnvironmentOverviewTab';
import { EnvironmentEditorTab } from './EnvironmentEditorTab';
import { EnvironmentReferencesTab } from './EnvironmentReferencesTab';
import { EnvironmentVersionsTab } from './EnvironmentVersionsTab';
import { SEED_ENVIRONMENT_WORKSPACE_ID } from '../../mock/environmentsSeed';
import type { EnvironmentOutletContext } from './EnvironmentProfileLayout';
import type { EnvironmentState } from './useEnvironmentData';

export function useEnvironmentOutletContext(): EnvironmentOutletContext {
  return useOutletContext<EnvironmentOutletContext>();
}

/** /environments/:environmentId (index) — Overview tab. */
export function EnvironmentOverviewRoute() {
  const { environmentId } = useParams();
  const { service, data, basePath } = useEnvironmentOutletContext();
  if (!data.environment || !environmentId) return null;
  return (
    <EnvironmentOverviewTab
      environmentName={data.environment.name}
      activeVersion={data.activeVersion}
      service={service}
      data={data}
      basePath={basePath}
      activeWorkspaceId={SEED_ENVIRONMENT_WORKSPACE_ID}
    />
  );
}

/** /environments/:environmentId/edit */
export function EnvironmentEditRoute() {
  const { service, data, basePath } = useEnvironmentOutletContext();
  if (!data.environment) return null;
  return (
    <EnvironmentEditorTab
      service={service}
      versions={data.versions}
      activeVersionId={data.environment.activeVersionId}
      data={data as EnvironmentState}
      basePath={basePath}
    />
  );
}

/** /environments/:environmentId/references */
export function EnvironmentReferencesRoute() {
  const { service, data, basePath } = useEnvironmentOutletContext();
  if (!data.environment) return null;
  return (
    <EnvironmentReferencesTab
      service={service}
      versions={data.versions}
      data={data as EnvironmentState}
      basePath={basePath}
    />
  );
}

/** /environments/:environmentId/versions */
export function EnvironmentVersionsRoute() {
  const { environmentId } = useParams();
  const { service, data, basePath } = useEnvironmentOutletContext();
  if (!data.environment || !environmentId) return null;
  return (
    <EnvironmentVersionsTab
      service={service}
      environmentId={environmentId}
      versions={data.versions}
      data={data as EnvironmentState}
      basePath={basePath}
    />
  );
}

/**
 * /environments/:environmentId/specs — the Specs tab is the editor (one
 * guided form covers all spec sections); kept as a redirect so the four
 * profile tabs stay semantic.
 */
export function EnvironmentSpecsRoute() {
  const { environmentId } = useParams();
  return <Navigate to={`/environments/${environmentId}/edit`} replace />;
}
