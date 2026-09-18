/**
 * Vault backup Worker. Two tokens by design: the device holds only PUT_TOKEN,
 * which cannot read the vault back, so a compromised device cannot exfiltrate
 * the ciphertext. GET_TOKEN lives with the user's recovery code.
 */

const MAX_BYTES = 25 * 1024 * 1024;
const LATEST_KEY = "latest/vault.bin";

/**
 * Compares SHA-256 digests rather than the raw strings: the digests are always
 * 32 bytes, so the loop below cannot leak the token's length by running short.
 */
async function tokenMatches(presented, expected) {
  if (typeof presented !== "string" || typeof expected !== "string") return false;
  if (presented.length === 0 || expected.length === 0) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(presented)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function bearer(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/vault") return new Response(null, { status: 404 });

    const token = bearer(request);

    if (request.method === "PUT") {
      if (!(await tokenMatches(token, env.PUT_TOKEN))) {
        return new Response(null, { status: 401 });
      }
      // Checked before reading the body so an oversized upload is refused
      // without buffering it.
      const declared = Number(request.headers.get("Content-Length") || 0);
      if (declared > MAX_BYTES) return new Response(null, { status: 413 });

      const body = new Uint8Array(await request.arrayBuffer());
      if (body.byteLength > MAX_BYTES) return new Response(null, { status: 413 });
      if (body.byteLength === 0) return new Response(null, { status: 400 });

      // Written twice: one fixed key the restore path fetches directly, and one
      // dated copy the lifecycle rule expires after 30 days.
      await env.VAULT_BUCKET.put(LATEST_KEY, body);
      await env.VAULT_BUCKET.put(`history/${Date.now()}.bin`, body);
      return new Response(null, { status: 204 });
    }

    if (request.method === "GET") {
      if (!(await tokenMatches(token, env.GET_TOKEN))) {
        return new Response(null, { status: 401 });
      }
      const object = await env.VAULT_BUCKET.get(LATEST_KEY);
      if (!object) return new Response(null, { status: 404 });
      return new Response(object.body, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      });
    }

    return new Response(null, { status: 405 });
  },
};
