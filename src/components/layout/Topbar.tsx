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
 * Stage-5 topbar: a 64px canvas strip with a hairline bottom border.
 * Left: breadcrumb trail (LockFlow / current section). Right: ⌘K search
 * chip, credits pill, notification bell with unread dot, and the identity
 * cluster (workspace chip + user chip with avatar and name).
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

      <nav className="lf-topbar__crumbs" aria-label="Breadcrumb">
        <span aria-hidden="true">LockFlow</span>
        <svg
          className="lf-topbar__crumbsep"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <span className="lf-topbar__crumbs-current" aria-current="page">
          {title}
        </span>
      </nav>

      <div className="lf-topbar__spacer" />

      <div className="lf-topbar__right">
        <div className="lf-topbar__search" aria-hidden="true">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <span>Search</span>
          <span className="lf-topbar__kbd">⌘K</span>
        </div>

        <div className="lf-topbar__credits" title={`${MOCK_WORKSPACE.credits.toLocaleString()} generation credits`}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          {MOCK_WORKSPACE.credits.toLocaleString()}
        </div>

        <button type="button" className="lf-topbar__bell" aria-label="Notifications (1 unread)">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          <span className="lf-topbar__belldot" aria-hidden="true" />
        </button>

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
          <span className="lf-topbar__title">{MOCK_WORKSPACE.name}</span>
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
