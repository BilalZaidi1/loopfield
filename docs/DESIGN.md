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
- Ground you lost this season: a dashed outline in your own colour over the rival's fill, faded when it cannot be reclaimed (taken back with points, season closed). Selected cells get a solid violet casing. The key explains both.
- Movement points: a green bolt pill under the competition chip on phones (beside it on wide screens). Green means points everywhere: the pill, the points screen, a run's points card.
- Reclaiming happens in the bottom sheet: tap dashed cells, and the sheet keeps a receipt (selected, cost per cell, total, your balance, after reclaiming) above one button that names the count and the price. Where the map cannot be drawn (browser, Expo Go) the same choice is a list grouped by who took the cells and when, with round checkboxes and "select all" as a row in the same style.

## Badges and ranking

- Badges are hexagons (the shape of a cell) in the tier's metal: bronze, silver, gold and a cool platinum, with the category's line icon in the centre (route, calendar, cell, compass, people, trophy). Locked badges are grey with a lock. A tier-only hexagon (no icon) marks a runner's highest tier in rankings and the scoring key.
- Violet is the ranking colour (the global ranking card and your rank), consistent with violet meaning "you".
- Ranking rows: rank, avatar with the highest tier pinned to its corner, name, "N badges · N categories", score. Scope chips (everyone, country, region, friends, club) and challenge categories sit on one line that scrolls sideways.
- Profile: the ranking card (rank, challenges done, badges that fit the width with "+N"), then three equal tiles in one layout: icon, number, what it counts, its scope.

## Number tables

"Show numbers" under every chart opens a table that names each period in full (Mon, "Week of Nov 2"), right-aligns values with tabular figures, adds a short magnitude bar, a comparison column when the chart compares (last week), a tag on the current period and a total row. Missing data shows a dash, never zero.

## Health charts

Health screens use a calmer figure: the sans face (Figtree ExtraBold, 48 px) rather than the black italic used for runs. Charts are one series in the health green (`#3A944F` columns and `#257539` lines in light, `#55AE66` and `#7CCB88` in dark). The calendar uses a five-step ramp (light `#7CC88B`→`#145628`, dark `#2E6A3B`→`#B4EBBC`). Sleep stages are deep, light, REM and awake (light `#5B57E3`, `#1BAF7A`, `#2A78D6`, `#EB6834`; dark `#6762F0`, `#199E70`, `#3987E5`, `#D95926`), always with a list naming each stage and its time. All were checked with the dataviz validator. Text never takes a series colour.

## Layout and navigation

Phones: bottom tab bar (Home, Map, Record, Progress, Clubs) with Record as a raised round button. ≥ 1024 px: a sidebar with the same tabs plus Start a run, Messages, Notifications and your profile. Content is centred at a reading width on tablets and desktops; Home and Clubs switch to two columns at ≥ 700 px. Pushed screens use one header with a Back button and the screen title.

## States

Loading uses skeletons (a pulse that stops with Reduce Motion), empty states have an icon, one sentence and an action, errors say what failed and offer Try again, and an offline pill appears at the top of every screen.

## Motion

Press squeeze on buttons and cards, sliding tab and segment indicators, the splash loop, chart bars growing once, the ready-to-run pulse, sheet slides, and a short burst when a run is saved. All of it is skipped with Reduce Motion.
