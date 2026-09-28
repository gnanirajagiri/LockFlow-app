import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M9.5 21v-6h5v6" />
  </Icon>
);

export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="M12 8.2 13.2 11l2.8 1-2.8 1L12 15.8 10.8 13 8 12l2.8-1L12 8.2Z" />
  </Icon>
);

export const ModelIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4.5" y="4.5" width="15" height="15" rx="3.5" />
    <circle cx="9.5" cy="9.5" r="1.4" />
    <circle cx="14.5" cy="14.5" r="1.4" />
    <path d="M14.5 9.5h1.8M7.7 14.5h1.8" />
  </Icon>
);

export const StudioIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="3" />
    <path d="M3.5 15.5 9 10l4 4 2.5-2.5 5 4.5" />
    <circle cx="15" cy="8.7" r="1.3" />
  </Icon>
);

export const TemplateIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M4 9.5h16M9.5 9.5V20" />
  </Icon>
);

export const GalleryIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="4.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </Icon>
);

export const LibraryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 4.5h3.2v15H5zM11.5 4.5h3.2v15h-3.2z" />
    <path d="m18.6 5.4 2.4 13.7-3.1.5-2.4-13.7z" />
  </Icon>
);

export const CampaignIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10.5v3a1.5 1.5 0 0 0 1.5 1.5H8l6 4V5l-6 4H5.5A1.5 1.5 0 0 0 4 10.5Z" />
    <path d="M17.5 9c1 .8 1.5 1.8 1.5 3s-.5 2.2-1.5 3" />
  </Icon>
);

export const WorkspaceIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2" />
    <rect x="13" y="3.5" width="7.5" height="7.5" rx="2" />
    <rect x="3.5" y="13" width="7.5" height="7.5" rx="2" />
    <rect x="13" y="13" width="7.5" height="7.5" rx="2" />
  </Icon>
);

export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19 12c0-.5.6-1.9.4-2.3l-1.7-1a12 12 0 0 0-1.2-2l.2-2c-.3-.3-1.7-.6-2.2-.6l-1 1.7a12 12 0 0 0-2.3 0L10.2 4c-.5 0-1.9.3-2.2.6l.2 2a12 12 0 0 0-1.2 2l-1.7 1c-.2.4.4 1.8.4 2.3s-.6 1.9-.4 2.3l1.7 1a12 12 0 0 0 1.2 2l-.2 2c.3.3 1.7.6 2.2.6l1-1.7a12 12 0 0 0 2.3 0l1 1.7c.5 0 1.9-.3 2.2-.6l-.2-2a12 12 0 0 0 1.2-2l1.7-1c.2-.4-.4-1.8-.4-2.3Z" />
  </Icon>
);

export const HelpIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.3a2.5 2.5 0 0 1 4.9.7c0 1.6-2.4 2-2.4 3.4" />
    <path d="M12 17h.01" />
  </Icon>
);

export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    <path d="M12 14.5v2" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4.5 12.5 5 5L19.5 6.5" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V13M12 16.5h.01" />
  </Icon>
);

export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8h.01" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m14.5 6-6 6 6 6" />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </Icon>
);

export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8.2" r="3.7" />
    <path d="M5 20c1.3-3.2 3.9-4.8 7-4.8s5.7 1.6 7 4.8" />
  </Icon>
);

export const LogoutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
    <path d="M10 8l-4 4 4 4M6 12h9" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.4-4.4" />
  </Icon>
);

export const GridViewIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Icon>
);

export const ListViewIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6.5h16M4 12h16M4 17.5h16" />
  </Icon>
);

export const ArchiveIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="4.5" rx="1.5" />
    <path d="M5.5 9v8.5a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9" />
    <path d="M10 12.5h4" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" />
    <path d="M15.5 5.5v-.5A2 2 0 0 0 13.5 3h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CompareIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 4v16M16 4v16" />
    <path d="M8 6.5 4 12l4 5.5" />
    <path d="m16 6.5 4 5.5-4 5.5" />
  </Icon>
);

export const EnvironmentIcon = (p: IconProps) => (
  <Icon {...p}>
    {/* room outline with a floor line and a window/sun cue */}
    <path d="M4 9.5 12 4l8 5.5V20H4z" />
    <path d="M4 20h16" />
    <path d="M9.5 20v-5.5h5V20" />
    <circle cx="16.4" cy="10.2" r="1.1" />
  </Icon>
);

export const CameraIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.2-1.8h5.4L15.9 6h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
    <circle cx="12" cy="12.4" r="3.2" />
  </Icon>
);

export const ScanIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
    <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
    <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
    <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
    <path d="M4 12h16" />
  </Icon>
);
