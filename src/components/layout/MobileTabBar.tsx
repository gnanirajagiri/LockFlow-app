import { NavLink, useLocation } from 'react-router-dom';
import {
  GalleryIcon,
  GridViewIcon,
  HomeIcon,
  SparkIcon,
  StudioIcon,
} from '../icons';

export interface MobileTabBarProps {
  /** Opens the full navigation drawer for the "More" tab (M03). */
  onOpenMore: () => void;
}

interface MobileTab {
  key: string;
  label: string;
  to?: string;
  end?: boolean;
  icon: (props: { size?: number }) => React.ReactNode;
}

/**
 * Stage-5 mobile bottom tab bar (M02–M18): Home / Create / Studio / Gallery /
 * More — five equal columns on a 72px white bar, 11px labels, indigo active
 * state. "More" opens the full navigation drawer instead of a route.
 */
const TABS: MobileTab[] = [
  { key: 'home', label: 'Home', to: '/', end: true, icon: HomeIcon },
  { key: 'create', label: 'Create', to: '/create', icon: SparkIcon },
  { key: 'studio', label: 'Studio', to: '/content-studio', icon: StudioIcon },
  { key: 'gallery', label: 'Gallery', to: '/gallery', icon: GalleryIcon },
  { key: 'more', label: 'More', icon: GridViewIcon },
];

const MORE_SECTION_PATHS = ['/models', '/environments', '/templates', '/library', '/campaigns', '/workspace', '/settings', '/publishing', '/help'];

export function MobileTabBar({ onOpenMore }: MobileTabBarProps) {
  const { pathname } = useLocation();

  const moreActive =
    !TABS.some((t) => t.to && (t.end ? pathname === t.to : pathname.startsWith(t.to))) &&
    MORE_SECTION_PATHS.some((p) => pathname.startsWith(p));

  return (
    <nav className="lf-mobiletabs" aria-label="Primary mobile">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        if (!tab.to) {
          return (
            <button
              key={tab.key}
              type="button"
              className={`lf-mobiletabs__tab${moreActive ? ' lf-mobiletabs__tab--active' : ''}`}
              onClick={onOpenMore}
            >
              <Icon size={22} />
              <span>{tab.label}</span>
            </button>
          );
        }
        const active = tab.end ? pathname === tab.to : pathname.startsWith(tab.to);
        return (
          <NavLink
            key={tab.key}
            to={tab.to}
            end={tab.end}
            className={`lf-mobiletabs__tab${active ? ' lf-mobiletabs__tab--active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={22} />
            <span>{tab.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
