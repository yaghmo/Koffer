interface Props {
  size?: number;
}

/** The Koffer mark: a locked case on a white tile. Black body, yellow
 *  handle, red keyhole. The tile is part of the mark, so it reads the same
 *  on the jacket's black as on the shirt. The same paths as design/icons.cjs
 *  and the extension's popup and bar. */
export function Emblem({ size = 48 }: Props) {
  return (
    <svg className="shrink-0" width={size} height={size} viewBox="0 0 256 256" aria-hidden focusable={false}>
      <rect width="256" height="256" rx="56" fill="var(--color-shirt)" />
      <g transform="translate(128 128) scale(.8) translate(-128 -128)">
        <path
          fill="var(--color-tape)"
          fillRule="evenodd"
          d="M88 96V64a24 24 0 0 1 24-24h32a24 24 0 0 1 24 24V96ZM108 96V66a6 6 0 0 1 6-6h28a6 6 0 0 1 6 6V96Z"
        />
        <path
          fill="var(--color-ink)"
          fillRule="evenodd"
          d="M54 92H202a26 26 0 0 1 26 26V190a26 26 0 0 1-26 26H54a26 26 0 0 1-26-26V118a26 26 0 0 1 26-26ZM60 92h10v124h-10ZM186 92h10v124h-10Z"
        />
        <path fill="var(--color-primary)" d="M128 118a20 20 0 0 1 11.8 36.2L146 192H110l6.2-37.8A20 20 0 0 1 128 118Z" />
      </g>
    </svg>
  );
}
