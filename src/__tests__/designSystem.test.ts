import { describe, expect, it } from "vitest";
import css from "../styles.css?raw";

// Every component and screen, as text. Tests are left out: they quote the
// old strings they guard against.
const sources = import.meta.glob<string>(["../**/*.tsx", "!../__tests__/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function token(name: string): string {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i"));
  if (!m) throw new Error(`no --color-${name} in styles.css`);
  return m[1].toLowerCase();
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every match of `pattern` in app source as "file: match". Comments are
 *  stripped first: the rules are about what ships, not what explains it. */
export function offenders(pattern: RegExp, skip: string[] = []): string[] {
  const out: string[] = [];
  for (const [file, text] of Object.entries(sources)) {
    if (skip.some((s) => file.endsWith(s))) continue;
    const code = text
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\s\/\/ .*$/gm, "");
    for (const m of code.matchAll(pattern)) out.push(`${file}: ${m[0]}`);
  }
  return out;
}

describe("design system: palette", () => {
  it("uses the DESIGN.md colours", () => {
    expect(token("surface")).toBe("#ffffff");
    expect(token("on-surface")).toBe("#141414");
    expect(token("on-surface-variant")).toBe("#6b6b6b");
    expect(token("outline-variant")).toBe("#e4e4e2");
    expect(token("primary")).toBe("#c8102e");
    expect(token("jacket")).toBe("#121212");
    expect(token("tape")).toBe("#ffd60a");
  });

  it("keeps every text pair at 4.5:1 or better", () => {
    const pairs: [string, string][] = [
      ["on-surface", "surface"],
      ["on-surface-variant", "surface"],
      ["on-surface-variant", "surface-container-high"],
      ["outline", "surface"],
      ["on-primary", "primary"],
      ["on-primary", "primary-container"],
      ["error", "surface"],
      ["on-error-container", "error-container"],
      ["on-tape", "tape"],
      ["on-jacket", "jacket"],
      ["on-jacket-muted", "jacket"],
      ["ink", "shirt"],
    ];
    for (const [fg, bg] of pairs) {
      expect(contrast(token(fg), token(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is flat: no glow and no glass in the stylesheet", () => {
    expect(css).not.toMatch(/backdrop-blur|backdrop-filter/);
    expect(css).not.toMatch(/box-shadow:\s*0 0 [1-9]\d+px/);
    expect(css).not.toMatch(/Plus Jakarta|JetBrains/);
  });
});
