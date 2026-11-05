# Design system

Loopfield's interface after the November redesign. Code lives in `apps/mobile/src/theme/` (tokens, theme provider, fonts, layout, motion) and `apps/mobile/src/components/` (shared components).

## Idea

One loud element per screen, everything else quiet. The loud elements are huge heavy-italic numerals (Figtree Black Italic) and saturated colour blocks. Surfaces stay white in light mode and near-black in dark mode, lists are divided by hairlines, icons are 2 px line drawings, and primary actions are pill buttons with a round arrow at the end.

## Colour

| Role | Light | Dark | Used for |
|---|---|---|---|
| Violet | `#5B57E3` | text `#8B87FF`, fill `#6762F0` | you, your land, brand, primary actions |
| Blue | `#0A74E0` | `#0A74E0` / text `#5AB4FF` | runs and activity |
| Orange | `#FF7A1A` | `#FF7A1A` / text `#FF9A4D` | competition: seasons, rankings, route titles |
| Green | `#5CC86A` | `#5CC86A` / text `#4ADE80` | health and goals |
| Background | `#EEF0F5` | `#101114` | page |
| Surface | `#FFFFFF` | `#1C1D22` | cards and lists |

Blocks carry white text (violet, blue) or ink text (orange, green) so every pairing meets WCAG AA. Components inside a `Card tone="…"` recolour themselves (text, buttons, badges, icons) through a block context.

## Type

Figtree: 500 body, 600 labels, 700 headings, 800 titles, 900 italic for numerals and the two display headlines (welcome, ready-to-run). Each weight is its own font family so Android never synthesises bold; style overrides with `fontWeight` are mapped to the right file by `Txt`.

## Map

- Base map follows the theme (Mapbox light/dark unless a custom style is configured).
- Your cells: violet fill with a soft glow outline. Rival cells: warm hues, one per runner, never violet. Unavailable areas: grey with a dashed edge. Unclaimed ground is unmarked; a faint cell grid appears from zoom 14.5 to show the board.
- Routes: green line on a white (light) or dark (dark) casing; violet when you hold the title; dashed when suspended. Your live path: violet with a casing. Your location: pulsing puck.
- Floating controls (locate, routes, grid, key), a competition chip, a bottom sheet with the text summary of what is in view, and panels for a tapped cell or route. The Mapbox logo and attribution stay visible above the sheet.

## Layout and navigation

Phones: bottom tab bar (Home, Map, Record, Progress, Clubs) with Record as a raised round button. ≥ 1024 px: a sidebar with the same tabs plus Start a run, Messages, Notifications and your profile. Content is centred at a reading width on tablets and desktops; Home and Clubs switch to two columns at ≥ 700 px. Pushed screens use one header with a Back button and the screen title.

## States

Loading uses skeletons (a pulse that stops with Reduce Motion), empty states have an icon, one sentence and an action, errors say what failed and offer Try again, and an offline pill appears at the top of every screen.

## Motion

Press squeeze on buttons and cards, sliding tab and segment indicators, the splash loop, chart bars growing once, the ready-to-run pulse, sheet slides, and a short burst when a run is saved. All of it is skipped with Reduce Motion.
