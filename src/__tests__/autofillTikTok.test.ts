/**
 * The real markup of a TikTok login, trimmed of its styling.
 *
 * Kept verbatim rather than paraphrased because every guess at what this
 * form looked like was wrong in a different way, and three fixes in a row
 * missed it. What it actually does:
 *
 *  - the phone box declares `autocomplete="username webauthn"`, because to
 *    TikTok the phone number *is* the username;
 *  - nothing on it is named anything a human chose — the classes are
 *    generated and there is no `id`;
 *  - the country picker is a `<div role="button">`, not a `<select>`;
 *  - there is a real `<input type="password" tabindex="-1">` on the page,
 *    a passkey workaround, which is the only password box in the document.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import "../../extension/autofill.js";

interface Detected {
  passwords: number;
  identifier: boolean;
}
interface FillResult {
  formFound: boolean;
  filled: { field: string; value: string; matchedBy: string }[];
  missing: string[];
  mismatch: { wanted: string; shown: string } | null;
}
interface AutofillApi {
  detect: (scope?: Element | Document) => Detected;
  isLogin: (result: Detected, href: string) => boolean;
  fill: (scope: Element | Document, data: Record<string, string>) => FillResult;
}
const Autofill = (window as unknown as { Autofill: AutofillApi }).Autofill;

const TIKTOK_PHONE_TAB = `
  <div>
    <h2 id="login-modal-title">Log in</h2>
    <div>
      <div>Phone<a href="/login/phone-or-email/email">Use email or username</a></div>
      <form>
        <div>
          <div>
            <div>
              <div tabindex="0" role="button" aria-haspopup="true" aria-expanded="false"
                   aria-controls="phone-country-code-selector-wrapper"
                   aria-label="FR +33 phone country code. Double-tap for more options">
                <span>FR +33</span>
              </div>
            </div>
            <div>
              <input type="text" placeholder="Phone number"
                     autocomplete="username webauthn" name="mobile">
            </div>
          </div>
          <div><div type="error" aria-live="assertive"><span role="status">Enter a valid phone number</span></div></div>
        </div>
        <div>
          <div>
            <div class="code-input">
              <input type="text" placeholder="Enter 6-digit code">
            </div>
            <button type="button" disabled data-e2e="send-code-button">Send code</button>
          </div>
        </div>
        <input type="password" tabindex="-1">
        <div><a href="/login/phone-or-email/phone-password">Use password</a></div>
        <button type="submit" data-e2e="login-button" disabled><span>Log in</span></button>
      </form>
    </div>
  </div>`;

beforeAll(() => {
  Element.prototype.getClientRects = function (this: Element) {
    const style = window.getComputedStyle(this);
    const hidden = style.display === "none" || style.visibility === "hidden";
    return (hidden ? [] : [{ width: 100, height: 20 }]) as unknown as DOMRectList;
  };
});

beforeEach(() => {
  document.body.innerHTML = TIKTOK_PHONE_TAB;
});

function phoneBox() {
  return document.querySelector('input[name="mobile"]') as HTMLInputElement;
}

describe("TikTok's phone sign-in", () => {
  it("does not put the username in the phone box", () => {
    const out = Autofill.fill(document, { username: "brbrbatapim", password: "hunter2" });
    expect(phoneBox().value).toBe("");
    expect(out.missing).toContain("username");
  });

  it("does not put the password in the passkey input", () => {
    // `tabindex="-1"` is the page saying this is not a field anyone types
    // into. It is also the only password box in the document, so counting it
    // made this read as an ordinary sign-in form with somewhere to put the
    // password.
    Autofill.fill(document, { username: "brbrbatapim", password: "hunter2" });
    expect((document.querySelector('input[type="password"]') as HTMLInputElement).value).toBe("");
    expect(Autofill.detect(document).passwords).toBe(0);
  });

  it("leaves the one-time code box alone", () => {
    Autofill.fill(document, { username: "brbrbatapim", password: "hunter2" });
    const code = document.querySelector('.code-input input') as HTMLInputElement;
    expect(code.value).toBe("");
  });

  it("fills the national number when the page is already on that country", () => {
    // The picker is a `<div role="button">` showing "FR +33". Nothing can
    // set it, but it can be read, and it already says what we want.
    const out = Autofill.fill(document, { phone: "+33 6-12-34-56-78" });
    expect(out.missing).not.toContain("phone");
    expect(phoneBox().value).toBe("612345678");
  });

  it("refuses a number from a country the page is not set to", () => {
    // Reported: the picker stayed on +33 and "+1 555-123-4567" went into the
    // box under it. The whole number is invalid there and the national part
    // alone is somebody else's number, so neither gets written.
    const out = Autofill.fill(document, { phone: "+1 555-123-4567" });
    expect(phoneBox().value).toBe("");
    expect(out.missing).toContain("phone");
    expect(out.mismatch).toEqual({ wanted: "+1", shown: "+33" });
  });

  it("is still recognised as a login page worth offering", () => {
    // No password box and an identifier: step one of a two-step sign-in,
    // which the URL confirms.
    const seen = Autofill.detect(document);
    expect(seen.passwords).toBe(0);
    expect(seen.identifier).toBe(true);
    expect(Autofill.isLogin(seen, "https://www.tiktok.com/login/phone-or-email/phone")).toBe(true);
  });
});
