// JRC Race Engineer — nav icon set ("Solid Form").
// Drawn on a 24px grid. Fill = currentColor, so tint via CSS `color`.
// Negative-space details (gauge needle, garage door, keylines) use
// --jrc-icon-cutout, which must match the surface the icon sits on.
// Set it once per surface — see `.bottom-nav` / `.sidebar` in globals.css.
//
// Solid in both states by design: active vs inactive is a colour swap
// (primary vs muted), never an outline→filled swap.
import React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

/** Any glyph in this set — what `PrimaryNavItem.icon` holds. */
export type JrcIcon = React.ComponentType<IconProps>;

export const IconDashboard = ({ size = 24, ...props }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
    <path d="M12 4a9 9 0 0 0-7.05 14.62c.19.24.48.38.79.38h12.52c.31 0 .6-.14.79-.38A9 9 0 0 0 12 4Z" fill="currentColor" />
    <path d="M12 13.4l3.9-5.1" stroke="var(--jrc-icon-cutout, #141414)" strokeWidth="1.9" strokeLinecap="round" />
    <circle cx="12" cy="13.4" r="1.35" fill="var(--jrc-icon-cutout, #141414)" />
  </svg>
);

export const IconAnalysis = ({ size = 24, ...props }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
    <g fill="currentColor">
      <rect x="4.4" y="11.6" width="4" height="8.4" rx="1.4" />
      <rect x="10" y="4" width="4" height="16" rx="1.4" />
      <rect x="15.6" y="8" width="4" height="12" rx="1.4" />
    </g>
  </svg>
);

export const IconEvents = ({ size = 24, ...props }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
    <g fill="currentColor">
      <rect x="7.1" y="2.4" width="2" height="4.6" rx="1" />
      <rect x="14.9" y="2.4" width="2" height="4.6" rx="1" />
      <rect x="3" y="4.6" width="18" height="16.4" rx="2.8" />
    </g>
    <path
      d="M3.7 9.9h16.6"
      stroke="var(--jrc-icon-cutout, #141414)"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    <rect x="7.2" y="13" width="4.1" height="3.7" rx="1.1" fill="var(--jrc-icon-cutout, #141414)" />
  </svg>
);

export const IconEngineer = ({ size = 24, ...props }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
    <path
      d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
      fill="currentColor"
    />
    <path d="M19.5 2.2c.3 1.2.9 1.8 2.1 2.1-1.2.3-1.8.9-2.1 2.1-.3-1.2-.9-1.8-2.1-2.1 1.2-.3 1.8-.9 2.1-2.1Z" fill="currentColor" />
  </svg>
);

export const IconGarage = ({ size = 24, ...props }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
    <path
      d="M11.32 5.06a1.6 1.6 0 0 1 1.36 0l7.5 3.4c.5.23.82.74.82 1.29v9.15c0 .66-.54 1.2-1.2 1.2H4.2A1.2 1.2 0 0 1 3 18.9V9.75c0-.55.32-1.06.82-1.29Z"
      fill="currentColor"
    />
    <path
      d="M7.4 20.1v-6.6h9.2v6.6M7.4 16.8h9.2"
      stroke="var(--jrc-icon-cutout, #141414)"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const IconTeams = ({ size = 24, ...props }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="15.6" cy="8.7" r="2.85" fill="currentColor" />
    <path
      d="M15.6 13.3a5.2 5.2 0 0 1 5.2 5.2c0 .61-.5 1.1-1.1 1.1h-8.2a1.1 1.1 0 0 1-1.1-1.1 5.2 5.2 0 0 1 5.2-5.2Z"
      fill="currentColor"
    />
    <circle cx="8.7" cy="8.1" r="3.4" fill="currentColor" stroke="var(--jrc-icon-cutout, #141414)" strokeWidth="1.8" />
    <path
      d="M8.7 13.1a6 6 0 0 1 6 6c0 .66-.54 1.2-1.2 1.2H3.9a1.2 1.2 0 0 1-1.2-1.2 6 6 0 0 1 6-6Z"
      fill="currentColor"
      stroke="var(--jrc-icon-cutout, #141414)"
      strokeWidth="1.8"
    />
  </svg>
);

export const IconSettings = ({ size = 24, ...props }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
    <path
      d="M4 6.2h7M18.2 6.2H20M4 12h1.8M13 12h7M4 17.8h4.4M15.6 17.8H20"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <circle cx="14.6" cy="6.2" r="2.4" fill="currentColor" />
    <circle cx="9.4" cy="12" r="2.4" fill="currentColor" />
    <circle cx="12" cy="17.8" r="2.4" fill="currentColor" />
  </svg>
);

export const IconAddRun = ({ size = 24, ...props }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
    <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

export const navIcons = {
  dashboard: IconDashboard,
  analysis: IconAnalysis,
  engineer: IconEngineer,
  garage: IconGarage, // assets nav id
  teams: IconTeams,
  settings: IconSettings,
  addRun: IconAddRun,
} as const;
