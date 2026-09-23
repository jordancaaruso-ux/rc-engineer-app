---
paths:
  - "src/**/*.tsx"
  - "src/**/*.css"
---

# Screens, styling, copy

Read `docs/VISUAL_NORTH_STAR.md` before a visual rework.

- Reuse the primitives in `src/components/ui/` before writing a new one: `SurfaceCard`,
  `CardPanel`, `HeroPanel`, `PagedCard`, `panel.tsx` (`PanelTitle`, `PanelSubtitle`, `HubRowTitle`,
  `Eyebrow`, `StatStrip`, `StatTile`), `Button`/`ButtonLink`.
- Colours come from semantic tokens (`bg-background`, `text-primary`), never new raw hex. Yellow
  means an action. Green and red are only for pace and quality deltas; volume deltas stay neutral.
- Everything must work at 390px wide with the bottom dock visible.
- One theme: paper, a near-neutral light ground (#F4F4F3) with white cards, stamped
  `data-theme="light"` by `src/lib/theme/appTheme.ts`. There is no theme switch. The dark values
  under `:root` are only the base that paper overrides, so build for paper and don't add a second
  theme path. The older warm "ash" ground was dropped on purpose; don't propose warming it back.
- No explanatory paragraphs in the app. A label, a placeholder or a few words on the button is the
  whole budget: small grey helper text is clutter on a phone, and the control should explain
  itself. If a screen truly can't be understood without a sentence, ask Jordan first.
- `next dev` sometimes serves stale CSS after a `globals.css` edit, even across restarts. Judge CSS
  changes on `npx next build`, not the dev server.
