# Loopfield marketing site (`apps/web`)

One scroll-driven page that sells the app. A 3D hex city sits behind it, and the store buttons lead to the App Store
and Google Play. Next.js 16 App Router on Vercel. The page is static, and only `/get` and the waitlist API run on the
server.

```bash
npm install                      # from the repo root (npm workspaces)
npm run dev -w @loopfield/web    # http://localhost:3200
npm run build -w @loopfield/web && npm run start -w @loopfield/web
npm run typecheck -w @loopfield/web
npm run lint -w @loopfield/web
npm test -w @loopfield/web       # brand drift, store links, springs, hex geometry, waitlist tokens
```

Add `?tier=high|mid|low|none` to the URL to force a 3D tier. `none` shows the still fallback.

## Configuration

Everything that changes before launch is in `src/config/site.ts`, and all of it is read from environment variables.
With no variables set, the site is safe to deploy: it shows the waitlist, no store buttons and no analytics.

| Variable | What it does |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical URL, used for Open Graph, the sitemap, QR codes and email links. On Vercel it defaults to the project's production domain |
| `NEXT_PUBLIC_IOS_STATE`, `NEXT_PUBLIC_ANDROID_STATE` | `waitlist` (default), `preorder` or `live`, set separately for each store |
| `NEXT_PUBLIC_IOS_APP_ID` | The numeric Apple ID from App Store Connect |
| `NEXT_PUBLIC_APPLE_PROVIDER_TOKEN` | The `pt` campaign token. It only exists once the app has analytics data |
| `NEXT_PUBLIC_ANDROID_PACKAGE` | Defaults to `dev.loopfield.app`. It can't change once published |
| `NEXT_PUBLIC_OFFICIAL_BADGES` | `1` once the official badge SVGs are in `public/badges` (see the README there) |
| `NEXT_PUBLIC_PUBLISHER`, `NEXT_PUBLIC_SUPPORT_EMAIL` | Shown in the footer, support, privacy and deletion pages |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog EU, cookieless. Turn on "Enable cookieless tracking" in the project |
| `RESEND_API_KEY`, `RESEND_SEGMENT_ID`, `WAITLIST_FROM`, `WAITLIST_SECRET` | The waitlist's double opt-in. `WAITLIST_SECRET` must be at least 32 characters. Until all four are set, sign-ups answer "open soon" |

## How the page works

- **Story clock** (`src/story/state.ts`, `src/components/StoryDriver.tsx`). T = section index + progress through
  the section. One `requestAnimationFrame` loop eases it, and the camera, the cell shader, counters and blocks all
  read it, so the 3D and the text never drift apart. Nothing moves on its own except the hero's opening loop and
  the dot's halo.
- **Beats and camera** live in two places. Story times are in `beats` in `src/story/world.ts`. Camera stations are
  in `KEYS` in `src/three/CameraRig.tsx`: `film` shifts the subject sideways beside the copy, and `lift` moves it up
  or down on phones. The dimming where the page's own content leads is in `src/three/dim.ts`.
- **The field** is one instanced mesh of hex prisms. Its per-cell timing is computed in `buildField`, and
  `src/three/fieldMaterial.ts` animates it on the GPU with the app's pop spring. The page quotes the same numbers
  the scene shows (66 cells claimed, 22 lost, 15 reclaimed).
- **Brand.** `src/theme/brand.ts` mirrors the app's tokens, springs and mark. `brand.test.ts` fails if they drift
  from `apps/mobile` or from `globals.css`.
- **Store buttons** all go through `/get`, which picks the store, adds the campaign and records `store_redirect` on
  the server. An inline script marks the visitor's phone before first paint, so each phone sees only its own store.
  Apple's badge rules are kept: App Store first, never animated, official artwork only.
- **Accessibility.** One h1 and one h2 per section. The canvas is decorative. Reduce Motion and the footer's
  "Pause motion" switch turn off smooth scroll, easing and the intro. The practice board has a "Draw one for me"
  button.

## Measured (production build, local)

- JavaScript before first paint: about 173 KB gzipped. Next.js and React are about 130 KB of that, and there is no
  three.js. This is over the plan's 120 KB target, which is below what Next 16 and React 19 need on their own.
- 3D bundle, loaded once the browser is idle: about 292 KB gzipped (budget 300 KB).
- HTML: 25 KB gzipped. CSS: 12 KB gzipped.

## Not done yet

- Official badge SVGs (`public/badges`), real app screenshots (the tour uses HTML mock screens with invented data),
  and the reviewed privacy policy and terms (the pages say "pilot draft").
- A Vercel project (`loopfield-web`, root directory `apps/web`) and the domain.
