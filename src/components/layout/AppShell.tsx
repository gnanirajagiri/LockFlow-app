import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNavDrawer } from './MobileNavDrawer';
import { MobileTabBar } from './MobileTabBar';
import { CommandPalette } from './CommandPalette';
import { readStoredString, writeStoredString } from '../../lib/storage';

const SIDEBAR_COLLAPSED_KEY = 'lockflow.sidebar.collapsed';

/**
 * Authenticated application frame: desktop sidebar (collapse state persisted
 * to localStorage), sticky topbar, scrollable content outlet, and the mobile
 * hamburger drawer below 960px.
 */
export function AppShell() {
  const [collapsed, setCollapsed] = useState(
    () => readStoredString(SIDEBAR_COLLAPSED_KEY) === '1',
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    writeStoredString(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Global ⌘K / Ctrl+K opens the command palette.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close the mobile drawer whenever the viewport crosses to desktop.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 961px)');
    function onChange(event: MediaQueryListEvent) {
      if (event.matches) setMobileNavOpen(false);
    }
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return (
    <div className="lf-shell">
      <a href="#lf-main-content" className="lf-skip-link">
        Skip to content
      </a>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
      />
      <div className="lf-main">
        <Topbar onOpenMobileNav={() => setMobileNavOpen(true)} onOpenSearch={() => setPaletteOpen(true)} />
        <main className="lf-content" id="lf-main-content">
          <Outlet />
        </main>
      </div>
      <MobileTabBar onOpenMore={() => setMobileNavOpen(true)} />
      <MobileNavDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
