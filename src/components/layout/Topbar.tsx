import { useLocation } from 'react-router-dom';
import { routeTitle } from '../../navigation/nav';
import { useAuth } from '../../auth/AuthProvider';
import { MenuIcon } from '../icons';
import { useAvatar } from '../../generation/useAvatar';
import { MOCK_WORKSPACE } from '../../mock/workspace';

export interface TopbarProps {
  /** Opens the mobile nav drawer (the trigger is hidden on desktop). */
  onOpenMobileNav: () => void;
}

/**
 * Maya draft topbar: a quiet transparent strip — the page's big title lives
 * in the content column, so the bar carries only the identity cluster
 * (workspace chip + user chip with avatar and name) on the right.
 *
 * Both chips render real images when one exists: a Settings photo upload
 * first, then an AI-generated portrait; the letter avatar stays as the
 * empty-state fallback.
 */
export function Topbar({ onOpenMobileNav }: TopbarProps) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const title = routeTitle(pathname);
  const userAvatar = useAvatar('user');
  const workspaceAvatar = useAvatar('workspace');

  const initials = (name: string): string => name.slice(0, 1).toUpperCase();

  return (
    <header className="lf-topbar">
      <button
        type="button"
        className="lf-iconbtn lf-topbar__menu"
        aria-label="Open navigation menu"
        onClick={onOpenMobileNav}
      >
        <MenuIcon />
      </button>
      <span className="lf-visually-hidden">{title}</span>
      <div className="lf-topbar__spacer" />

      <div className="lf-topbar__right">
        <div className="lf-topbar__workspace" title={`${MOCK_WORKSPACE.name} · ${MOCK_WORKSPACE.plan} plan`}>
          {workspaceAvatar.src ? (
            <img
              className="lf-avatar lf-avatar--img"
              style={{ width: 22, height: 22 }}
              src={workspaceAvatar.src}
              alt=""
            />
          ) : (
            <span className="lf-avatar" style={{ width: 22, height: 22, fontSize: '10px' }} aria-hidden="true">
              {MOCK_WORKSPACE.initials}
            </span>
          )}
          <span className="lf-topbar__title" style={{ fontSize: 'var(--lf-text-sm)' }}>
            {MOCK_WORKSPACE.name}
          </span>
        </div>

        <button type="button" className="lf-topbar__user" title={user?.email ?? ''}>
          {userAvatar.src ? (
            <img
              className="lf-avatar lf-avatar--img"
              style={{ width: 28, height: 28 }}
              src={userAvatar.src}
              alt=""
            />
          ) : (
            <span className="lf-avatar lf-avatar--photo" aria-hidden="true">
              {initials(user?.name ?? '?')}
            </span>
          )}
          <span>{user?.name ?? 'Account'}</span>
          <svg className="lf-topbar__caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
    </header>
  );
}
