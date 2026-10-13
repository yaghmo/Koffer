---
version: alpha
name: Koffer suit and shirt
description: A black jacket, a white shirt, one red tie, and yellow tape for warnings. Flat, quiet product UI for a local password manager on Windows.

colors:
  jacket: "#121212"
  jacket-line: "#2a2a2a"
  on-jacket: "#f5f5f5"
  on-jacket-muted: "#a3a3a3"
  shirt: "#ffffff"
  shirt-soft: "#f4f4f3"
  hairline: "#e4e4e2"
  ink: "#141414"
  muted: "#6b6b6b"
  tie: "#c8102e"
  tie-pressed: "#a90d27"
  on-tie: "#ffffff"
  tape: "#ffd60a"
  on-tape: "#141414"
  scrim: "#12121280"

typography:
  title:
    fontFamily: "IBM Plex Sans, Segoe UI, sans-serif"
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.01em
  heading:
    fontFamily: "IBM Plex Sans, Segoe UI, sans-serif"
    fontSize: 19px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.01em
  body:
    fontFamily: "IBM Plex Sans, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "IBM Plex Sans, Segoe UI, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.35
  control:
    fontFamily: "IBM Plex Sans, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.2
  secret:
    fontFamily: "IBM Plex Mono, Consolas, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45

rounded:
  control: 6px
  avatar: 6px
  dialog: 10px

spacing:
  unit: 4px
  steps: "4px 8px 12px 16px 24px 32px"
  control-height: 36px
  sidebar-width: 220px
  panel-padding: 24px
---

# Koffer: suit and shirt

Status: direction chosen on 2026-10-12 and built on 2026-10-13 on the branch
`restyle/suit-and-shirt`. It replaces the dark "Obsidian Cipher" look. The
rules below are enforced by `src/__tests__/designSystem.test.ts`.

## Overview

Koffer means suitcase, so the app dresses like the person carrying one. The
sidebar is the jacket: one flat near-black panel. Everything you read and
type sits on the shirt: plain white. The tie is a single red, worn once per
screen.

The look is deliberately plain. No glow, no glass, no gradients, no second
accent colour. A password manager is opened for a few seconds to fetch one
thing; nothing on screen should compete with that thing.

## Colors

- **Jacket** (`#121212`): the sidebar on every screen, including the lock
  screen. Text on it is `on-jacket`; quieter text is `on-jacket-muted`. The
  selected entry is a white pill with ink text, the shirt showing through.
- **Shirt** (`#ffffff`): every content surface. `shirt-soft` marks the
  selected or hovered row. Panels are separated by a 1px `hairline`, never by
  a shadow or a different background.
- **Ink** (`#141414`) for text, `muted` (`#6b6b6b`) for labels and secondary
  lines. Both pass 4.5:1 on the shirt.
- **Tie** (`#c8102e`): the one accent. It fills the single primary action of
  a screen (Unlock, Save, Copy password) and colours the keyhole of the mark.
  White text on it passes 4.5:1. `tie-pressed` is its hover and active state.

- **Tape** (`#ffd60a`): crime-scene tape yellow, and the only other colour.
  It means "careful" and is never decoration. Always a fill with `on-tape`
  ink text on it; never yellow text on the shirt, where it cannot be read.
  It has three jobs in the interface, and one in the mark (its handle):
  1. A flag on a password that is leaked, reused or weak.
  2. The lock countdown in the jacket during its last 30 seconds.
  3. A 12px strip of black and yellow tape across the top of a dialog that
     destroys something (delete, reset vault, forgot password).

Red is the action and yellow is the warning, so they never trade places:

- A destructive action (Delete, Reset vault) is never a filled red button. It
  is a ghost button with tie-coloured text, and it always opens the taped
  confirm dialog, whose confirm button is filled ink and names the action.
- A form error is tie-coloured text with a sentence that names the problem
  and the way out.
- There is no green. Success is said in words, in ink.
- There is no orange and no severity scale. A warning is yellow, and the
  word on it (Leaked, Reused, Weak) says how bad it is. Black, white, red and
  yellow are the whole palette; a fifth colour needs a new job that none of
  these can do.

## Typography

IBM Plex Sans for the interface and IBM Plex Mono for anything secret or
typed exactly: passwords, codes, keys, card numbers. Plex Mono keeps `0`/`O`
and `1`/`l`/`I` apart, which is the job. Both are open (OFL-1.1) and must be
bundled with the app, never fetched.

Three weights only: 400 for reading, 500 for controls and the selected nav
entry, 600 for titles. Sentence case everywhere. No uppercase labels, no
letter-spaced captions.

## Layout

- Two columns at all times: the jacket (220px) and the shirt. The vault adds
  a list column between them, split from the detail by a hairline.
