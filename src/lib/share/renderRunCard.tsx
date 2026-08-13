import "server-only";

import type { ReactNode } from "react";
import { ImageResponse } from "next/og";
import { BRAND_DOMAIN, PRODUCT_NAME } from "@/lib/brand/brandNames";
import {
  CARD_WIDTH,
  TRACE,
  type ShareFeel,
  type ShareRunCard,
  type ShareWell,
} from "@/lib/share/shareCardModel";
import { SHARE_DARK } from "@/lib/share/shareTheme";
import { FONT_DATA, FONT_DISPLAY, FONT_UI, shareCardFonts } from "@/lib/share/shareFonts";
import { MARK_PATH, MARK_VIEWBOX, markWidth } from "@/lib/share/brandMark";

/**
 * Draws the picture a driver hands to Messenger.
 *
 * It is the expanded session view minus the video panel: the same eyebrows, the same instrument
 * wells, the same lap chips and trace, the same setup diff, the same rating bands and corner
 * balance. A driver who knows the app should recognise it instantly — which is why almost every
 * block below names the on-screen component it mirrors.
 *
 * `next/og` (satori) rather than a headless browser. Three real fonts are bundled and passed in
 * (`shareFonts.ts`); before that the card ran on one weight of the compiled Geist, so
 * `fontWeight: 700` rendered identically to 400 and the whole hierarchy was size and colour.
 *
 * Every colour comes from `shareTheme.ts`, which mirrors `globals.css`. Nothing in this file may
 * introduce a literal hex — that is how the first version ended up cool-slate against the app's
 * warm charcoal, close enough to typecheck and wrong enough to look like a different product.
 *
 * Satori is not a browser, and four of its rules have bitten here:
 *
 *   1. **A React Fragment is not transparent.** Satori wraps the children of a `<>…</>` in an
 *      implicit box that defaults to `flexDirection: row`. Every `<Band> + content` pair written
 *      as a fragment came out side by side — the section label vertically centred to the LEFT of
 *      its own content, which then ran off the right edge. Hence `<Section>`: one real element,
 *      explicitly a column. Do not reintroduce a fragment here.
 *   2. **Percentage heights need a resolved parent**, so every bar and tile is given pixel heights.
 *   3. **Runs of spaces collapse**, so separators have to be real characters, not padding spaces.
 *   4. **Every element needs an explicit `display`.** A bare `<div>` with more than one child
 *      throws; satori will not infer it.
 *
 * And the box is fixed — overflow is CLIPPED, not scrolled — which is why `card.height` is
 * computed up front in `shareCardModel.ts`.
 */

const C = SHARE_DARK;

const PAD = 56;
const INNER = CARD_WIDTH - PAD * 2;

const col = { display: "flex", flexDirection: "column" as const };
const row = { display: "flex", flexDirection: "row" as const };

/*
 * Every text style carries an EXPLICIT line height.
 *
 * Satori's implicit default is 1.2, and `estimateCardHeight` cannot see it: the first render of
 * this card was clipped by 229px purely from lines being a fifth taller than the constants
 * assumed. Where a block's height is fixed, the renderer states it (`height:`) so the estimate is
 * right by construction rather than by luck.
 */
const ui = (
  size: number,
  weight: 400 | 500 | 600 | 700,
  color: string = C.ink,
  lineHeight = 1.2
) => ({
  display: "flex",
  fontFamily: FONT_UI,
  fontSize: size,
  fontWeight: weight,
  lineHeight,
  color,
});

const data = (size: number, weight: 400 | 500, color: string = C.ink, lineHeight = 1.2) => ({
  display: "flex",
  fontFamily: FONT_DATA,
  fontSize: size,
  fontWeight: weight,
  lineHeight,
  color,
});

/** The mark, drawn rather than fetched — satori can't reach `public/`. */
function Mark({ height }: { height: number }) {
  return (
    <svg width={markWidth(height)} height={height} viewBox={MARK_VIEWBOX}>
      <path d={MARK_PATH} fill={C.primary} />
    </svg>
  );
}

/**
 * The `Eyebrow` treatment from `panel.tsx`, at card scale: a yellow tick, then the label. Yellow
 * here is the brand mark repeating, not a state — the app's "yellow = action only" rule is about
 * controls, and a picture has none.
 *
 * One real element, explicitly a column — see rule 1 in the header comment.
 */
