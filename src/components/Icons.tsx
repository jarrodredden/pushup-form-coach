import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
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

export const LockIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="4" y="11" width="16" height="10" rx="2.5" />
    <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
  </Svg>
);

export const UnlockIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="4" y="11" width="16" height="10" rx="2.5" />
    <path d="M8 11V7.5a4 4 0 0 1 7.6-1.7" />
  </Svg>
);

export const HistoryIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v4h4" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const CloseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const CameraIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
    <circle cx="12" cy="13" r="3.6" />
  </Svg>
);

export const StopIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const CheckIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const UploadIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 16V4" />
    <path d="M7 9l5-5 5 5" />
    <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
  </Svg>
);

export const RetryIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 4v4.5h-4.5" />
  </Svg>
);

export const ChevronIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

export const SpeakerIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
);
