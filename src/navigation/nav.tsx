import type { ReactNode } from 'react';
import {
  CampaignIcon,
  EnvironmentIcon,
  GalleryIcon,
  HomeIcon,
  LibraryIcon,
  ModelIcon,
  SettingsIcon,
  SparkIcon,
  StudioIcon,
  TemplateIcon,
  HelpIcon,
  WorkspaceIcon,
} from '../components/icons';

export interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
  /** Exact-match active state (Home uses this). */
  end?: boolean;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

/**
 * The single source of truth for product navigation and route metadata.
 *
 * Terminology is contractual:
 * - "Gallery" is generated content jobs and outputs only.
 * - "Library" is the one unified reusable-asset system (products, props,
 *   wardrobe, saved Looks, scenes, brand assets) — never "Global Library",
 *   "My Library" or "Library of outputs".
 * - "Models" and "Content Studio" are separate builder systems with
 *   independent locks and versions.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'primary',
    label: 'Studio',
    items: [
      { label: 'Home', to: '/', icon: <HomeIcon />, end: true },
      { label: 'Create', to: '/create', icon: <SparkIcon /> },
    ],
  },
  {
    id: 'work',
    label: 'Work',
    items: [
      { label: 'Models', to: '/models', icon: <ModelIcon /> },
      { label: 'Environments', to: '/environments', icon: <EnvironmentIcon /> },
      { label: 'Content Studio', to: '/content-studio', icon: <StudioIcon /> },
      { label: 'Templates', to: '/templates', icon: <TemplateIcon /> },
      { label: 'Gallery', to: '/gallery', icon: <GalleryIcon /> },
      { label: 'Library', to: '/library', icon: <LibraryIcon /> },
      { label: 'Campaigns', to: '/campaigns', icon: <CampaignIcon /> },
    ],
  },
  {
    id: 'utility',
    label: 'Utilities',
    items: [
      { label: 'Workspace', to: '/workspace', icon: <WorkspaceIcon /> },
      { label: 'Settings', to: '/settings', icon: <SettingsIcon /> },
      { label: 'Help', to: '/help', icon: <HelpIcon /> },
    ],
  },
];

export const NAV_FLAT: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export function findNavByPath(pathname: string): NavItem | undefined {
  return NAV_FLAT.find((item) =>
    item.end ? pathname === item.to : pathname.startsWith(item.to),
  );
}

export function routeTitle(pathname: string): string {
  return findNavByPath(pathname)?.label ?? 'LockFlow';
}
