interface Props {
  size?: number;
  glow?: boolean;
}

const CASE = "#acedff"; // tertiary-fixed, Obsidian Cipher
const KEY = "#4edea3"; // --color-secondary
const KEYHOLE = "M437 309a24 24 0 0 1 15 43l9 37h-48l9-37a24 24 0 0 1 15-43z";

/** The Koffer logo, traced from design/logo.png (see design/icons.cjs).
 *  Below 40 px the double lines blur together, so it drops to one line. */
export function Emblem({ size = 48, glow = false }: Props) {
  const detail = size >= 40;
  const stroke = detail ? 14 : 30;
  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {glow && (
        <span
          aria-hidden
          className="absolute inset-[-30%] -z-10 rounded-full blur-xl"
          style={{ background: "rgba(78,222,163,.2)" }}
        />
      )}
      <svg
        width={size}
        height={size}
        viewBox="233 195 560 560"
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
        aria-hidden
        focusable={false}
      >
        <defs>
          <mask id={`emblem-cut-${size}`} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
            <rect width="1024" height="1024" fill="#fff" />
            <circle cx="437" cy="350" r={66 + stroke * 2} fill="#000" />
          </mask>
        </defs>
        <g stroke={CASE} strokeWidth={stroke} mask={`url(#emblem-cut-${size})`}>
          <rect x="251" y="313" width="524" height="398" rx="44" />
          {detail ? (
            <>
              <rect x="268" y="330" width="490" height="364" rx="30" />
              <path d="M338 330V694M352 330V694M673 330V694M687 330V694" />
            </>
          ) : (
            <path d="M352 313V711M673 313V711" />
          )}
        </g>
        <path
          stroke={CASE}
          strokeWidth={stroke}
          d={detail ? "M455 494L597 384L622 384L512 487L638 634L582 634L492 510L455 536" : "M445 520L610 384M500 474L630 634"}
        />
        <g stroke={KEY} strokeWidth={stroke}>
          <path d="M428 262V252Q428 234 446 234H582Q600 234 600 252V296" />
          <circle cx="437" cy="350" r="66" />
          <path d={KEYHOLE} fill={detail ? undefined : KEY} />
          <path
            d={
              detail
                ? "M422 414V640L437 660L452 640V632H470V614H452V600H486V584H466V572H486V556H452V414"
                : "M437 416V650M437 574H482M437 622H472"
            }
          />
        </g>
      </svg>
    </span>
  );
}