- The lock and setup screens keep the jacket in the same place, carrying
  only the mark and the name. The unlock form sits centred on the shirt, and
  choosing between vaults stays a dialog.
- Forms are one column, labels above fields. Two short fields may share a
  row.
- The window is 900 x 700 with an 820 x 600 minimum; nothing may need a wider
  window than that.

## Spacing

Every gap is a step of the 4px scale: 4, 8, 12, 16, 24, 32 (Tailwind's
`1 2 3 4 6 8`). No half steps and no one-off pixel values.

- 4px: a label to its field, a title to the line under it.
- 8px: between buttons, between an icon and its text, inside a list row.
- 12px: inside a field or button (horizontal padding), between list rows'
  contents and the hairline.
- 16px: between fields in a form, between a heading and its content.
- 24px: panel padding, and between groups of fields.
- 32px: between sections of a page such as Settings.

Things that belong together sit closer than things that do not: a group's
inner gaps are always at least one step smaller than the gap around it. A
heading has more space above it than below it.

## Elevation & Depth

Flat. The only shadow in the app belongs to things that float over the page:
dialogs and the notice line. They sit on a `scrim` and carry one soft shadow
with an offset. Nothing else is raised.

## Shapes

6px corners on buttons, fields, rows and avatars; 10px on dialogs. No pills
except the selected sidebar entry, which uses the same 6px.

## Components

- **Primary button:** filled tie, on-tie text, weight 500, 36px high. One per
  screen.
- **Ghost button:** shirt background, hairline border, ink text. Every other
  action.
- **Text link:** ink, underlined, 3px offset.
- **Field:** shirt background, hairline border, 6px corners. Focus is a 2px
  ink ring set off by 2px of shirt; on the jacket the ring is `on-jacket`.
  Focus is never red.
- **List row:** square avatar with the item's logo or initial (ink on shirt
  inverted: ink square, white letter), title at 500, one muted line below.
- **Strength meter:** a 3px hairline track filled in ink, with the verdict in
  words beside it. Weak is said in tie-coloured words; the bar does not
  change colour.
- **Confirm dialog:** shirt, 10px corners, title, one paragraph, ghost cancel
  and a filled ink confirm that names the action.
- **Mark:** a locked case. White body, yellow handle, red keyhole, always on
  jacket black: in the sidebar, on a rounded black tile for the app and
  toolbar icons, and on the same tile in the browser's save bar. Never on the
  shirt, where the body would vanish. The 16px icon drops the two straps.
  Its three paths are written out in `src/components/Emblem.tsx`,
  `design/icons.cjs`, `extension/popup.html` and `extension/bar.js`.

## Browser extension

The popup and the bars the extension shows inside web pages follow this file.

- **Popup** (320px wide): a jacket strip across the top with the mark and the
  name, then two panels on the shirt split by a hairline: what the page is,
  and what the vault has for it. Logins are rows that take the soft fill on
  hover. Personal info is a card cut from the jacket, so it never reads as
  one more login. IBM Plex ships inside the extension (Latin only).
- **Save bar** (inside a page): a white dialog, top right, with the mark on
  its black tile beside the title, one red button and ghost buttons for the
  rest. System fonts, because a page's own rules decide what loads there.
- **Pointer** (inside a page): an ink ring inside a white one, so it shows on
  light and dark pages, with a jacket-black note. It does not pulse.
- **Toolbar badge:** tie red when the page has a login Koffer can fill.

## Wording

- Short, plain sentences. One idea each. A full stop instead of a dash: no
  em dashes, en dashes or double hyphens anywhere in the interface.
- A button names what it does: "Copy password", "Reset vault", "Keep the
  vault". Never "OK", "Yes" or "Submit".
- An error says what went wrong and what to do next: "That card number has a
  wrong digit. Check it and try again."
- An empty value is left empty or says "None". Never a dash as a placeholder.
- Sentence case. No exclamation marks. No "please", no "successfully".
- Numbers are specific: "Locks in 0:28", "3 of your 42 logins".

## Do's and Don'ts

- Do keep red to one filled element per screen.
- Do keep yellow to its three jobs and the mark's handle; in the interface
  it is a warning, not decoration.
- Do say state in words; colour alone never carries meaning.
- Do keep every transition to a 150ms colour change, and none at all under
  `prefers-reduced-motion`.
- Don't add glow, blur, gradients, glass or a second accent.
- Don't animate entrances, pulse, spin or ping.
- Don't show anything that implies a network: no sync marks, no cloud icons,
  no "protected" badges.

## Known Gaps

- The README video and banner, and `design/logo.png`, still show the earlier
  neon logo.
- A dark variant. Not planned: the jacket already carries the dark.
