/** Finding the page's "Sign in with ..." button, never a footer link. */
import { beforeAll, describe, expect, it } from "vitest";
import "../../extension/autofill.js";

const Autofill = (window as unknown as { Autofill: { providerButton: (s: Document, m: string) => HTMLElement | null } })
  .Autofill;

beforeAll(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const hidden = window.getComputedStyle(this).display === "none";
    return { width: hidden ? 0 : 100, height: hidden ? 0 : 20, top: 0, left: 0, right: 100, bottom: 20 } as DOMRect;
  };
});

const PAGE = `
  <button id="g"><svg aria-label="Google logo"></svg>Continue with Google</button>
  <button id="gh">Sign in with GitHub</button>
  <a id="ms" href="#oauth">Log in with Microsoft</a>
  <div><button id="ap">Apple</button><button id="fb">Facebook</button></div>
  <footer><a id="f1" href="https://github.com/acme">Follow us on GitHub</a><a id="f2" href="#">Share on Facebook</a></footer>`;

describe("providerButton", () => {
  it("finds each provider's sign-in button and skips the decoys", () => {
    document.body.innerHTML = PAGE;
    const found = (m: string) => Autofill.providerButton(document, m)?.id ?? null;
    expect(found("google")).toBe("g");
    expect(found("github")).toBe("gh");
    expect(found("microsoft")).toBe("ms");
    expect(found("apple")).toBe("ap");
    expect(found("facebook")).toBe("fb");
    expect(found("other")).toBe(null);
  });

  it("finds nothing when only a decoy is on the page, or the button is hidden", () => {
    document.body.innerHTML = '<a href="https://github.com/acme">Follow us on GitHub</a><button style="display:none">Sign in with GitHub</button>';
    expect(Autofill.providerButton(document, "github")).toBe(null);
  });

  it("takes the button over a wrapper that names every provider", () => {
    document.body.innerHTML = '<div role="button" id="all">Sign in with Google or GitHub <button id="gh">GitHub</button></div>';
    expect(Autofill.providerButton(document, "github")?.id).toBe("gh");
  });
});
