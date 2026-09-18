# Vault cloud backup

An offsite copy of your encrypted vault, stored in **your own** Cloudflare
account. Nothing here talks to us, and we operate no server.

## What this is, and what it is not

- **It is a copy, not a sync.** The vault uploads one way, when it locks after
  a change. Editing the same vault on two machines is not supported — they
  would overwrite each other.
- **It is your Cloudflare account.** We can see nothing. The free tier covers
  this many times over: a backup costs 2 of the 1,000,000 monthly Class A
  operations, and vault files are kilobytes against 10 GB of storage.
- **Your master password is still required.** A restored vault opens only with
  it. This is a backup, not account recovery — it does not help with a
  forgotten password. That is what your recovery code is for.
- **Keep the GET token, and keep it safe.** It is shown once during setup, and
  it is the only way to download a backup. Store it with your recovery code.
  Lose it and the backup cannot be retrieved.
- **The token on your device cannot read the backup.** The app stores only the
  PUT token, which can upload but not download. That is why there are two.
- **A strong master password matters more once backup is on.** A downloaded
  copy can be attacked offline, at the attacker's own pace, without your
  machine.
- **History is kept 30 days. The latest copy never expires.**

## Setup

You need a Cloudflare account. Both paths below produce the same thing.

### Generate the two tokens

Run this twice, once for each token, and keep both somewhere safe for now:

```bash
openssl rand -base64 32
```

### Path A — command line

```bash
cd worker
npx wrangler r2 bucket create vault-backup
npx wrangler r2 bucket lifecycle add vault-backup expire-history history/ --expire-days 30
npx wrangler secret put PUT_TOKEN   # paste the first token
npx wrangler secret put GET_TOKEN   # paste the second token
npx wrangler deploy
```

`wrangler deploy` prints the Worker URL. It looks like
`https://vault-backup.<your-subdomain>.workers.dev`.

### Path B — Cloudflare dashboard

1. **R2 → Create bucket**, name it `vault-backup`.
2. In that bucket, **Settings → Object lifecycle rules → Add rule**: prefix
   `history/`, delete objects 30 days after creation.
3. **Workers & Pages → Create → Worker**, name it `vault-backup`, deploy the
   starter, then **Edit code** and paste the contents of `backup.js`.
4. **Settings → Bindings → Add → R2 bucket**: variable name `VAULT_BUCKET`,
   bucket `vault-backup`.
5. **Settings → Variables and Secrets**: add `PUT_TOKEN` and `GET_TOKEN` as
   **Secret** (not plaintext), pasting the tokens you generated.
6. Copy the Worker URL from the Worker's overview page.

### Finish in the app

Open **Settings → Cloud backup**, paste the Worker URL and the **PUT** token,
and save. Store the **GET** token with your recovery code — the app never keeps
it.

## Restoring

On a machine with no vault, choose **Restore from cloud** on the lock screen,
then enter the Worker URL and the **GET** token. The vault downloads as a new
entry beside any existing one, so nothing is overwritten, and you unlock it
with your master password as usual.

## API

| Route | Auth | Behaviour |
|---|---|---|
| `PUT /vault` | `Bearer <PUT_TOKEN>` | Writes `latest/vault.bin` and `history/<unix-ms>.bin`. 204 on success. |
| `GET /vault` | `Bearer <GET_TOKEN>` | Returns `latest/vault.bin`, or 404 when absent. |

Bad or missing token: 401. Body over 25 MB: 413. Empty body: 400. Any other
path: 404. Any other method: 405.

## Tests

```bash
node --test worker/
```

Requires Node 20+.
