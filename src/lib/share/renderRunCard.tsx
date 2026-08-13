import "server-only";

import type { ReactNode } from "react";
import { ImageResponse } from "next/og";
import { BRAND_DOMAIN, PRODUCT_NAME } from "@/lib/brand/brandNames";
import { CARD_WIDTH, LAP_CHIPS_PER_ROW, type ShareRunCard } from "@/lib/share/shareCardModel";
import { SHARE_DARK } from "@/lib/share/shareTheme";

/**
 * Draws the picture a driver hands to Messenger.
 *
 * `next/og` (satori) rather than a headless browser: it ships its own font — the bundled
 * `Geist-Regular.ttf` inside `next/dist/compiled/@vercel/og` — so nothing has to be vendored into
 * the repo. Verified in the build trace: the font and both wasm blobs are listed against this
 * route, which was the one real deployment risk here.
 *
 * ONE WEIGHT is available, so hierarchy is carried by size and colour, never by bold. Writing
 * `fontWeight: 700` would render identically to 400 and quietly flatten the design.
 *
 * Every colour comes from `shareTheme.ts`, which mirrors `globals.css`. Nothing in this file may
 * introduce a literal hex — that is how the first version ended up cool-slate against the app's
 * warm charcoal, close enough to typecheck and wrong enough to look like a different product.
 *
 * Satori is not a browser, and three of its rules bit during the first render:
 *
 *   1. **A React Fragment is not transparent.** Satori wraps the children of a `<>…</>` in an
 *      implicit box that defaults to `flexDirection: row`. Every `<Band> + content` pair written
 *      as a fragment came out side by side — the section label vertically centred to the LEFT of
 *      its own content, which then ran off the right edge. Hence `<Section>`: one real element,
 *      explicitly a column. Do not reintroduce a fragment here.
 *   2. **Percentage heights need a resolved parent.** The bar chart drew nothing at `height: "60%"`;
 *      the bars are given pixel heights computed against a known track instead.
 *   3. **Runs of spaces collapse**, so separators have to be real characters, not padding spaces.
 *
 * And the box is fixed — overflow is CLIPPED, not scrolled — which is why `card.height` is
 * computed up front in `shareCardModel.ts`.
 */

const C = SHARE_DARK;

const PAD = 56;
const INNER = CARD_WIDTH - PAD * 2;
const WELL_GAP = 10;
const BAR_TRACK = 180;

const label = {
  fontSize: 20,
  letterSpacing: 2.6,
  textTransform: "uppercase" as const,
  color: C.faint,
};

