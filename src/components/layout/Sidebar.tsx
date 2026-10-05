import { NavLink, useNavigate } from 'react-router-dom';
import { NAV_PRIMARY } from '../../navigation/nav';
import type { NavItem } from '../../navigation/nav';
import { useAuth } from '../../auth/AuthProvider';
import { ChevronLeftIcon, LogoutIcon, SparkIcon } from '../icons';

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * Maya's desktop navigation rail (draft: deep navy, flat curated nav,
 * violet active pill, sparkle brand, tagline footer). Collapses to an
 * icon-only rail; the choice is persisted by the parent shell.
 * Styling: `.lf-sidebar*` in src/styles/layout.css.
 */
export function Sidebar({ collapsed, onToggleCollapsed }: SidebarProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    try {
      await signOut();
    } finally {
      navigate('/login', { replace: true });
    }
  }

  return (
    <aside className={`lf-sidebar${collapsed ? ' lf-sidebar--collapsed' : ''}`} aria-label="Primary">
      <div className="lf-sidebar__top">
        <a href="/" className="lf-sidebar__brand" aria-label="Maya AI home">
          <span className={`lf-sidebar__brandname${collapsed ? ' lf-sidebar__brandname--hidden' : ''}`}>
            Maya
            <SparkIcon className="lf-sidebar__brandspark" size={16} aria-hidden="true" />
            <span className="lf-sidebar__brandsub">AI Content Studio</span>
          </span>
        </a>
      </div>

      <nav className="lf-sidebar__nav" aria-label="Maya sections">
        {NAV_PRIMARY.map((item) => (
          <NavLinkRow key={`${item.to}::${item.label}`} item={item} collapsed={collapsed} />
        ))}
      </nav>

      <div className="lf-sidebar__bottom">
        <p className={`lf-sidebar__tagline${collapsed ? ' lf-sidebar__tagline--hidden' : ''}`} aria-hidden="true">
          Better content.
          <br />
          Less effort.
        </p>
        <button
          type="button"
          className="lf-sidebar__collapse"
          onClick={onToggleCollapsed}
          aria-pressed={collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeftIcon className="lf-navlink__icon" />
          <span className={`lf-sidebar__collapse-label${collapsed ? ' lf-sidebar__collapse-label--hidden' : ''}`}>
            Collapse
          </span>
        </button>
        <button
          type="button"
          className="lf-sidebar__collapse"
          onClick={handleSignOut}
          aria-label={collapsed && user ? `Sign out ${user.email}` : 'Sign out'}
        >
          <LogoutIcon className="lf-navlink__icon" />
          <span className={`lf-sidebar__collapse-label${collapsed ? ' lf-sidebar__collapse-label--hidden' : ''}`}>
            {user ? `Sign out (${user.email})` : 'Sign out'}
          </span>
        </button>
      </div>
    </aside>
  );
}

function NavLinkRow({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `lf-navlink${isActive ? ' lf-navlink--active' : ''}`}
      title={collapsed ? item.label : undefined}
    >
      <span className="lf-navlink__icon" aria-hidden="true">
        {item.icon}
      </span>
      <span className={`lf-navlink__label${collapsed ? ' lf-navlink__label--hidden' : ''}`}>
        {item.label}
      </span>
    </NavLink>
  );
}
