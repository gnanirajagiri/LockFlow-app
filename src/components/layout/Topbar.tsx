import { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MenuIcon, SearchIcon, BellIcon } from '../icons';
import { NAV_FLAT, routeTitle } from '../../navigation/nav';
import type { NavItem } from '../../navigation/nav';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../ui/Toast';
import { MOCK_WORKSPACE } from '../../mock/workspace';

export interface TopbarProps {
  onOpenMobileNav: () => void;
}

/** NAV_FLAT contains duplicates (Home/Overview, Models ×2) — collapse them. */
function dedupeNav(items: NavItem[]): NavItem[] {
  const seen = new Set<string>();
  const out: NavItem[] = [];
  for (const item of items) {
    const key = `${item.to}::${item.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

const NAV_UNIQUE = dedupeNav(NAV_FLAT);

/**
 * Sticky topbar: current section title on the left, a global quick-nav search
 * in the centre, and workspace / notifications / identity on the right.
 */
export function Topbar({ onOpenMobileNav }: TopbarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const title = routeTitle(pathname);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return NAV_UNIQUE.filter((item) => item.label.toLowerCase().includes(needle)).slice(0, 6);
  }, [query]);

  function goTo(item: NavItem) {
    setQuery('');
    setOpen(false);
    navigate(item.to);
  }

  return (
    <header className="lf-topbar">
      <div className="lf-topbar__left">
        <button
          type="button"
          className="lf-iconbtn lf-topbar__menu"
          aria-label="Open navigation menu"
          onClick={onOpenMobileNav}
        >
          <MenuIcon />
        </button>
        <h1 className="lf-topbar__title">{title}</h1>
      </div>

      <div className="lf-topbar__search" role="search">
        <span className="lf-topbar__searchicon" aria-hidden="true">
          <SearchIcon size={16} />
        </span>
        <input
          ref={inputRef}
          type="search"
          className="lf-topbar__searchinput"
          placeholder="Search Maya…"
          aria-label="Search pages"
          aria-expanded={open && query.trim() !== ''}
          aria-autocomplete="list"
          role="combobox"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const first = results[0];
              if (first) goTo(first);
            } else if (event.key === 'Escape') {
              setQuery('');
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
        />
        {open && query.trim() !== '' ? (
          <div className="lf-topbar__searchmenu" role="listbox" aria-label="Search results">
            {results.length === 0 ? (
              <p className="lf-topbar__searchempty">No pages match “{query.trim()}”.</p>
            ) : (
              results.map((item) => (
                <button
                  key={`${item.to}::${item.label}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="lf-topbar__searchitem"
                  onMouseDown={(event) => {
                    // Navigate on mousedown so the blur that follows does not
                    // close the menu before the click registers.
                    event.preventDefault();
                    goTo(item);
                  }}
                >
                  {item.label}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div className="lf-topbar__right">
        <div className="lf-topbar__workspace" title={`${MOCK_WORKSPACE.name} · ${MOCK_WORKSPACE.plan} plan`}>
          <span className="lf-avatar" style={{ width: 22, height: 22, fontSize: '10px' }} aria-hidden="true">
            {MOCK_WORKSPACE.initials}
          </span>
          <span className="lf-topbar__title" style={{ fontSize: 'var(--lf-text-sm)' }}>
            {MOCK_WORKSPACE.name}
          </span>
        </div>

        <button
          type="button"
          className="lf-topbar__bell"
          aria-label="Notifications"
          title="Notifications"
          onClick={() => toast({ title: 'No new notifications', tone: 'info' })}
        >
          <BellIcon size={18} />
          <span className="lf-topbar__belldot" aria-hidden="true" />
        </button>

        <button type="button" className="lf-topbar__user" title={user?.email ?? ''}>
          <span className="lf-avatar" aria-hidden="true">
            {(user?.name ?? '?').slice(0, 1).toUpperCase()}
          </span>
          <span>{user?.name ?? 'Account'}</span>
        </button>
      </div>
    </header>
  );
}
