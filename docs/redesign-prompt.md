# Line Select — "Next Level" Redesign Prompt

> Paste everything below the line into a fresh Claude Code session (Opus 5.5) opened in this repo.

---

You're redesigning **Line Select**, a Next.js 16 app that ranks FedEx pilots' monthly bid lines against their own preferences. It works well, but it *looks* like a well-made SaaS template, and a pilot opening it should instead feel they've stepped onto a flight deck that was built for them. The goal is a site that's clean, fast and calm to use, and memorable within three seconds of loading. This is a multi-hour project worked phase by phase, not a reskin, so redesign layouts and components where needed.

## Before you write any code

1. Read `AGENTS.md`. This is Next.js 16, not the version in your training data, so check `node_modules/next/dist/docs/` before using any Next API.
2. Study what exists, and keep what's good:
   - **Design tokens**: `src/app/globals.css`. These are warm coffee/caramel tokens for light and dark, plus a red-light "cockpit night mode" (`src/lib/theme.ts`), shared motion tokens (`--duration-*`, `--ease-*`) and a faint nav-log grid texture. Every color is a CSS variable, and AA contrast was tuned on purpose.
   - **Typography** (`src/app/layout.tsx`): IBM Plex Sans Condensed for display (`font-display`), Public Sans for body, IBM Plex Mono for data.
   - **Animation**: `motion` (v13) is already installed. `ScreenTransition` handles page fades.
   - **Screens**:
     - `WelcomeScreen` (landing)
     - `UploadScreen` / `PreviewScreen`
     - `AdaptiveInterview` (the AI interview)
     - `ResultsView` + `LineCard`, which uses `ScoreRing`, `CategoryBars`, `MiniLinePreview` (month calendar), `RouteMap`, `TripList` and `BidCountdown` (the chronometer)
     - `StrategiesScreen`
     - `TradeBoardScreen` / `InboxScreen`
     - the `AppShell` sidebar, `LeftNav`
   - **Real data you can visualize**: `src/lib/airport-coordinates.ts` has lat/lon for every layover city. Each line has real trips with real dates, layovers, report times, credit and TAFB. Each bid pack has hundreds of lines.
3. Start the dev server from `.claude/launch.json` and screenshot every screen, light and dark, at desktop and phone width. Write a short critique of what's generic or flat on each. That critique is your baseline.
4. Write the plan (below) as phases, show it to me, and wait for my go-ahead before Phase 1.

## Design direction: "Glass cockpit at night"

The current theme is warm paper and coffee. Evolve it, don't throw it away: keep the warm amber identity, but take the *dark* theme to a cinematic, instrument-panel level.

- **The mood is a widebody flight deck at cruise, at night.** Deep near-black surfaces with a hint of warmth. Amber and caramel as the "instrument light" accent. Precise hairlines, glowing readouts and lots of calm negative space. Think of a modern glass cockpit's primary flight and navigation displays (PFD/ND) and an electronic flight bag, not a dashboard template.
- **Every visual element earns its place with real data.** No stock aviation photos, no clip-art planes, no fake numbers. The most striking visuals should be built from the pilot's *own* bid pack: their routes, their calendar, their scores.
- **Light mode stays first-class.** It's the "daylight chart" version: warm paper, ink linework, the same structure. Red-light night mode must keep working and must stay red-only. Check every new glow, gradient and 3D material in it.
- **Typography**: keep Plex Sans Condensed and Plex Mono, but use them more boldly:
  - very large condensed display numerals for scores and countdowns;
  - Mono for every real number, with tabular figures;
  - tighter, more confident headline hierarchy.

  If you believe a different display face would be clearly better, propose it with side-by-side screenshots; use Google Fonts via `next/font` only.
- **Not FedEx-branded.** The app is independent and says so. No FedEx logos, aircraft liveries, or the purple and orange color pairing.

## The signature moments (what makes it memorable)

### 1. Landing: a live 3D globe of real routes
Replace the centered-text-and-three-cards hero with a full-bleed **3D night globe**, built with `three` + `@react-three/fiber` (+ `@react-three/drei` if useful):
- **The globe**: a dark sphere with faint graticule lines, warm city-light dots at real airport coordinates, and a subtle atmosphere rim glow.
- **Animated route arcs** draw out from the hub (MEM) to real layover cities from the sample pack (ANC, CDG, HNL, NRT and so on). Glowing great-circle arcs, with a small light pulse traveling along each one.
- **Motion**: slow auto-rotation, drag to spin with inertia, and parallax tilt that follows the cursor on desktop.
- **The headline sits over it** with a staggered reveal.
- **Copy stays honest.** "Independent prototype · not affiliated with FedEx" stays visible.
- **Scroll storytelling below the hero.** Three or four sections that pin and animate as you scroll, each showing a real piece of the product with sample data:
  1. A bid pack being parsed.
  2. The interview asking one sharp question.
  3. Lines re-ranking.
  4. A month calendar drawing itself in.

  These replace the static feature cards.

### 2. Upload: the "FMS load" sequence
The drop zone should feel like loading a flight plan:
- dropping a PDF triggers a scanning-line animation over a stylized page;
- then a live readout counts up the *real* progress numbers the parser produces (pages classified, pairings parsed, lines read);
- it finishes in a satisfying "LOADED" lock-in.

Never fake progress: wire it to real values, or use honest indeterminate motion.

