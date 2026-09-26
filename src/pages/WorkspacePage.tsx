import { PlaceholderPage } from './PlaceholderPage';
import { WorkspaceIcon } from '../components/icons';
import { MOCK_WORKSPACE } from '../mock/workspace';

export function WorkspacePage() {
  return (
    <PlaceholderPage
      title="Workspace"
      description="Your studio workspace — team, plan and shared resources live here."
      emptyTitle="Workspace details are on the way"
      emptyDescription="Members, roles and workspace-level preferences arrive with database-backed workspaces."
      emptyIcon={<WorkspaceIcon size={22} />}
      badges={[MOCK_WORKSPACE.name, `${MOCK_WORKSPACE.plan} plan`]}
    />
  );
}
