interface Props {
  size?: number;
  glow?: boolean;
}

export function Emblem({ size = 48, glow = false }: Props) {
  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {glow && (
        <span
          aria-hidden
          className="absolute inset-[-30%] -z-10 rounded-full blur-xl"
          style={{ background: "rgba(128,131,255,.28)" }}
        />
      )}
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden focusable={false}>
        <defs>
          <linearGradient id="emblem-stroke" x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#c0c1ff" />
            <stop offset="1" stopColor="#4cd7f6" />
          </linearGradient>
        </defs>
        <path
          d="M32 4 54 14v16c0 16-9.5 26-22 30C19.5 56 10 46 10 30V14z"
          stroke="url(#emblem-stroke)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="30" r="18" stroke="#464554" strokeWidth="1" strokeDasharray="3 4" />
        <circle cx="32" cy="27" r="5" stroke="url(#emblem-stroke)" strokeWidth="2" />
        <path d="M32 32v7" stroke="url(#emblem-stroke)" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}