### 3. Interview: a conversation with a destination
- Questions arrive like a calm, precise first officer: the text types or reveals in, with answer controls sliding up underneath.
- Replace the progress bar with a **flight-path progress strip**: a thin route line with a small aircraft symbol moving along it as the pilot answers, from takeoff to the destination when the interview ends.
- Sliders get a tactile feel: snapping detents, a glowing thumb, and live value readouts in Mono.
- The bidding-story box should feel inviting rather than like a form: a large writing surface with a gentle prompt, live character count, and a visible microphone for dictation.
- When the interview finishes, play a short "computing your ranking" sequence: lines streaming past and sorting. Keep it under 2 seconds, and don't add it if real work is already slower than that.

### 4. Results: the instrument panel
- **Score as an instrument.** Rework `ScoreRing` into a proper gauge: an arc with tick marks and a needle or fill that sweeps up on reveal, with the number counting up in large condensed numerals. A dealbreaker cap should *look* capped, for example a red limit tick on the gauge.
- **Line cards.** Staggered entrance on load. When the order changes (filter, sort, or a drag-to-swap), cards move to their new positions with smooth layout animation (`motion`'s `layout`) instead of jumping. The top pick gets a restrained amber glow edge.
- **Calendar (`MiniLinePreview`).** Trips draw in day by day, layovers appear as little nodes, and hovering a trip highlights its whole span.
- **Route map (`RouteMap`).** Upgrade it to a richly lit **2D** route view per line (no 3D here: Results can show 300+ cards, and many WebGL scenes would stutter on a phone). Draw curved great-circle-style arcs from the hub to each layover, with glowing city nodes, a faint graticule, and the arcs drawing in on reveal. Hovering a line card previews its routes.
- **Category bars and comparisons.** Animated fills, and side-by-side comparison with synchronized hover.
- **Bid countdown.** Keep the chronometer and make it more of a centerpiece: a second hand, and urgency colors as the deadline nears.

### 5. App shell and everything else
- **Sidebar** becomes a sleek instrument-panel rail: active-state glow, icons that animate subtly on hover, collapsible on desktop, a proper bottom tab bar on phones.
- **Page transitions**: a shared "panel slide" language between sections instead of plain fades.
- **Strategies, Trade Board, Inbox, Hotel Ratings, Preferences** get the same system: real hierarchy, consistent cards, animated empty states, skeletons that match the final layout.
- **Micro-interactions everywhere**:
  - buttons press down with depth;
  - toggles click;
  - copy actions confirm with a tick;
  - toasts slide in from a consistent place;
  - numbers that change always tick between values rather than snapping.

## Hard rules (non-negotiable)

- **Accessibility**:
  - Keep WCAG AA contrast in light, dark and red-light modes.
  - Every animation honors `prefers-reduced-motion`: replace motion with instant state changes or simple fades, and stop auto-rotation.
  - Keyboard focus is always visible.
  - The 3D canvas is decorative (`aria-hidden`) and never the only place information lives.
- **Performance**:
  - **Landing load**: largest content in under 2.5 s on a mid-range phone.
  - **The 3D scene**: lazy-load it (dynamic import, `ssr: false`) after the hero text paints, with a static, beautiful poster image or SVG fallback for slow devices, WebGL failure, and reduced motion.
  - **Bundle budget**: under 250 KB of extra gzipped JS for the landing page. The 3D globe is landing-page only, so no 3D library (`three` or `@react-three/*`) is ever imported by any other screen.
  - **Battery**: pause every render loop when the tab is hidden or the canvas is off-screen, and cap the device pixel ratio at 2.
  - **Scrolling**: Results must stay smooth with 300+ line cards, so animate only what's on screen.
- **Phones first-class.** Pilots open this in hotel rooms and crew rooms on phones and iPads. Every signature moment needs a phone version, simplified where needed, with no horizontal scroll and 44 px touch targets.
- **Don't break anything.**
  - This is a visual and interaction redesign: no changes to parsing, scoring or interview logic, and no changes to what data is shown or what it means.
  - Keep all 600+ tests passing, plus `npx tsc --noEmit`, `npx eslint src` and `npx next build`.
  - Keep every honesty label: "estimated", "not affiliated", privacy notes.
- **Design system, not one-offs.** New colors, glows, shadows, radii and motion timings go in `globals.css` as tokens, with light, dark and red-light values. Build reusable primitives (`Gauge`, `NumberTicker`, `GlowCard`, `FlightPathProgress`, `Globe`) instead of styling each screen by hand.

## How to work

1. **Phase 0: audit and plan.** Screenshot every screen as it is now, write the critique, and propose the phases below with what each changes. Wait for my approval.
2. **Then one phase at a time, roughly in this order:**
   1. Tokens and primitives
   2. Landing with the globe
   3. Upload
   4. Interview
   5. Results
   6. App shell and transitions
   7. Remaining screens
   8. Polish pass: motion timing, reduced motion, performance, phone
3. **After each phase:**
   - Verify in the browser: light, dark and red-light modes; desktop and phone width; reduced motion on. Show me before/after screenshots.
   - Run the full checks.
   - Report what changed and anything that didn't work out.
   - Ask before committing. Never commit or push without my yes.
4. **If an idea in this prompt is worse in practice than an alternative, say so and propose the better one.** I want the best result, not literal obedience. Avoid adding motion for its own sake: if an animation makes something slower to read or use, cut it.

**Definition of done:** a pilot opens the site and thinks *"this was built by someone who flies"*. It's beautiful in every mode, smooth on a phone, every animation tells them something real, and nothing they relied on before has moved or broken.
