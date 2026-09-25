# JRC Dynamics — design system

**Company:** JRC Dynamics. **Product:** JRC Trackside (a working name; the header shows "Trackside" beside the mark).
**What it is:** a race-engineering app for competitive radio-control (RC) car racers, at any scale. A driver logs every
run on track: the setup, tyres, conditions, how the car felt, and every lap time, imported from the timing sites
(LiveRC, MyRCM, MyLaps Speedhive). Then they ask "the Engineer", an AI, what to change next. The Engineer's
answer comes from the driver's own setups and lap times.
**Who it's for:** club and national-level RC racers, their teams and their mechanics. They know their car's parts better than
we do, so write to them like a fellow racer, never like a marketer.

**Built and run by one founder, Jordan. Nothing in either look changes without his say-so.** Design new things
inside the rules below. If a request would break a rule, show both versions and let him choose.

---

## Two surfaces, two looks. Never mix them.

| | **Website** (jrcdynamics.com, signed out) | **App** (what a signed-in driver uses) |
|---|---|---|
| Ground | Dark `#171614`, with paper `#EAE3D5` break sections | Light paper `#F4F4F3`, white cards |
| Type | Space Grotesk headlines, Sora body, JetBrains Mono labels and numbers | Sora only, for everything, numbers included. No monospace |
| Yellow `#FFD60A` | Accent words in headlines, primary buttons, dashes, the closing band | A fill under dark text only (buttons, the log-run circle). Yellow text or icons use `#8A6A00` |
| Tokens | `tokens/website.css` | `tokens/app-colors.css` (values), `tokens/app.css` (the app's full stylesheet) |
| Previews | Group "Website" | Groups "App · …" |

Brand assets (mark, lockups, icons) are shared by both surfaces.

---

## The website

The live page is in **`ui_kits/website/index.html`**, with its pictures in `ui_kits/website/assets/`. Start
website work from that file. It is the real page, not a copy of it. `support.js` is the small runtime the page mounts
through; leave it alone.

**Section order, with the live headlines** (accent words, shown here in *italics*, are yellow):
1. Header: mark + "Trackside" wordmark; Sign in · Try the demo · Get started.
2. Hero: "Your race engineer, *in your pocket.*" A 3D phone render of the dashboard, tilted floating cards either
   side of it, and a blurred track photo behind.
3. Problem (paper): "The problem? You don't keep track of anything."
4. Log: "Easy enough that *you'll actually use it.*" Steps 01–04 beside a phone playing the log-a-run video.
5. Engineer: "Ask it *anything.*" A live chat mock that types questions and answers.
6. Session (paper): "Understand the real picture, stop guessing." Pace / Consistency / Mistakes tabs over a chart.
7. Teams: "Teams that work together best, *win*." A team leaderboard card.
8. Demo: "See what you're getting into *before you have to pay.*" A fan of 7 phone screenshots that cycles.
9. Founder (paper): a pull quote, and a line drawing of a medal, a cup and a trophy.
10. Pricing: "The notebook, *or the race engineer.*" Starter $2.99, Notebook $9.99, Race Engineer $19.99, all in AUD per month.
    Annual pricing is $99.90 and $199.90. There's a full refund in the first 14 days.
11. Closing band (solid yellow): "Start keeping track."
12. Footer: Sign in / Privacy / Terms; "© 2026 JRC Dynamics · Built by racers".

**Website rules**
- Headlines: Space Grotesk 700, tight (−0.025 to −0.035em), balanced wrap. The key phrase goes yellow; nothing else in
  a headline is coloured.
- Eyebrows, labels, prices and lap times: JetBrains Mono, small, uppercase for labels, 0.14–0.18em tracking, `#78786F`.
- Body and buttons: Sora. Lead paragraphs `#AFAFA6`, max about 40rem wide.
- Primary button: yellow fill, dark text, 9px corners, with a small pulsing dark dot before the words. Secondary
  button: a ghost with a `#34332F` hairline.
- Cards: `#232220` fill, `#33322E` border, 16px corners, a deep soft shadow. A card header is a mono label over a
  hairline, led by a 3×12px yellow tick.
- Layout: 1360px max width. Gutters `clamp(1.25rem, 5vw, 4.5rem)`. Sections breathe, with `clamp(6rem, 13vh, 10rem)`
  padding top and bottom. Two-column grids collapse on their own (`auto-fit, minmax(320px, 1fr)`).
- Motion: things fade up 22px over 0.8s as they scroll in. Nothing flashes. Honour reduced motion.
- Screens of the app are always real screens (`assets/screens/`, or the phone renders `hero-phone-dashboard.webp` and
  `fan-*.webp`). Never draw a made-up app UI.
- It must work on a phone at 390px wide.

---

## The app

The app's cards are drawn with its real stylesheet (`tokens/app.css`) and its real components, so what you see
in the "App" previews is what ships.

**App rules**
- One look, paper: page `#F4F4F3`, cards pure white and lighter than the page, ink `#191815` (never pure black).
  Don't warm the paper back towards beige; that was tried and dropped.
- One typeface: Sora 400/500/600/700, and figures in Sora with tabular numbers. Never add a second font or monospace.
- **Yellow means "do something".** Keep one or two yellow buttons on a screen. A button that *goes somewhere*
  ("Open the lab", "View all 8 cars") is the grey door button, not yellow. Selected tabs and segments are ink, never
  yellow.
- Buttons: 36px tall, 10px corners, 13.5px semibold. Every button carries its words; never icon-only.
- Cards open on a "band": a faint tinted header row holding an 11px uppercase grey label, with one full-width
  hairline under it. Don't put a mark or tick in front of the heading.
- Green and red are only for pace and quality: green for faster, red for slower. A count going up or down stays
  neutral.
- No explanatory paragraphs on app screens. A label, a placeholder or a few words on the button is the whole budget.
- Everything works at 390px wide with the bottom tab bar visible.
- Icons: the "Solid Form" set in `assets/icons/`. They're solid; an open tab is a colour change, never outline vs filled.

---

## Brand

- The **JRC mark** (`assets/brand/`) is one geometry, cut at −21°. It comes in yellow (brand and hero, on dark),
  white (working chrome, on dark) or ink (on yellow, and on paper). Never redraw it, recolour it, stretch it or outline it.
- **Lockups:** mark | rule | TRACKSIDE, horizontal or stacked, in colour (dark grounds) or mono black/white.
- The −21° cut is the brand's one angle. It shows up in the mark, the page-title marker and the sheen on the primary action.
  Use it sparingly or it stops meaning anything.
- `assets/brand/app-icon-512.png` is the phone app icon (ink mark on yellow).

## Voice

Plain, dry and specific, the way racers talk in the pits. Short sentences. Show the problem honestly, sometimes with a
wink ("Well — maybe you do. But not properly."). Talk about runs, setups, tyres, lap times and "what to change next",
not "insights" or "AI-powered". Samples from the live site:
- "Log a run in a minute. Ask what to change next — the answer is built from your own setups and lap times, not the internet."
- "Ten runs a day, three changes a run, none of it written down."
- "Say what the car did, in the words you'd use on the rostrum."
- "Shared inside the team. Nothing leaves it."
- "Race Engineer costs less than a set of tyres."

Calls to action in use: **Get started**, **Try the demo**, **Open the demo**, **Sign in**, **Create a team**.

## Numbers

- Lap times are in seconds to three decimals (`12.384`). A delta is written with a sign; positive means slower (`+0.120`) and negative means faster (`−0.212`).
- Prices are in AUD per month.
- Temperatures default to °C, with °F for drivers who pick it.

## What's in this project

- `README.md`: this guide.
- `tokens/website.css`, `tokens/app-colors.css`, `tokens/app.css`: the tokens and the app's stylesheet.
- `preview/`: the cards in the Design System pane.
- `ui_kits/website/`: the live website page and its pictures.
- `assets/brand/`, `assets/icons/`: the mark, the lockups, the app icon and the nav icons.
- `assets/screens/`: real app screens from the App Store set.

Rebuilt from the codebase by `scripts/design-system/build.tsx` in the app repository.
