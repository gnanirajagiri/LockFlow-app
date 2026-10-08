/**
 * Mock data — placeholder until database access is implemented.
 *
 * These constants stand in for Supabase-backed workspace data so the shell
 * renders realistically. Replace with real queries (respecting RLS) when data
 * features land; do not build business logic on top of mocks.
 */
export interface MockWorkspace {
  id: string;
  name: string;
  plan: string;
  initials: string;
  /** Generation credits remaining (Stage-5 topbar credits pill). */
  credits: number;
}

export const MOCK_WORKSPACE: MockWorkspace = {
  id: 'ws_demo',
  name: 'Glow Studio',
  plan: 'Studio',
  initials: 'GS',
  credits: 1240,
};
