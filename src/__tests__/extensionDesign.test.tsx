import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import popupHtml from "../../extension/popup.html?raw";
import popupJs from "../../extension/popup.js?raw";
import barJs from "../../extension/bar.js?raw";
import backgroundJs from "../../extension/background.js?raw";
// @ts-expect-error plain JS module of the extension, no types
import { mark } from "../../extension/marks.js";
import { Emblem } from "../components/Emblem";
import { MethodChip } from "../lib/methods";

// DESIGN.md's Midnight palette. Nothing else may be written into the popup
// or the in-page bar.
const PALETTE = new Set([
  "#0b0d10",
  "#1d2228",
  "#0f1216",
  "#0c0f13",
  "#14181d",
  "#1b2027",
  "#252b33",
  "#232931",
  "#e8ebef",
  "#9ba3ae",
  "#838b97",
  "#3dbe8b",
  "#5acf9f",
  "#04140d",
  "#f06a6f",
]);

const hexes = (src: string) => [...src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

describe("extension: Midnight", () => {
  it("draws the popup and the in-page bar from the palette only", () => {
    for (const [name, src] of [
      ["popup.html", popupHtml],
      ["bar.js", barJs],
    ] as const) {
      expect(hexes(src).filter((h) => !PALETTE.has(h)), name).toEqual([]);
      expect(src, name).not.toMatch(/rgba\(|gradient|blur\(|animation:/);
    }
  });

  it("marks a detected login on the toolbar in emerald", () => {
    expect(backgroundJs).toMatch(/BADGE_COLOUR = "#3dbe8b"/);
  });

  it("uses no dash as punctuation in what it says", () => {
    for (const [name, src] of [
      ["popup.js", popupJs],
      ["bar.js", barJs],
      ["background.js", backgroundJs],
    ] as const) {
      expect(code(src).match(/[—–]| -- | · /g) ?? [], name).toEqual([]);
    }
  });

  it("never answers with a bare OK", () => {
    expect(barJs).not.toMatch(/"OK"/);
  });

  it("draws monochrome provider marks in the text colour, so they show on the dark popup", () => {
    for (const name of ["github", "apple"]) {
      expect(mark(name).querySelector("path")?.getAttribute("fill"), name).toBe("currentColor");
    }
  });
});

describe("the mark", () => {
  it("is a light case with a slate handle and an emerald keyhole", () => {
    const { container } = render(<Emblem size={28} />);
    const fills = [...container.querySelectorAll("path")].map((p) => p.getAttribute("fill"));
    expect(fills).toEqual(["var(--color-on-canvas-muted)", "var(--color-on-canvas)", "var(--color-primary)"]);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("28");
  });
});

describe("provider marks in the app", () => {
  it("take the text colour, so GitHub and Apple show on the dark page", () => {
    for (const method of ["github", "apple"] as const) {
      const { container } = render(<MethodChip method={method} size={20} />);
      expect(container.querySelector("path")?.getAttribute("fill"), method).toBe("currentColor");
    }
  });
});