/** A titled block. One element, explicitly a column — see rule 1 in the header comment. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: `26px ${PAD}px 0` }}>
        <div style={{ ...label, display: "flex" }}>{title}</div>
        <div style={{ display: "flex", flexGrow: 1, height: 1, backgroundColor: C.line }} />
      </div>
      {children}
    </div>
  );
}

function Wells({ rows, cols }: { rows: { label: string; value: string }[]; cols: 2 | 3 }) {
  // Pixel widths, not percentages: satori's box model does not subtract padding the way
  // `border-box` does, so `width: 33%` plus padding overflowed and clipped the third column.
  const width = Math.floor((INNER - WELL_GAP * (cols - 1)) / cols);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: WELL_GAP, padding: `16px ${PAD}px 10px` }}>
      {rows.map((r) => (
        <div
          key={r.label}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            width,
            backgroundColor: C.surface,
            border: `1px solid ${C.line}`,
            borderRadius: 10,
            padding: "12px 14px",
          }}
        >
          <div style={{ ...label, display: "flex", fontSize: 17, letterSpacing: 2 }}>{r.label}</div>
          <div style={{ display: "flex", fontSize: 26, color: C.ink }}>{r.value}</div>
        </div>
      ))}
    </div>
  );
}

function LegendDot({ color, children }: { color: string; children: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div style={{ display: "flex", width: 14, height: 14, borderRadius: 3, backgroundColor: color }} />
      <div style={{ ...label, display: "flex", fontSize: 17 }}>{children}</div>
    </div>
  );
}

export function RunCard({ card }: { card: ShareRunCard }) {
  const lapChipWidth = Math.floor((INNER - 34) / LAP_CHIPS_PER_ROW);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: CARD_WIDTH,
        height: card.height,
        backgroundColor: C.bg,
        color: C.ink,
        fontFamily: "sans-serif",
      }}
    >
      {/* ---------- header ---------- */}
      <div style={{ display: "flex", flexDirection: "column", padding: `${PAD}px ${PAD}px 0` }}>
        {card.eyebrow ? <div style={{ ...label, display: "flex" }}>{card.eyebrow}</div> : null}
        <div style={{ display: "flex", fontSize: 52, color: C.ink, marginTop: 12, lineHeight: 1.15 }}>
          {card.title}
        </div>
        {card.subtitle ? (
          <div style={{ display: "flex", fontSize: 28, color: C.mut, marginTop: 10 }}>
            {card.subtitle}
          </div>
        ) : null}
      </div>

      {/* ---------- the figures ---------- */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          marginTop: 40,
          borderTop: `1px solid ${C.line}`,
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        {card.tiles.map((t, i) => (
          <div
            key={t.label}
            style={{
              display: "flex",
              flexDirection: "column",
              width: CARD_WIDTH / 2,
              gap: 10,
              padding: `26px ${PAD}px 30px`,
              borderRight: i % 2 === 0 ? `1px solid ${C.line}` : "none",
              borderTop: i >= 2 ? `1px solid ${C.line}` : "none",
            }}
          >
            <div style={{ ...label, display: "flex" }}>{t.label}</div>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <div style={{ display: "flex", fontSize: 76, lineHeight: 1, color: C.ink }}>
                {t.value}
              </div>
              {t.suffix ? (
                <div style={{ display: "flex", fontSize: 26, color: C.mut }}>{t.suffix}</div>
              ) : null}
            </div>
          </div>
        ))}

        {/* Green/red here is the app's data semantic — pace and quality deltas only. */}
        {card.pace ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: CARD_WIDTH,
              gap: 10,
              padding: `26px ${PAD}px 30px`,
              borderTop: `1px solid ${C.line}`,
            }}
          >
            <div style={{ ...label, display: "flex" }}>{card.pace.label}</div>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 76,
                  lineHeight: 1,
                  color: card.pace.faster ? C.gain : C.loss,
                }}
              >
                {card.pace.value}
              </div>
              <div style={{ display: "flex", fontSize: 26, color: C.mut }}>{card.pace.note}</div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ---------- headline: one conditions line ---------- */}
      {card.conditionsLine ? (
        <div style={{ display: "flex", padding: `26px ${PAD}px 30px`, fontSize: 26, color: C.mut }}>
          {card.conditionsLine}
        </div>
      ) : null}

      {/* ---------- full: session details + the nine lap figures ---------- */}
      {card.details.length > 0 ? (
        <Section title="Session details">
          <Wells rows={card.details} cols={2} />
        </Section>
      ) : null}

      {card.lapWells.length > 0 ? (
        <Section title="Lap figures">
          <Wells rows={card.lapWells} cols={3} />
        </Section>
      ) : null}

      {/* ---------- every lap ---------- */}
      {card.laps ? (
        <Section title="Every lap">
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              margin: `18px ${PAD}px 6px`,
              padding: "14px 16px",
              border: `1px solid ${C.line}`,
              borderRadius: 12,
              backgroundColor: C.recessed,
            }}
          >
            {card.laps.map((l) => (
              <div
                key={l.lapNumber}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  width: lapChipWidth,
                  height: 42,
                  borderRadius: 6,
                  backgroundColor:
                    l.flag === "best"
                      ? C.flagBest
                      : l.flag === "miss"
                        ? C.flagMistake
                        : "transparent",
                  opacity: l.excluded ? 0.45 : 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: 20,
                    color: C.faint,
                    width: 38,
                    justifyContent: "flex-end",
                  }}
                >
                  {l.lapNumber}.
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 24,
                    color: C.ink,
                    textDecoration: l.excluded ? "line-through" : "none",
                  }}
                >
                  {l.time}s
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 26, padding: `4px ${PAD}px 0`, alignItems: "center" }}>
            <LegendDot color={C.flagBest}>Best lap</LegendDot>
            <LegendDot color={C.flagMistake}>Mistake — well off the median</LegendDot>
          </div>
        </Section>
      ) : null}

      {/* ---------- the trace, as bars: taller is slower, matching LapTimeGraph ---------- */}
      {card.bars ? (
        <Section title="Lap trace">
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 4,
              height: BAR_TRACK,
              margin: `20px ${PAD}px 10px`,
              borderBottom: `1px solid ${C.line}`,
            }}
          >
            {card.bars.map((b, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexGrow: 1,
                  // Pixels, not a percentage — see rule 2 in the header comment.
                  height: Math.max(6, Math.round((BAR_TRACK * b.heightPct) / 100)),
                  borderRadius: 3,
                  backgroundColor:
                    b.flag === "best" ? C.flagBest : b.flag === "miss" ? C.flagMistake : C.bar,
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", padding: `0 ${PAD}px`, ...label, fontSize: 17 }}>
            Taller is slower
          </div>
        </Section>
      ) : null}

      {/* ---------- setup vs previous run ---------- */}
      {card.changed ? (
        <Section title="Setup vs previous run">
          <div style={{ display: "flex", flexDirection: "column", padding: `14px ${PAD}px 6px` }}>
            {card.changed.map((r, i) => (
              <div
                key={r.label}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 24,
                  height: 66,
                  borderBottom: i === card.changed!.length - 1 ? "none" : `1px solid ${C.line}`,
                }}
              >
                <div style={{ display: "flex", fontSize: 27, color: C.mut }}>{r.label}</div>
                {/*
                  New value first, superseded value struck through after it — the order and the
                  treatment `SetupChangedSincePreviousList` already uses on screen. What you ran is
                  the answer; what you ran last time is the footnote.
                */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                  <div style={{ display: "flex", fontSize: 27, color: C.ink }}>{r.to}</div>
                  <div
                    style={{
                      display: "flex",
                      fontSize: 24,
                      color: C.faint,
                      textDecoration: "line-through",
                    }}
                  >
                    {r.from}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* ---------- notes ---------- */}
      {card.notes ? (
        <Section title="Notes">
          <div
            style={{
              display: "flex",
              width: INNER,
              margin: `18px ${PAD}px 6px`,
              padding: "22px 26px",
              backgroundColor: C.surface,
              // Neutral, not yellow: this is a quote, not an action.
              borderLeft: `4px solid ${C.line}`,
              borderRadius: "0 10px 10px 0",
              fontSize: 30,
              lineHeight: 1.5,
              color: C.ink,
            }}
          >
            {card.notes}
          </div>
        </Section>
      ) : null}

      {/* ---------- how the car felt ---------- */}
      {card.rating != null ? (
        <Section title="How the car felt">
          <div style={{ display: "flex", alignItems: "center", gap: 18, padding: `22px ${PAD}px 0` }}>
            <div style={{ ...label, display: "flex" }}>Overall</div>
            {/* The rating and trait instruments are the sanctioned yellow — they mirror the app's
                own controls, where yellow fills a magnitude rather than marking an action. */}
            <div style={{ display: "flex", gap: 6 }}>
              {Array.from({ length: 10 }, (_, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    backgroundColor: i < card.rating! ? C.primary : C.line,
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", fontSize: 27, color: C.ink }}>{card.rating}/10</div>
          </div>
        </Section>
      ) : null}

      {card.traits ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: `24px ${PAD}px 6px` }}>
          {card.traits.map((t) => (
            <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 20, height: 66 }}>
              <div style={{ ...label, display: "flex", width: 210, fontSize: 17 }}>{t.label}</div>
              <div style={{ display: "flex", flexGrow: 1, flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div style={{ ...label, display: "flex", fontSize: 15 }}>{t.neg}</div>
                  <div style={{ ...label, display: "flex", fontSize: 15 }}>{t.pos}</div>
                </div>
                {/* The lane, with the driver's dot on it: a filled run, the dot, then the rest. */}
                <div style={{ display: "flex", alignItems: "center", height: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      width: Math.round(((t.value + 3) / 6) * (INNER - 230 - 20)),
                      height: 4,
                      backgroundColor: C.line,
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      backgroundColor: t.value === 0 ? C.faint : C.primary,
                    }}
                  />
                  <div style={{ display: "flex", flexGrow: 1, height: 4, backgroundColor: C.line }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* ---------- the footer: the only way back to the app ---------- */}
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `26px ${PAD}px`,
          borderTop: `1px solid ${C.line}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", width: 32, height: 32, borderRadius: 7, backgroundColor: C.primary }} />
          <div style={{ display: "flex", fontSize: 27, color: C.ink }}>{PRODUCT_NAME}</div>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: C.faint }}>{BRAND_DOMAIN}</div>
      </div>
    </div>
  );
}

export function renderRunCard(card: ShareRunCard): ImageResponse {
  return new ImageResponse(<RunCard card={card} />, {
    width: CARD_WIDTH,
    height: card.height,
    // The card is a snapshot of a saved run; it only changes when the run does.
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
