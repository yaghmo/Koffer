// @vitest-environment node
// Node's own WebCrypto: jsdom has no `crypto.subtle`.
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The sealed channel, checked against `src-tauri/src/channel.rs`: the keys
 * and the sealed answer below were made there, from the same fixed scalars
 * (`print` them again with its `pair(7)` and `pair(9)`). If either side
 * changes how the key is derived or what the tag covers, this stops opening.
 */
const EXT_PRIVATE = "01".repeat(31) + "07";
const EXT_PUBLIC =
  "040b3d58ffeeb0525da579bcc33edb4e1e0036f8e2afc63aac57bcf511efd8531fcfbe93c3b1fc2e116ef69aa81b2759882abded7df14a3c385a9e357223cf9e44";
const APP_PUBLIC =
  "043bdcec9d7a22b83dc27a05af5e597eb414a9f479d508fdd7f66c5b3e998a414127698c9488d312e20fbe9945ba551a50fdc073511edf00c738f1d1bffd5747ae";
const KEY = "93fb5037245bc7b7a4a656559e7f703b899856bc263e8b034eca6dbba6a12cf3";
const APP_REPLY = { c: "gXYhmFMQC8hA7cAjJ/BeW99c99T0Byhe4z1SWw==", n: "b6cb16b8e631b976141df6e3" };

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const b64url = (hex: string) =>
  btoa(String.fromCharCode(...bytes(hex))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let channelKey: (priv: CryptoKey, appPublicHex: string) => Promise<CryptoKey>;
let seal: (key: CryptoKey, path: string, text: string) => Promise<string>;
let open: (key: CryptoKey, path: string, body: unknown) => Promise<string>;
let key: CryptoKey;

beforeAll(async () => {
  // @ts-expect-error untyped extension source
  ({ channelKey, seal, open } = await import("../../extension/vault.js"));
  const priv = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: b64url(EXT_PRIVATE), x: b64url(EXT_PUBLIC.slice(2, 66)), y: b64url(EXT_PUBLIC.slice(66)) },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  key = await channelKey(priv, APP_PUBLIC);
});

describe("the sealed channel", () => {
  it("reaches the key the app reached, and keeps it unexportable", async () => {
    expect(key.extractable).toBe(false);
    // Same key: what the app sealed under its copy opens under this one.
    expect(await open(key, "/matches", APP_REPLY)).toBe('{"items":[]}');
  });

  it("seals a request so a listener sees none of it", async () => {
    const sealed = await seal(key, "/offer", '{"password":"hunter2"}');
    expect(sealed).not.toContain("hunter2");
    // The app's side, with the raw key: its `open` for a request.
    const { n, c } = JSON.parse(sealed);
    const raw = await crypto.subtle.importKey("raw", bytes(KEY), "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes(n), additionalData: new TextEncoder().encode("/offer\nrequest") },
      raw,
      Uint8Array.from(atob(c), (ch) => ch.charCodeAt(0)),
    );
    expect(new TextDecoder().decode(plain)).toBe('{"password":"hunter2"}');
  });

  it("takes no answer the app did not seal for that call", async () => {
    // In the clear, as a program squatting the port would answer.
    await expect(open(key, "/matches", { items: [] })).rejects.toThrow();
    // Sealed, but for another route.
    await expect(open(key, "/credentials", APP_REPLY)).rejects.toThrow();
    // The browser's own request handed back as the answer.
    const own = JSON.parse(await seal(key, "/matches", "{}"));
    await expect(open(key, "/matches", own)).rejects.toThrow();
  });
});