function Section({
  title,
  children,
  first = false,
}: {
  title: string;
  children: ReactNode;
  first?: boolean;
}) {
  return (
    <div style={{ ...col, padding: `${first ? 40 : 48}px ${PAD}px 0` }}>
      <div style={{ ...row, alignItems: "center", height: 30, gap: 14, marginBottom: 20 }}>
        <div style={{ display: "flex", width: 6, height: 30, borderRadius: 3, backgroundColor: C.primary }} />
        <div style={{ ...ui(30, 700, C.ink, 1), textTransform: "uppercase" }}>{title}</div>
      </div>
      {children}
    </div>
  );
}

/**
 * `StatWellGrid` / `StatWellCell` from `LapStatStrip.tsx`, at 2.2× scale: one hairline frame, a
 * translucent fill, and interior seams drawn as cell borders. Label left, value right, baselines
 * shared. Lap-derived figures take the mono voice; everything else is Sora, as on screen.
 */
function Wells({ rows, cols }: { rows: ShareWell[]; cols: 2 | 3 }) {
  // Pixel widths, not percentages: satori's box model does not subtract padding the way
  // `border-box` does, so `width: 33%` plus padding overflowed and clipped the third column.
  //
  // The −2 is the frame's own 1px borders. Without it two 484px cells came to exactly 968 inside
  // a 966px content box, every row wrapped to one cell, and the six session details rendered as a
  // single narrow column with half the frame empty.
  const width = Math.floor((INNER - 2) / cols);
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        width: INNER,
        overflow: "hidden",
        borderRadius: 22,
        border: `1px solid ${C.line}`,
        backgroundColor: C.wellFill,
      }}
    >
      {rows.map((r, i) => {
        const lastInRow = i % cols === cols - 1;
        const lastRow = i >= rows.length - ((rows.length % cols) || cols);
        return (
          <div
            key={r.label}
            style={{
              ...row,
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 20,
              // The last cell takes the rounding slack so the row closes on the frame.
              width: lastInRow ? INNER - 2 - width * (cols - 1) : width,
              padding: "18px 24px",
              borderRight: lastInRow ? "none" : `1px solid ${C.line}`,
              borderBottom: lastRow ? "none" : `1px solid ${C.line}`,
            }}
          >
            <div style={ui(22, 600, C.mut, 1.3)}>{r.label}</div>
            {r.lines ? (
              <div style={{ ...col, alignItems: "flex-end" }}>
                {r.lines.map((line, li) => (
                  <div key={li} style={data(24, 400, C.mut, 1.4)}>
                    {line}
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  ...(r.mono ? data(28, 500, C.ink, 1.3) : ui(28, 500, C.ink, 1.3)),
                  textAlign: "right",
                }}
              >
                {r.value}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LegendDot({ color, children }: { color: string; children: string }) {
  return (
    <div style={{ ...row, alignItems: "center", gap: 10 }}>
      <div style={{ display: "flex", width: 16, height: 16, borderRadius: 4, backgroundColor: color }} />
      <div style={ui(20, 600, C.mut)}>{children}</div>
    </div>
  );
}

/**
 * The `All laps` grid, as chips. **155px is tight on purpose** — at 26px type the times overrun
 * their slot and collide with the next chip, so the figure size and the chip width move together.
 */
function LapChips({ card }: { card: ShareRunCard }) {
  if (!card.laps) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        width: INNER,
        padding: "20px 16px",
        border: `1px solid ${C.line}`,
        borderRadius: 16,
        backgroundColor: C.recessed,
        boxShadow: `inset 0 1px 0 ${C.rim}`,
      }}
    >
      {card.laps.map((l) => {
        const fill = l.flag === "best" ? C.flagBest : l.flag === "miss" ? C.flagMistake : "transparent";
        const ring =
          l.flag === "best" ? C.flagBestRing : l.flag === "miss" ? C.flagMistakeRing : null;
        const numberInk = l.flag ? C.whiteDim : C.mut;
        const timeInk = l.flag ? C.white : C.ink;
        return (
          <div
            key={l.lapNumber}
            style={{
              ...row,
              alignItems: "baseline",
              width: 155,
              height: 39,
              padding: "3px 4px",
              borderRadius: 5,
              backgroundColor: fill,
              boxShadow: ring ? `0 0 0 1px ${ring}` : "none",
              opacity: l.excluded ? 0.45 : 1,
            }}
          >
            <div
              style={{
                ...data(23, 400, numberInk),
                width: 46,
                justifyContent: "flex-end",
                marginRight: 4,
              }}
            >
              {l.lapNumber}.
            </div>
            <div
              style={{
                ...data(23, 400, timeInk),
                textDecoration: l.excluded ? "line-through" : "none",
              }}
            >
              {l.time}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * `LapTimeGraph`, at card scale. Slower plots HIGHER — the geometry comes from the model so this
 * cannot drift from the screen. Clamped laps are triangles pinned to the top edge, as on screen.
 *
 * The axis labels are absolutely-positioned HTML, not `<text>`: **satori refuses `<text>` nodes
 * outright** ("please convert them to <path>"), so the marks live in the SVG and every word lives
 * outside it. Both are placed from the same coordinates the model computed, so they stay aligned.
 */
function Trace({ card }: { card: ShareRunCard }) {
  const t = card.trace;
  if (!t) return null;
  const X_LABEL_W = 60;
  return (
    <div style={{ display: "flex", position: "relative", width: TRACE.width, height: TRACE.height }}>
      <svg width={TRACE.width} height={TRACE.height} viewBox={`0 0 ${TRACE.width} ${TRACE.height}`}>
        {t.gridlines.map((g, i) => (
          <line
            key={`g${i}`}
            x1={TRACE.padLeft}
            x2={TRACE.width - TRACE.padRight}
            y1={g.y}
            y2={g.y}
            stroke={C.line}
            strokeWidth={1}
          />
        ))}
        <polyline
          points={t.points}
          fill="none"
          stroke={C.mut}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity={0.9}
        />
        {t.dots.map((d, i) => {
          const fill = d.flag === "best" ? C.bestLap : d.flag === "miss" ? C.loss : C.mut;
          if (d.clamped) {
            return (
              <path
                key={`d${i}`}
                d={`M ${d.x} ${d.y - 9} L ${d.x + 8} ${d.y + 7} L ${d.x - 8} ${d.y + 7} Z`}
                fill={fill}
                stroke={C.bg}
                strokeWidth={2}
              />
            );
          }
          return (
            <circle
              key={`d${i}`}
              cx={d.x}
              cy={d.y}
              r={d.flag ? 7 : 5}
              fill={fill}
              stroke={C.bg}
              strokeWidth={2}
            />
          );
        })}
      </svg>

      {t.gridlines.map((g, i) => (
        <div
          key={`gl${i}`}
          style={{
            ...data(20, 400, C.faint),
            position: "absolute",
            left: 0,
            top: g.y - 13,
            width: TRACE.padLeft - 12,
            justifyContent: "flex-end",
          }}
        >
          {g.label}
        </div>
      ))}
      {t.xLabels.map((x, i) => (
        <div
          key={`x${i}`}
          style={{
            ...data(20, 400, C.faint),
            position: "absolute",
            left: Math.round(x.x - X_LABEL_W / 2),
            top: TRACE.height - 28,
            width: X_LABEL_W,
            justifyContent: "center",
          }}
        >
          {x.label}
        </div>
      ))}
    </div>
  );
}

/** The lap chips, the trace and the legend they share. Drawn under whatever heading owns them. */
function LapBlock({ card, spaced }: { card: ShareRunCard; spaced: boolean }) {
  if (!card.laps && !card.trace) return null;
  return (
    <div style={{ ...col, marginTop: spaced ? 18 : 0 }}>
      <LapChips card={card} />
      {card.trace ? (
        <div style={{ ...col, marginTop: card.laps ? 22 : 0 }}>
          <Trace card={card} />
        </div>
      ) : null}
      <div style={{ ...row, gap: 32, alignItems: "center", marginTop: 8 }}>
        <LegendDot color={C.flagBest}>Best lap</LegendDot>
        <LegendDot color={C.flagMistake}>Mistake — well off the median</LegendDot>
      </div>
    </div>
  );
}

/**
 * `SetupChangedSincePreviousList`, at scale. New value first, superseded value struck through
 * after it — the order the app already uses. What you ran is the answer; what you ran last time
 * is the footnote.
 */
function SetupDiff({ card }: { card: ShareRunCard }) {
  if (!card.changed) return null;
  const NOW_W = 200;
  const WAS_W = 190;
  const cell = (extra: object) => ({ ...row, alignItems: "baseline", ...extra });
  return (
    <div
      style={{
        ...col,
        width: INNER,
        overflow: "hidden",
        borderRadius: 12,
        border: `1px solid ${C.line}`,
        backgroundColor: C.diffFill,
      }}
    >
      <div style={{ ...row, backgroundColor: C.diffHead, borderBottom: `1px solid ${C.line}` }}>
        <div
          style={{
            ...ui(20, 600, C.faint),
            flexGrow: 1,
            padding: "14px 8px 14px 28px",
            letterSpacing: 1.2,
            textTransform: "uppercase",
          }}
        >
          Parameter
        </div>
        <div
          style={{
            ...ui(20, 600, C.faint),
            width: NOW_W,
            padding: "14px 16px",
            justifyContent: "flex-end",
            letterSpacing: 1.2,
            textTransform: "uppercase",
          }}
        >
          Now
        </div>
        <div
          style={{
            ...ui(20, 600, C.faint),
            width: WAS_W,
            padding: "14px 28px 14px 16px",
            justifyContent: "flex-end",
            letterSpacing: 1.2,
            textTransform: "uppercase",
          }}
        >
          Was
        </div>
      </div>
      {card.changed.map((r, i) => (
        <div
          key={r.label}
          style={{
            ...row,
            borderTop: i === 0 ? "none" : `1px solid ${C.lineSoft}`,
          }}
        >
          <div style={cell({ ...ui(28, 400, C.mut), flexGrow: 1, padding: "14px 8px 14px 28px" })}>
            {r.label}
          </div>
          <div
            style={cell({
              ...ui(28, 400),
              width: NOW_W,
              padding: "14px 16px",
              justifyContent: "flex-end",
            })}
          >
            {r.to}
          </div>
          <div
            style={cell({
              ...ui(26, 400, C.faint),
              width: WAS_W,
              padding: "14px 28px 14px 16px",
              justifyContent: "flex-end",
              textDecoration: "line-through",
            })}
          >
            {r.from}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Balance tile heights, from `HandlingAssessmentFields`'s `BALANCE_TILE_H`, at card scale. */
const BALANCE_TILE_H: Record<1 | 2 | 3, number> = { 1: 11, 2: 20, 3: 31 };
/** Notable staircase, from `SEVERITY_STEP_H`, at card scale. */
const NOTABLE_STEP_H: Record<1 | 2 | 3, number> = { 1: 7, 2: 13, 3: 22 };

const SEVERITY_WORD: Record<1 | 2 | 3, string> = { 1: "mild", 2: "moderate", 3: "severe" };

/**
 * One pole of one phase. The tiles climb toward the OUTER edge, so the lit run grows out of the
 * centre seam and the silhouette says which way the car went before any word does.
 *
 * Read-back uses the monochrome ink ramp, never the accent: the capture control fills in yellow,
 * and a stored record must never be mistakable for a live one.
 */
function BalanceZone({ sign, value, width }: { sign: -1 | 1; value: number; width: number }) {
  const magnitude = value !== 0 && Math.sign(value) === sign ? (Math.abs(value) as 1 | 2 | 3) : 0;
  const levels: (1 | 2 | 3)[] = sign < 0 ? [3, 2, 1] : [1, 2, 3];
  const word = magnitude > 0 ? SEVERITY_WORD[magnitude as 1 | 2 | 3] : null;
  return (
    <div
      style={{
        ...col,
        // An explicit width, not a stretchy child: satori will not stretch a flex column to its
        // parent, so a zone without one shrank to its tiles and left the row's seam colour
        // showing through as a slab beside every staircase.
        width,
        justifyContent: "center",
        gap: 8,
        padding: "14px 22px",
        backgroundColor: C.recessed,
        alignItems: sign < 0 ? "flex-end" : "flex-start",
      }}
    >
      {/* The word keeps its line whether or not it shows, exactly as the capture control reserves
          it — so every phase row is the same height and the estimate can know what that is. */}
      <div style={{ ...ui(20, 600, C.ink, 1.2), height: 24, alignItems: "center" }}>{word ?? ""}</div>
      <div style={{ ...row, alignItems: "flex-end", gap: 6 }}>
        {levels.map((level) => (
          <div
            key={level}
            style={{
              display: "flex",
              width: 26,
              height: BALANCE_TILE_H[level],
              borderRadius: 4,
              backgroundColor: level <= magnitude ? C.inkRamp[level - 1] : C.muted,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function CornerBalance({ feel }: { feel: ShareFeel }) {
  if (!feel.balance) return null;
  const LABEL_W = 106;
  const PIP_W = 66;
  // Frame width minus the felt panel's padding, its own 1px borders, and the three 1px seams.
  const TRACK = INNER - 52 - 2;
  const zoneW = Math.floor((TRACK - LABEL_W - PIP_W - 3) / 2);
  const zoneWLast = TRACK - LABEL_W - PIP_W - 3 - zoneW;
  return (
    <div
      style={{
        ...col,
        overflow: "hidden",
        borderRadius: 12,
        border: `1px solid ${C.line}`,
        backgroundColor: C.recessed,
      }}
    >
      {/* Said once, over the column it names — not twice per row down the card. */}
      <div style={{ ...row, borderBottom: `1px solid ${C.line}`, padding: "14px 0" }}>
        <div style={{ display: "flex", width: LABEL_W + 1 }} />
        <div
          style={{
            ...ui(20, 700, C.faint),
            width: zoneW + 1,
            paddingLeft: 22,
            letterSpacing: 1.2,
            textTransform: "uppercase",
          }}
        >
          Understeer
        </div>
        <div style={{ display: "flex", width: PIP_W + 1 }} />
        <div
          style={{
            ...ui(20, 700, C.faint),
            width: zoneWLast,
            paddingRight: 22,
            justifyContent: "flex-end",
            letterSpacing: 1.2,
            textTransform: "uppercase",
          }}
        >
          Oversteer
        </div>
      </div>
      {/* The seams are the row's own background showing through 1px margins between the cells —
          the same trick `BalanceInstrument` plays with a grid gap over a bordered container. */}
      {feel.balance.map((b, i) => (
        <div
          key={b.label}
          style={{ ...row, backgroundColor: C.line, paddingTop: i === 0 ? 0 : 1 }}
        >
          <div
            style={{
              ...ui(24, 600),
              width: LABEL_W,
              alignItems: "center",
              paddingLeft: 22,
              backgroundColor: C.recessed,
              marginRight: 1,
            }}
          >
            {b.label}
          </div>
          <BalanceZone sign={-1} value={b.value} width={zoneW} />
          {/* Neutral is an answer, not a gap: an enlarged pip says "I checked, it was fine". */}
          <div
            style={{
              display: "flex",
              width: PIP_W,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: C.recessed,
              marginLeft: 1,
              marginRight: 1,
            }}
          >
            <div
              style={{
                display: "flex",
                width: b.value === 0 ? 14 : 8,
                height: b.value === 0 ? 14 : 8,
                borderRadius: 7,
                backgroundColor: b.value === 0 ? C.mut : C.line,
              }}
            />
          </div>
          <BalanceZone sign={1} value={b.value} width={zoneWLast} />
        </div>
      ))}
    </div>
  );
}

/**
 * `CarHandlingRatingQuickPick` + `HandlingAssessmentFields`'s read-only branch. Bands come from
 * `CAR_RATING_BANDS` through the model, never hard-coded here — the grouping is founder-locked
 * and lives in one place.
 */
function Felt({ feel }: { feel: ShareFeel }) {
  const bandColor = (caption: string) => C.rating[caption] ?? C.mut;
  const ratingInk = feel.bandCaption ? bandColor(feel.bandCaption) : C.faint;
  // Sized by how many numbers each band holds, so every cell stays equal width — the 3/3/2/2 grid.
  const cellW = Math.floor((INNER - 150 - 28 - 36) / 10);

  return (
    <div style={col}>
      <div style={ui(24, 500, C.mut)}>Car handling rating</div>
      <div style={{ ...row, alignItems: "flex-end", gap: 28, marginTop: 18 }}>
        <div style={{ ...row, gap: 12 }}>
          {feel.bands.map((band) => (
            <div key={band.caption} style={col}>
              <div style={{ ...row, gap: 2, overflow: "hidden", borderRadius: 8 }}>
                {band.ratings.map((n) => {
                  const selected = feel.rating === n;
                  return (
                    <div
                      key={n}
                      style={{
                        display: "flex",
                        width: cellW,
                        height: 72,
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: FONT_UI,
                        fontSize: 30,
                        fontWeight: 600,
                        backgroundColor: selected
                          ? bandColor(band.caption)
                          : band.active
                            ? C.muted
                            : C.recessed,
                        color: selected ? C.bg : band.active ? C.ink : C.mut,
                      }}
                    >
                      {n}
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  ...ui(22, 600, band.active ? bandColor(band.caption) : C.faint),
                  marginTop: 8,
                  width: band.ratings.length * cellW + (band.ratings.length - 1) * 2,
                  justifyContent: "center",
                }}
              >
                {band.caption}
              </div>
            </div>
          ))}
        </div>
        {/* Same height as the band column, so the two bottom-align and the row is a known size. */}
        <div
          style={{
            ...col,
            width: 150,
            height: 107,
            alignItems: "flex-end",
            justifyContent: "flex-end",
          }}
        >
          <div style={{ ...row, alignItems: "baseline" }}>
            <div style={{ ...ui(68, 600, ratingInk, 1), letterSpacing: -2 }}>
              {feel.rating ?? "—"}
            </div>
            {feel.rating != null ? <div style={ui(26, 500, C.faint, 1)}> / 10</div> : null}
          </div>
          <div style={{ ...ui(24, 600, C.mut, 1.2), marginTop: 6 }}>
            {feel.bandCaption ?? "Not rated"}
          </div>
        </div>
      </div>

      {feel.balance || feel.notables.length > 0 ? (
        <div
          style={{
            ...col,
            marginTop: 36,
            padding: 26,
            borderRadius: 16,
            border: `1px solid ${C.line}`,
            backgroundColor: C.deep,
          }}
        >
          {feel.balance ? (
            <div style={col}>
              <div style={{ ...ui(24, 500, C.mut), marginBottom: 16 }}>Corner balance</div>
              <CornerBalance feel={feel} />
            </div>
          ) : null}
          {feel.notables.length > 0 ? (
            <div style={{ ...col, marginTop: feel.balance ? 28 : 0 }}>
              <div style={{ ...ui(24, 500, C.mut), marginBottom: 16 }}>Notable</div>
              <div style={{ display: "flex", flexWrap: "wrap", width: INNER - 52 - 2 }}>
                {feel.notables.map((n, i) => {
                  const flagged = n.severity != null;
                  const tileW = Math.floor((INNER - 52 - 2 - 12) / 2);
                  // Three steps and their two 6px gaps, inside the tile's 20px padding and border.
                  const stepW = Math.floor((tileW - 42 - 12) / 3);
                  return (
                    <div
                      key={n.label}
                      style={{
                        ...col,
                        gap: 16,
                        width: tileW,
                        padding: 20,
                        marginRight: i % 2 === 0 ? 12 : 0,
                        marginBottom: 12,
                        borderRadius: 12,
                        border: `1px solid ${flagged ? C.lossBorder : C.line}`,
                        backgroundColor: flagged ? C.lossFill : C.recessed,
                      }}
                    >
                      <div style={{ ...ui(24, 600, flagged ? C.ink : C.mut, 1.2), height: 29 }}>
                        {n.label}
                      </div>
                      <div style={{ ...row, alignItems: "flex-end", height: 22, gap: 6 }}>
                        {([1, 2, 3] as const).map((s) => (
                          <div
                            key={s}
                            style={{
                              display: "flex",
                              width: stepW,
                              height: NOTABLE_STEP_H[s],
                              borderRadius: 3,
                              backgroundColor:
                                n.severity != null && s <= n.severity ? C.loss : C.muted,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Report's masthead. Hero carries its own inside the gradient block. */
function Masthead() {
  return (
    <div
      style={{
        ...row,
        alignItems: "center",
        justifyContent: "space-between",
        padding: `44px ${PAD}px`,
        borderBottom: `1px solid ${C.line}`,
      }}
    >
      <div style={{ ...row, alignItems: "center", gap: 22 }}>
        <Mark height={44} />
        <div style={{ display: "flex", width: 1, height: 36, backgroundColor: C.line }} />
        <div style={{ ...ui(24, 600, C.mut, 1), letterSpacing: 6.24 }}>TRACKSIDE</div>
      </div>
      <div style={data(24, 400, C.faint, 1)}>SESSION REPORT</div>
    </div>
  );
}

function Footer() {
  return (
    <div
      style={{
        ...row,
        marginTop: 48,
        alignItems: "center",
        justifyContent: "space-between",
        padding: `44px ${PAD}px`,
        borderTop: `1px solid ${C.line}`,
      }}
    >
      <div style={{ ...row, alignItems: "center", gap: 20 }}>
        <Mark height={38} />
        <div style={ui(28, 500, C.ink, 1)}>{PRODUCT_NAME}</div>
      </div>
      <div style={ui(26, 400, C.faint, 1)}>{BRAND_DOMAIN}</div>
    </div>
  );
}

/** Hero — the lap first, big enough to survive a chat thumbnail. */
function HeroHead({ card }: { card: ShareRunCard }) {
  const best = card.tiles[0]?.value ?? "—";
  return (
    <div style={col}>
      <div
        style={{
          ...col,
          padding: PAD,
          // The one gradient on the card: the page ground falling into the card ground.
          backgroundImage: `linear-gradient(180deg, ${C.pageTop} 0%, ${C.bg} 100%)`,
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        <div style={{ ...row, alignItems: "center", height: 52, justifyContent: "space-between" }}>
          <div style={{ ...row, alignItems: "center", gap: 22 }}>
            <Mark height={52} />
            <div style={{ ...ui(26, 600, C.mut, 1), letterSpacing: 6.76 }}>TRACKSIDE</div>
          </div>
          <div style={data(26, 400, C.faint, 1)}>{card.dateStamp}</div>
        </div>

        {/* Ink, not yellow: the best lap is data, and yellow is the brand's, not a value's. */}
        <div style={{ ...row, alignItems: "flex-end", gap: 28, marginTop: 60 }}>
          <div style={{ ...data(168, 500, C.ink, 0.86), letterSpacing: -6.7 }}>{best}</div>
          <div style={{ ...col, paddingBottom: 18 }}>
            <div style={{ ...ui(26, 700, C.faint, 1), letterSpacing: 4.68, textTransform: "uppercase" }}>
              Best lap
            </div>
          </div>
        </div>
        {/* The JRC cut — the brand's one flourish here. */}
        <div
          style={{
            display: "flex",
            marginTop: 16,
            height: 6,
            width: 280,
            backgroundColor: C.primary,
            transform: "skewX(-21deg)",
          }}
        />

        {card.driverName ? (
          <div
            style={{
              display: "flex",
              marginTop: 40,
              fontFamily: FONT_DISPLAY,
              fontSize: 52,
              fontWeight: 700,
              lineHeight: 1.15,
              color: C.ink,
              letterSpacing: -0.5,
            }}
          >
            {card.driverName}
          </div>
        ) : null}
        {card.heroLines.length > 0 ? (
          <div style={{ ...col, marginTop: 12 }}>
            {card.heroLines.map((line, i) => (
              <div key={i} style={ui(32, 400, C.mut, 1.45)}>
                {line}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* The three figures the hero doesn't already say. */}
      <div style={{ ...row, borderBottom: `1px solid ${C.line}` }}>
        {card.tiles.slice(1).map((t, i) => (
          <div
            key={t.label}
            style={{
              ...col,
              width: i === 2 ? CARD_WIDTH - 2 * Math.floor(CARD_WIDTH / 3) : Math.floor(CARD_WIDTH / 3),
              padding: "32px 40px",
              borderRight: i === 2 ? "none" : `1px solid ${C.line}`,
            }}
          >
            <div style={ui(22, 600, C.mut, 1.2)}>{t.label}</div>
            {/* `Laps / time` drops to 44px and refuses to wrap: at 54 it breaks across two lines. */}
            <div
              style={{
                ...data(t.label === "Laps / time" ? 44 : 54, 500),
                marginTop: 12,
                whiteSpace: "nowrap",
              }}
            >
              {t.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * `.page-title`'s rule, at card scale: a hairline track the width of the title with one yellow
 * sector skewed −21° sitting on it — the same brand cut the app's own page titles carry.
 *
 * Satori has no `width: fit-content` that a sibling can read, so the track's width is estimated
 * from the title's length at 76px in the display face. Being a little short or long reads as a
 * design choice; the alternative — a fixed width — reads as a mistake next to a short title.
 */
function TitleRule({ title }: { title: string }) {
  const width = Math.max(240, Math.min(INNER, Math.round(title.length * 40)));
  const sector = Math.round(width * 0.2);
  return (
    <div style={{ ...row, marginTop: 14, width, height: 7 }}>
      <div style={{ display: "flex", width: sector, height: 4, marginTop: 2, backgroundColor: C.line }} />
      <div
        style={{
          display: "flex",
          width: sector,
          height: 7,
          backgroundColor: C.primary,
          transform: "skewX(-21deg)",
        }}
      />
      <div
        style={{
          display: "flex",
          width: width - sector * 2,
          height: 4,
          marginTop: 2,
          backgroundColor: C.line,
        }}
      />
    </div>
  );
}

/** Report — session identity first, for the team chat. */
function ReportHead({ card }: { card: ShareRunCard }) {
  return (
    <div style={col}>
      <Masthead />
      <div style={{ ...col, padding: `48px ${PAD}px 0` }}>
        {card.eyebrow ? (
          <div
            style={{
              ...ui(22, 600, C.faint, 1),
              height: 22,
              letterSpacing: 3.96,
              textTransform: "uppercase",
            }}
          >
            {card.eyebrow}
          </div>
        ) : null}
        {/* `.page-title`'s rule, at card scale: a hairline track with one yellow sector on it. */}
        <div style={{ ...col, marginTop: card.eyebrow ? 16 : 0 }}>
          <div
            style={{
              display: "flex",
              fontFamily: FONT_DISPLAY,
              fontSize: 76,
              fontWeight: 700,
              color: C.ink,
              lineHeight: 1.1,
              letterSpacing: -0.76,
            }}
          >
            {card.title}
          </div>
          <TitleRule title={card.title} />
          <div style={{ display: "flex", height: 11 }} />
        </div>
        {card.subtitle ? (
          <div style={{ ...ui(30, 400, C.mut, 1.4), marginTop: 16 }}>{card.subtitle}</div>
        ) : null}
      </div>

      <div style={{ ...col, margin: `40px ${PAD}px 0` }}>
        <div
          style={{
            ...row,
            width: INNER,
            overflow: "hidden",
            borderRadius: 22,
            border: `1px solid ${C.line}`,
            backgroundColor: C.wellFill,
          }}
        >
          {card.tiles.map((t, i) => (
            <div
              key={t.label}
              style={{
                ...col,
                width:
                  i === 3
                    ? INNER - 2 - 3 * Math.floor((INNER - 2) / 4)
                    : Math.floor((INNER - 2) / 4),
                padding: "24px 22px",
                borderRight: i === 3 ? "none" : `1px solid ${C.line}`,
              }}
            >
              <div style={ui(20, 600, C.mut, 1.2)}>{t.label}</div>
              <div
                style={{
                  ...data(t.label === "Laps / time" ? 40 : 48, 500),
                  marginTop: 10,
                  whiteSpace: "nowrap",
                }}
              >
                {t.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RunCard({ card }: { card: ShareRunCard }) {
  const report = card.style === "report";
  const lapHeading = card.laps ? "Every lap" : "Lap trace";

  return (
    <div
      style={{
        ...col,
        width: CARD_WIDTH,
        height: card.height,
        backgroundColor: C.bg,
        color: C.ink,
        fontFamily: FONT_UI,
      }}
    >
      {report ? <ReportHead card={card} /> : <HeroHead card={card} />}

      {report && card.details.length > 0 ? (
        <Section title="Session details">
          <Wells rows={card.details} cols={2} />
        </Section>
      ) : null}

      {report ? (
        <Section title="Laptimes">
          <div style={col}>
            <Wells rows={card.lapWells} cols={3} />
            <LapBlock card={card} spaced />
          </div>
        </Section>
      ) : card.laps || card.trace ? (
        <Section title={lapHeading}>
          <LapBlock card={card} spaced={false} />
        </Section>
      ) : null}

      {card.changed ? (
        <Section title="Setup vs previous run">
          <SetupDiff card={card} />
        </Section>
      ) : null}

      {card.notes ? (
        <Section title="Notes">
          {/* No quote bar — the eyebrow already marks the section. */}
          <div style={{ ...ui(30, 400), width: INNER, lineHeight: 1.6 }}>{card.notes}</div>
        </Section>
      ) : null}

      {card.feel ? (
        <Section title="How the car felt">
          <Felt feel={card.feel} />
        </Section>
      ) : null}

      <Footer />
    </div>
  );
}

export function renderRunCard(card: ShareRunCard): ImageResponse {
  return new ImageResponse(<RunCard card={card} />, {
    width: CARD_WIDTH,
    height: card.height,
    fonts: shareCardFonts(),
    // The card is a snapshot of a saved run; it only changes when the run does.
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
