---
version: beta
name: Koffer Midnight
description: Dark-first, layered slate surfaces, one emerald accent, amber for warnings. A calm, premium product UI for a local password manager on Windows.

colors:
  canvas: "#0b0d10"
  canvas-line: "#1d2228"
  surface: "#0f1216"
  well: "#0c0f13"
  raised: "#14181d"
  hover: "#1b2027"
  selected: "#252b33"
  hairline: "#232931"
  text: "#e8ebef"
  muted: "#9ba3ae"
  placeholder: "#838b97"
  emerald: "#3dbe8b"
  emerald-hover: "#5acf9f"
  on-emerald: "#04140d"
  danger: "#f06a6f"
  danger-container: "#2a1719"
  on-danger-container: "#f79599"
  on-danger: "#1a0507"
  warning-container: "#2b2413"
  on-warning-container: "#f2b544"
  scrim: "#000000 at 50%"

typography:
  title:     { fontFamily: "Inter", fontSize: 22px, fontWeight: 600, lineHeight: 28px, letterSpacing: -0.018em }
  heading:   { fontFamily: "Inter", fontSize: 19px, fontWeight: 600, lineHeight: 24px, letterSpacing: -0.014em }
  subhead:   { fontFamily: "Inter", fontSize: 17px, fontWeight: 600, lineHeight: 24px, letterSpacing: -0.01em }
  body:      { fontFamily: "Inter", fontSize: 13px, fontWeight: 400, lineHeight: 20px }
  small:     { fontFamily: "Inter", fontSize: 12px, fontWeight: 400, lineHeight: 18px }
  caption:   { fontFamily: "Inter", fontSize: 11px, fontWeight: 500, lineHeight: 16px, letterSpacing: 0.01em }
  secret:    { fontFamily: "IBM Plex Mono", fontSize: 13px, fontWeight: 400, lineHeight: 20px }

rounded:
  chip: 6px
  control: 8px
  panel: 12px

spacing:
  unit: 4px
  steps: "4px 8px 12px 16px 24px 32px"
  control-height: 36px
  sidebar-width: 220px
  panel-padding: 24px
---

# Koffer: Midnight

Status: chosen on 2026-10-19. The rules below are enforced by
`src/__tests__/designSystem.test.ts`, and the same system lives as a Claude
Design System artifact ("Koffer Midnight").

## Overview

A password manager is opened for a few seconds, in the evening as often as
the morning, to fetch one thing. Midnight keeps the room dark and quiet so
that one thing is the brightest object on screen. Depth comes from layered
slate surfaces, never from colour: each step forward is a little lighter.
One emerald accent marks the single action a screen is for.

## Colors

Surfaces, back to front. Each is lighter than the one behind it:

| Layer | Hex | Job |
| --- | --- | --- |
| canvas | `#0b0d10` | The rail (sidebar) on every screen, including lock and setup. |
| surface | `#0f1216` | The page. |
| well | `#0c0f13` | Inside a field: a step *back*, so typing sits in the surface. |
| raised | `#14181d` | Cards, panels, dialogs, the side sheet. |
| hover | `#1b2027` | A hovered row or button. |
| selected | `#252b33` | The current nav entry, the chosen segment, avatars. |

- **Hairline** (`#232931`) separates panels. Never a second background
  colour, never a shadow, for that job.
- **Text** (`#e8ebef`) and **muted** (`#9ba3ae`) pass 4.5:1 on every
  surface. **Placeholder** (`#838b97`) passes 4.5:1 on the page and in a
  field.
- **Emerald** (`#3dbe8b`) is the accent. It fills the one primary button of
  a screen with dark `on-emerald` text, draws the focus ring, ticks
  checkboxes and sliders, and fills the health score ring. It is never body
  text and never a second filled button.
- **Danger** (`#f06a6f`) is for words that warn about loss, the ghost
  `btn-danger` that leads into a destructive dialog, the 3px rule along the
  top of that dialog, and its one filled `btn-destructive` confirm.
- **Amber** is for warnings and is always the pair `warning-container` /
  `on-warning-container`: a tinted chip with amber words (Leaked, Reused,
  Weak, Not recoverable) and the lock countdown in its last 30 seconds.
  Never loose amber text, never an amber line.

There is no blue, no purple and no gradient. A new colour needs a job none
of these can do.

## Typography

