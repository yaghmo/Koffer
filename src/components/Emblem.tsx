interface Props {
  size?: number;
}

/** The Koffer mark: a locked case. White body, yellow handle, red keyhole.
 *  It is drawn for the jacket's black; on white the body would vanish. The
 *  same three paths as design/icons.cjs and the extension's popup and bar. */
export function Emblem({ size = 48 }: Props) {
  return (
    <svg
      className="shrink-0"
      width={size}
      height={size}
      viewBox="16 16 224 224"
      aria-hidden
      focusable={false}
    >
      <path
        fill="var(--color-tape)"
        fillRule="evenodd"
        d="M88 96V64a24 24 0 0 1 24-24h32a24 24 0 0 1 24 24V96ZM108 96V66a6 6 0 0 1 6-6h28a6 6 0 0 1 6 6V96Z"
      />
      <path
        fill="var(--color-shirt)"
        fillRule="evenodd"
        d="M54 92H202a26 26 0 0 1 26 26V190a26 26 0 0 1-26 26H54a26 26 0 0 1-26-26V118a26 26 0 0 1 26-26ZM60 92h10v124h-10ZM186 92h10v124h-10Z"
      />
      <path fill="var(--color-primary)" d="M128 118a20 20 0 0 1 11.8 36.2L146 192H110l6.2-37.8A20 20 0 0 1 128 118Z" />
    </svg>
  );
}
