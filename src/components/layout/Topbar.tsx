import { MenuIcon } from '../icons';
import { routeTitle } from '../../navigation/nav';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { MOCK_WORKSPACE } from '../../mock/workspace';

export interface TopbarProps {
  onOpenMobileNav: () => void;
}

/**
 * Sticky topbar. Shows the current section title, the active workspace (mock
 * until database access lands) and the signed-in identity.
 */
export function Topbar({ onOpenMobileNav }: TopbarProps) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const title = routeTitle(pathname);

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

      <h1 className="lf-topbar__title">{title}</h1>
      <div className="lf-topbar__spacer" />

      <div className="lf-topbar__workspace" title={`${MOCK_WORKSPACE.name} · ${MOCK_WORKSPACE.plan} plan`}>
        <span className="lf-avatar" style={{ width: 22, height: 22, fontSize: '10px' }} aria-hidden="true">
          {MOCK_WORKSPACE.initials}
        </span>
        <span className="lf-topbar__title" style={{ fontSize: 'var(--lf-text-sm)' }}>
          {MOCK_WORKSPACE.name}
        </span>
      </div>

      <button type="button" className="lf-topbar__user" title={user?.email ?? ''}>
        <span className="lf-avatar" aria-hidden="true">
          {(user?.name ?? '?').slice(0, 1).toUpperCase()}
        </span>
        <span>{user?.name ?? 'Account'}</span>
      </button>
    </header>
  );
}
