import { NavLink, useNavigate } from 'react-router-dom';
import { NAV_SECTIONS, type NavItem } from '../../navigation/nav';
import { useAuth } from '../../auth/AuthProvider';
import { ChevronLeftIcon, LogoutIcon } from '../icons';

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * Desktop navigation rail (dark navy). Collapses to an icon-only rail; the
 * choice is persisted by the parent shell so it survives reloads.
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
        <a href="/" className="lf-sidebar__brand" aria-label="LockFlow home">
          <span className="lf-brandmark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
              <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
            </svg>
          </span>
          <span className={`lf-sidebar__brandname${collapsed ? ' lf-sidebar__brandname--hidden' : ''}`}>
            LockFlow
          </span>
        </a>
      </div>

      <nav className="lf-sidebar__nav">
        {NAV_SECTIONS.map((section) => (
          <div key={section.id} className="lf-navsection">
            <div
              className={`lf-navsection__label${collapsed ? ' lf-navsection__label--hidden' : ''}`}
              id={`nav-section-${section.id}`}
            >
              {section.label}
            </div>
            {section.items.map((item) => (
              <NavLinkRow key={item.to} item={item} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </nav>

      <div className="lf-sidebar__bottom">
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
      aria-labelledby={`nav-section-${item.to}`}
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
