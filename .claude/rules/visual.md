---
description: UI/visual conventions for React components — the rules that matter most
paths:
  - "src/app/**/*.tsx"
  - "src/components/**/*.tsx"
---

# UI work

Read `docs/VISUAL_NORTH_STAR.md` for the full spec. The rules that matter most:

- **Use existing primitives** — `SurfaceCard`, `CardPanel`, `panel.tsx` (`Eyebrow`, `StatStrip`,
  `StatTile`, `Button`/`ButtonLink`). Don't invent parallel card/stat/label patterns.
- **Semantic tokens only** — `bg-background`, `text-primary`, `border-border`. No new raw hex.
- **Yellow = actions only.** Green/red = pace and quality deltas. Volume deltas are neutral.
- **Works at 390px** with the bottom dock visible.
- A visual pass is **restyle only** — no behaviour, routing, or API changes smuggled in.
