import type { ReactNode, SVGProps } from "react";
import { cardBrand } from "../lib/cardBrand";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number, props: SVGProps<SVGSVGElement>) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
  ...props,
});

export function EyeIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.4 18.4 0 0 1 4.22-5.34" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c6.5 0 10 7 10 7a18.6 18.6 0 0 1-2.16 3.19" />
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

export function PlusIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function LockIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="4" y="11" width="16" height="10" rx="1" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function UnlockIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="4" y="11" width="16" height="10" rx="1" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
    </svg>
  );
}

export function CopyIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="9" y="9" width="11" height="11" rx="1" />
      <path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </svg>
  );
}

export function XIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

export function SearchIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

export function CheckIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <polyline points="4 12 10 18 20 6" />
    </svg>
  );
}

export function TrashIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
    </svg>
  );
}

export function PencilIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

export function ExternalIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export function ShieldIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z" />
    </svg>
  );
}

export function KeyIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9" />
      <path d="M16 5l3 3" />
      <path d="M13 8l3 3" />
    </svg>
  );
}

export function DatabaseIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  );
}

export function GridIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function ChartIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M4 20V10" />
      <path d="M11 20V4" />
      <path d="M18 20v-7" />
    </svg>
  );
}

export function UserIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </svg>
  );
}

export function SettingsIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z" />
    </svg>
  );
}

export function NoteIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M17 3a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      <path d="M15 5l3 3" />
    </svg>
  );
}

export function CardIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

function BrandBadge({
  size,
  bg,
  children,
}: {
  size: number;
  bg: string;
  children: ReactNode;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable={false}>
      <rect width="24" height="24" rx="4" fill={bg} />
      {children}
    </svg>
  );
}

export function VisaIcon({ size = 16 }: { size?: number }) {
  return (
    <BrandBadge size={size} bg="#1A1F71">
      <text x="12" y="15.5" textAnchor="middle" fontSize="7" fontStyle="italic" fontWeight="700" fill="#fff">
        VISA
      </text>
    </BrandBadge>
  );
}

export function MastercardIcon({ size = 16 }: { size?: number }) {
  return (
    <BrandBadge size={size} bg="#16181d">
      <circle cx="9.5" cy="12" r="5.5" fill="#EB001B" />
      <circle cx="14.5" cy="12" r="5.5" fill="#F79E1B" fillOpacity="0.9" />
    </BrandBadge>
  );
}

export function AmexIcon({ size = 16 }: { size?: number }) {
  return (
    <BrandBadge size={size} bg="#006FCF">
      <text x="12" y="15" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#fff">
        AMEX
      </text>
    </BrandBadge>
  );
}

export function DiscoverIcon({ size = 16 }: { size?: number }) {
  return (
    <BrandBadge size={size} bg="#1b1b1b">
      <circle cx="17" cy="14" r="6" fill="#FF6000" />
      <text x="10" y="15" textAnchor="middle" fontSize="6" fontWeight="700" fill="#fff">
        DISC
      </text>
    </BrandBadge>
  );
}

export function ImageIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

export function CardBrandIcon({ bin, size = 16 }: { bin?: string | null; size?: number }) {
  switch (cardBrand(bin)) {
    case "visa":
      return <VisaIcon size={size} />;
    case "mastercard":
      return <MastercardIcon size={size} />;
    case "amex":
      return <AmexIcon size={size} />;
    case "discover":
      return <DiscoverIcon size={size} />;
    default:
      return <CardIcon size={size} />;
  }
}
