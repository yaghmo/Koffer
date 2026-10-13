/**
 * Master-password strength, using the same rule the vault health screen
 * applies to stored logins: under 8 characters, or fewer than 3 character
 * classes, is weak. Length beyond that is what actually buys resistance to
 * an offline guess, so it carries most of the score.
 */
export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** Text colour token for the label. */
  className: string;
  hint: string;
}

export function charClasses(pw: string): number {
  return [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
}

export function passwordStrength(pw: string): Strength {
  const classes = charClasses(pw);
  if (pw.length === 0) {
    return { score: 0, label: "", className: "text-on-surface-variant", hint: "" };
  }
  if (pw.length < 8) {
    return {
      score: 0,
      label: "Too short",
      className: "text-error",
      hint: "At least 8 characters. A passphrase of a few words beats a short scramble.",
    };
  }
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (classes >= 3) score++;
  if (classes === 4 && pw.length >= 12) score++;
  score = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;

  const hint =
    classes < 3
      ? "Mix in upper case, digits or symbols. This counts as weak in vault health."
      : pw.length < 12
        ? "Longer is stronger: 12+ characters makes offline guessing far harder."
        : pw.length < 16
          ? "Good. 16+ characters would make it stronger still."
          : "Long and mixed. This is the one password worth over-building.";

  const labels: Record<number, { label: string; className: string }> = {
    0: { label: "Very weak", className: "text-error" },
    1: { label: "Weak", className: "text-error" },
    2: { label: "Fair", className: "text-on-surface" },
    3: { label: "Good", className: "text-on-surface" },
    4: { label: "Strong", className: "text-on-surface" },
  };
  return { score: score as 0 | 1 | 2 | 3 | 4, ...labels[score], hint };
}