Inter for the interface, bundled in `src/fonts/` (OFL-1.1) and never
fetched. Stylistic sets `cv05`, `cv08` and `ss03` are on, so `l`, `1` and `I`
stay apart. IBM Plex Mono for anything secret or typed exactly: passwords,
codes, keys, card numbers.

Three weights: 400 to read, 500 for controls and labels, 600 for titles and
the primary button. Titles are tracked slightly tight (−1% to −1.8%).
Sentence case everywhere.

## Layout

- Two columns at all times: the rail (220px) and the page. The vault adds a
  list column between them.
- The rail is separated from the page by a 1px `canvas-line` on its right
  edge, not by a contrast jump.
- Lock and setup keep the rail in place, carrying only the mark and the
  name. The form sits centred on the page.
- Forms are one column, labels above fields.
- The window is 900 x 700 with an 820 x 600 minimum.

## Spacing

Every gap is a step of the 4px scale: 4, 8, 12, 16, 24, 32. Inner gaps are
always at least one step smaller than the gap around a group. A heading has
more space above it than below it.

## Elevation

Mostly flat. Cards carry a 1px white highlight along their top edge at 3%
opacity, which reads as a lit edge rather than a shadow. Things that float
(dialogs, the side sheet, menus) add one deep shadow,
`0 24px 64px -16px rgb(0 0 0 / .75)`, over a 50% black scrim. No glow, no
blur, no glass.

## Shapes

6px on chips and flags, 8px on buttons, fields, rows and avatars, 12px on
cards and dialogs.

## Components

- **Primary button** (`.btn-primary`): emerald fill, dark text at 600, 36px
  high, a soft top highlight. One per screen. Disabled is a quiet hover-grey
  step with placeholder text, not a faded emerald.
- **Secondary button** (`.btn-secondary`): raised fill, hairline border,
  text colour. Every other action.
- **Danger button** (`.btn-danger`): like secondary, with danger words. Opens
  a confirm dialog.
- **Destructive confirm** (`.btn-destructive`): danger fill, dark text. Only
  inside a destructive dialog.
- **Field** (`.field`): well fill, hairline border, 8px corners. Hover lifts
  the border one step; focus turns it emerald with a 3px emerald halo at 22%.
- **Card** (`.card`): raised fill, hairline border, 12px corners, lit top edge.
- **Dialog** (`.dialog`): a card that floats. A destructive one adds
  `.dialog-danger`: a 3px danger rule along its top edge.
- **Flag** (`.flag`): amber words on the amber container, 20px high, 6px
  corners, a faint amber inner border.
- **Link** (`.link`): text colour, underlined in the placeholder grey; the
  underline turns emerald on hover.
- **Nav entry**: muted text; hover takes the hover surface; the current one
  takes the selected surface with full text colour.
- **Avatar**: selected-surface square with the item's initial or logo.
- **Mark**: a locked case. Light body (`on-canvas`), slate handle
  (`on-canvas-muted`), emerald keyhole, always on the canvas.

## Browser extension

The popup and the bars the extension shows inside web pages follow this file.

- **Popup** (320px wide): a canvas strip across the top with the mark and the
  name, then two panels on the page colour split by a hairline: what the page
  is, and what the vault has for it. Logins are rows that take the hover fill.
  Personal info is a raised card with a hairline, so it never reads as one
  more login. Inter and IBM Plex Mono ship inside the extension.
- **Save bar** (inside a page): a raised dark dialog, top right, with the mark
  on its canvas tile beside the title, one emerald button and quiet buttons
  for the rest. System fonts, because a page's own rules decide what loads
  there.
- **Pointer** (inside a page): an emerald ring set in a canvas-dark one, so it
  shows on light and dark pages, with a canvas note. It does not pulse.
- **Toolbar badge:** emerald, with dark ink, when the page has a login Koffer
  can fill.

## Wording

Unchanged: short plain sentences, buttons that name what they do, errors
that say what went wrong and what to do next, no dashes as punctuation, no
"please", no exclamation marks, specific numbers.

## Do's and Don'ts

- Do keep emerald to one filled button per screen.
- Do keep amber in its container pair.
- Do say state in words; colour alone never carries meaning.
- Do keep transitions to 150ms colour and border changes, and none under
  `prefers-reduced-motion`.
- Don't add glow, blur, glass, gradients or a second accent.
- Don't animate entrances, pulse or spin.
- Don't show anything that implies a network: no sync marks, no cloud icons.

## Known gaps

- A light variant is not planned.
