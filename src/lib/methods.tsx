import type { LoginMethod } from "./types";

export const methods: { id: LoginMethod; label: string }[] = [
  { id: "credentials", label: "Username & Password" },
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "microsoft", label: "Microsoft" },
  { id: "apple", label: "Apple" },
  { id: "facebook", label: "Facebook" },
];

export const methodLabel = (m: LoginMethod): string =>
  methods.find((x) => x.id === m)?.label ?? "Login";

/** Brand chip: letter monogram per provider, colored. Microsoft = 4 squares. */
export function MethodChip({
  method,
  size = 18,
}: {
  method: LoginMethod;
  size?: number;
}) {
  const style = { width: size, height: size, fontSize: size * 0.55 };
  switch (method) {
    case "google":
      return (
        <span className="chip chip-google" style={style} aria-hidden>
          G
        </span>
      );
    case "github":
      return (
        <span className="chip chip-github" style={style} aria-hidden>
          G
        </span>
      );
    case "microsoft":
      return (
        <span className="chip chip-microsoft" style={style} aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </span>
      );
    case "apple":
      return (
        <span className="chip chip-apple" style={style} aria-hidden>
          A
        </span>
      );
    case "facebook":
      return (
        <span className="chip chip-facebook" style={style} aria-hidden>
          f
        </span>
      );
    default:
      return (
        <span className="chip chip-credentials" style={style} aria-hidden>
          ⌂
        </span>
      );
  }
}