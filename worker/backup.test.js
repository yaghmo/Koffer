import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./backup.js";

const PUT_TOKEN = "put-secret";
/** What a vault file looks like to the Worker: it starts "PM01". */
const VAULT = "PM01ciphertext";
const GET_TOKEN = "get-secret";

/** Minimal in-memory stand-in for the R2 binding. */
function fakeBucket() {
  const objects = new Map();
  return {
    objects,
    meta: new Map(),
    async put(key, value, options) {
      objects.set(key, value);
      this.meta.set(key, options?.customMetadata || {});
    },
    async get(key) {
      if (!objects.has(key)) return null;
      return { body: objects.get(key) };
    },
    async head(key) {
      if (!objects.has(key)) return null;
      return { customMetadata: this.meta.get(key) };
    },
  };
}

function env(bucket) {
  return { PUT_TOKEN, GET_TOKEN, VAULT_BUCKET: bucket };
}

function req(method, token, body) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return new Request("https://example.com/vault", { method, headers, body });
}

test("PUT without a token is rejected", async () => {
  const res = await worker.fetch(req("PUT", null, "x"), env(fakeBucket()));
  assert.equal(res.status, 401);
});

test("PUT with the wrong token is rejected", async () => {
  const res = await worker.fetch(req("PUT", "nope", "x"), env(fakeBucket()));
  assert.equal(res.status, 401);
});

test("the GET token does not authorize a PUT", async () => {
  const res = await worker.fetch(req("PUT", GET_TOKEN, "x"), env(fakeBucket()));
  assert.equal(res.status, 401);
});

test("the PUT token does not authorize a GET", async () => {
  const res = await worker.fetch(req("GET", PUT_TOKEN), env(fakeBucket()));
  assert.equal(res.status, 401);
});

test("PUT writes both the latest and a history copy", async () => {
  const bucket = fakeBucket();
  const res = await worker.fetch(req("PUT", PUT_TOKEN, VAULT), env(bucket));
  assert.equal(res.status, 204);
  assert.ok(bucket.objects.has("latest/vault.bin"));
  const history = [...bucket.objects.keys()].filter((k) => k.startsWith("history/"));
  assert.equal(history.length, 1);
});

test("a body that is not a vault file is rejected before any write", async () => {
  const bucket = fakeBucket();
  const res = await worker.fetch(req("PUT", PUT_TOKEN, "not a vault"), env(bucket));
  assert.equal(res.status, 400);
  assert.equal(bucket.objects.size, 0);
});

test("history keeps one copy per ten minutes; the latest is always replaced", async () => {
  const bucket = fakeBucket();
  for (const n of [1, 2, 3]) {
    const res = await worker.fetch(req("PUT", PUT_TOKEN, `${VAULT}${n}`), env(bucket));
    assert.equal(res.status, 204);
  }
  const history = [...bucket.objects.keys()].filter((k) => k.startsWith("history/"));
  assert.equal(history.length, 1);
  assert.equal(bucket.objects.get("latest/vault.bin").byteLength, `${VAULT}3`.length);
});

test("an empty body is rejected", async () => {
  const res = await worker.fetch(req("PUT", PUT_TOKEN, ""), env(fakeBucket()));
  assert.equal(res.status, 400);
});

test("an oversized body is rejected before any write", async () => {
  const bucket = fakeBucket();
  const big = "a".repeat(25 * 1024 * 1024 + 1);
  const res = await worker.fetch(req("PUT", PUT_TOKEN, big), env(bucket));
  assert.equal(res.status, 413);
  assert.equal(bucket.objects.size, 0);
});

test("GET returns the latest copy", async () => {
  const bucket = fakeBucket();
  await worker.fetch(req("PUT", PUT_TOKEN, VAULT), env(bucket));
  const res = await worker.fetch(req("GET", GET_TOKEN), env(bucket));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), VAULT);
});

test("GET with no backup present is a 404", async () => {
  const res = await worker.fetch(req("GET", GET_TOKEN), env(fakeBucket()));
  assert.equal(res.status, 404);
});

test("an unknown path is a 404", async () => {
  const r = new Request("https://example.com/other", { method: "GET" });
  const res = await worker.fetch(r, env(fakeBucket()));
  assert.equal(res.status, 404);
});
