# Browser extension

Detects login forms as you browse, badges the toolbar icon, and fills the
page from the vault when you pick an item.

## Load it

1. `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → select this folder.
3. In the vault app: **Settings → Browser extension → Pair a browser**.
4. Click the extension's toolbar icon and type the code it shows.

Edge, Brave, Opera and Vivaldi are the same steps — same MV3, same APIs.

### Firefox

`about:debugging` → **This Firefox** → **Load Temporary Add-on** → pick
`manifest.json`. Then pair exactly as above.

Two things differ, and both are handled:

- Firefox has no background service worker, so the manifest declares
  `background.scripts` next to `background.service_worker`. Each browser
  reads its own key. Chrome logs a warning about `scripts` needing manifest
  v2 and then loads the extension anyway — that warning is expected.
- Firefox treats `host_permissions` as *optional*, so the fetch to
  `127.0.0.1` is blocked until the user agrees. Pairing asks for it on the
  click, which is the only moment the prompt is allowed.

Safari needs an Xcode conversion and a macOS host app, and the vault itself
is Windows-only, so it is not on the list.

## What is here

| File | Does |
| --- | --- |
| `manifest.json` | MV3 manifest, Chromium and Firefox from one file. |
| `autofill.js` | Dependency-free DOM library: `detect`, `isLogin`, `fill`. No browser APIs, so it is unit-tested in `src/__tests__/autofillDetect.test.ts`. |
| `content.js` | Runs `autofill.js` on every page, reports the verdict, fills on request, and holds the password for the second step of a two-step login. |
| `background.js` | Service worker. Per-tab badge, and the right-click menu. |
| `popup.js` / `popup.html` | Where a fill is normally started. |
| `vault.js` | The one seam that talks to the desktop app. |
| `demo.html` | Open directly in a browser to exercise `autofill.js` by hand. |

## How it reaches the vault

The app listens on `127.0.0.1:38471` and answers nothing useful until a
human pairs this extension: the app shows an eight-character code, you type it in here once, and this browser generates a
key pair and sends the app the public half. Four rules hold it up, and
`src-tauri/src/bridge.rs` is where they are enforced:

- **Loopback only.** It binds `127.0.0.1`, never `0.0.0.0`.
- **A human pairs it.** No other process on the machine can read a code off
  your screen, so no other process can pair itself. The code lasts three
  minutes, works once, and dies after three wrong guesses.
- **There is no token.** This browser signs what it sends. Pairing generates
  a P-256 key pair with `extractable: false`; the private half stays in
  IndexedDB as a `CryptoKey` that WebCrypto will not turn back into bytes for
  anyone, `vault.js` included, and the app keeps only the public point. Every
  request carries a signature over its path, a timestamp and a hash of its
  body, so a signature proves one call and is worth nothing on another or a
  minute later.

  That is not the same as unstealable: Chrome writes non-extractable key
  material into the profile like everything else, and a program that parses
  that format can recover it. What it removes is the string you could copy
  out of `chrome.storage.local` in one line, and everything a captured
  request used to be worth.
- **Keys age out.** The app decides when one is stale and says so on the next
  reply; this browser answers with `/rekey`, sending a new public point
  signed by the old key — which is only possible because the key is
  asymmetric. Unused for a week, a key stops working and you pair again.
- **The key list lives in the vault.** Unreadable the moment the vault locks,
  which is exactly when the extension should stop being able to ask for
  anything. Because a locked vault cannot tell a real extension from a
  stranger, every route answers both the same way (`401`), and the popup says
  "locked, or not paired any more" rather than guessing. Anything more
  specific would be a free "is the vault open right now?" signal for every
  process on the machine.
- **Pairing lets a browser ask, not read.** The first time it wants a
  password for a site, the app comes forward and asks you; the call that
  triggered it is refused either way. Until then the account list for that
  site comes back as a count and nothing else. Approved sites are listed
  under **Settings → Browser extension** and can be taken back one at a time.
- **Rust decides what an origin may see.** This extension says which origin
  it is acting for; the app filters every lookup by it. Naming an item id is
  not enough — the origin has to own it. A bug up here cannot turn into one
  site's password being handed to another.

No response carries an `Access-Control-Allow-Origin` header and every
request must arrive with a `chrome-extension://` `Origin`, so a web page
that guesses the port still cannot read a thing.

