import { NavLink } from 'react-router-dom';
import { Drawer } from '../ui/Drawer';
import { NAV_SECTIONS } from '../../navigation/nav';

export interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Hamburger-triggered navigation drawer for small screens (sidebar is hidden
 * below 960px). Renders the same terminology-locked navigation as the desktop
 * sidebar — one source of truth in src/navigation/nav.tsx.
 */
export function MobileNavDrawer({ open, onClose }: MobileNavDrawerProps) {
  return (
    <Drawer open={open} onClose={onClose} title="LockFlow">
      <nav aria-label="Primary mobile">
        {NAV_SECTIONS.map((section) => (
          <div key={section.id} className="lf-navsection" style={{ marginBottom: 'var(--lf-space-4)' }}>
            <div className="lf-navsection__label">{section.label}</div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `lf-navlink lf-navlink--light${isActive ? ' lf-navlink--active-light' : ''}`}
                onClick={onClose}
              >
                <span className="lf-navlink__icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="lf-navlink__label">{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </Drawer>
  );
}