Unpair from **Settings → Browser extension**; that drops the public key
immediately, so whatever the browser still has stored signs nothing.

A field the filler cannot name — a PIN, a CVV, a second form on the page —
has a **Copy** button beside each account instead. That routes through the
app: the app puts the value on the clipboard and clears it a minute later,
and the reply says only that it happened. The plaintext never reaches the
extension, which is why this is offered rather than showing the password in
the popup, where it would sit in the DOM until the popup closed.

A fill deliberately does **not** extend the unlocked session. If it did,
anything holding a token could poll the bridge and keep the vault open for
ever. When a fill lands close to the auto-lock, the app comes forward and
asks whether to stay unlocked — only an answer there extends it.

## What this does not defend against

- **A local process running as you.** The signing key is non-extractable to
  JavaScript, not to a program reading the browser profile off disk. Doing it
  that way is real work rather than a `grep`, and the key is replaced hourly,
  but a determined local attacker gets there. It also needs the vault
  unlocked, and unpairing kills it. This is a deliberate trade for one-click
  autofill.
- **Counting what the vault holds.** An unapproved site gets a number and no
  accounts, so names and usernames stay in the vault — but walking a list of
  domains still tells the walker which ones you have logins for. Dropping the
  count as well would leave the badge and the menu blank on every new site,
  so the only way to find out would be to go and approve it, which trains
  people to approve sites they have not looked at.
- **A forged `Origin` header.** Browsers will not let a page forge it, so
  pages really are shut out — but any local process can set it to anything.
  The pairing code and the token are what actually hold the door.

## Windows with no toolbar

"Sign in with Google" usually opens a `window.open` popup: a real browser
window with no toolbar, so there is no extension icon to click. The content
script still runs there and still detects the form — the *UI* is what is
missing, in exactly the window that needs it.

So the accounts for that page are also on the **right-click menu** of any
text field, under "Password Manager". Same rules as the popup: only
fillable accounts are clickable, and a provider login appears greyed out
naming the account you used.

Context menus are global rather than per-tab, so the menu is redrawn
whenever the front tab changes — including on a *window* switch, which
`tabs.onActivated` does not report. They also do not survive the service
worker being killed and nothing re-creates them on its own, so the menu is
rebuilt whenever `background.js` is evaluated, which is every revival. Before
that, a menu on a page that never mutates again — an OAuth popup waiting for
you — simply vanished until the page was reloaded.

If a stale menu ever does get through, it is safe rather than merely
unlikely: the origin the menu was built for travels with the fill, and the
content script drops it when it no longer matches the page it is running in.

On a site this browser has not been approved for, the menu offers to raise
the approval dialog instead of listing accounts. Answering it happens in the
app, which has no way to tell the extension, so the extension watches for the
answer and redraws itself; it also asks the app first whether the question is
already settled, rather than putting the same dialog up twice.

## Two-step logins

Google and Microsoft ask for the identifier first and the password on a
second screen. The popup has closed by the time that screen exists, so
`content.js` keeps the password — in the isolated world, which the page's
own scripts cannot read — and writes it when a password box appears. It
lets go on the first successful write, after a minute, when the origin
changes, and when the page goes away.

If the second step arrives as a full page load rather than in the same
document, this script is torn down and the value goes with it. Fill that
page from the popup like any other.

## Why the popup, and not an automatic fill

Detection badges a tab. It never fills. A password is written into a page
only when someone clicks the item they want, on the origin shown directly
above it in the popup. A page that can make the extension type a password
without that click is the whole attack, so the click is the feature.
