import "server-only";

import type { ReactNode } from "react";
import satori from "satori";
import sharp from "sharp";
import { BRAND_DOMAIN } from "@/lib/brand/brandNames";
import {
  CARD_WIDTH,
  TRACE,
  type ShareFeel,
  type ShareLap,
  type ShareRunCard,
  type ShareTraceBox,
  type ShareWell,
} from "@/lib/share/shareCardModel";
import { shareCardFonts } from "@/lib/share/shareFonts";
import { fitSoraSize, soraWidth } from "@/lib/share/textMeasure";
import {
  Band,
  Card,
  Figure,
  Lockup,
  P,
  Sentinel,
  TitleRule,
  Trace,
  TraceKey,
  col,
  cropSvgHeight,
  eyebrow,
  row,
  sentinelTop,
  sora,
} from "@/lib/share/paperParts";

/**
 * The long picture — the whole run, for a team chat — on paper, as the app's run page draws it:
 * a page title seated on its hairline and yellow sector, then ONE white card whose first section
 * opens with the band and whose later sections are headed by their words alone.
 *
 * Replaces the dark card of 2026-08-13 (founder, 2026-09-25: "the old styling of the app").
 *
 * **Height is measured, not predicted.** The page is laid out into a canvas far taller than it
 * needs, the {@link Sentinel} at its foot says where the content ended, and the SVG is cut there
 * before a pixel is painted. The old card predicted its height from per-block constants and a
 * font-size guess, and clipped its own footer whenever a note wrapped one line more than expected.
 */

const W = CARD_WIDTH;
const GUTTER = 44;
const CARD_W = W - GUTTER * 2;
/** The card's content box: its 2px edges and 38px of padding either side. */
const PAD = 38;
const INNER = CARD_W - 4 - PAD * 2;
/** On-screen px → picture px. The phone's 390pt page is this picture's 1080px. */
const S = 2.7;

/** The trace's box in the report — the model's default, which is sized to this card's content. */
export const REPORT_TRACE: ShareTraceBox = TRACE;
if (TRACE.width !== INNER) {
  throw new Error(`The report's trace box (${TRACE.width}px) no longer matches its card (${INNER}px).`);
}

/** A mid-card heading: the words alone, no rule (`.eyebrow-root`, 2026-09-15). */
function Heading({ children, first = false }: { children: string; first?: boolean }) {
  return <div style={{ ...eyebrow(30), marginTop: first ? 0 : 50, marginBottom: 20 }}>{children}</div>;
}

/**
 * `StatWellGrid` + `StatWellCell` on a phone: one hairline frame, seams between cells, the label
 * over the value. `cols` cells a row; a short last row keeps its seams by padding with empties.
 */
function Wells({ wells, cols, width = INNER }: { wells: ShareWell[]; cols: 2 | 3 | 4; width?: number }) {
  const cellW = Math.floor((width - 4) / cols);
  const filler = (cols - (wells.length % cols)) % cols;
  const cells: (ShareWell | null)[] = [...wells, ...Array.from({ length: filler }, () => null)];
  const rows = Math.ceil(cells.length / cols);
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        width,
        borderRadius: 12 * S,
        border: `2px solid ${P.line}`,
        backgroundColor: P.well,
      }}
    >
      {cells.map((w, i) => {
        const colIndex = i % cols;
        const rowIndex = Math.floor(i / cols);
        return (
          <div
            key={i}
            style={{
              ...col,
              width: colIndex === cols - 1 ? width - 4 - cellW * (cols - 1) : cellW,
              padding: `${Math.round(8 * S)}px ${Math.round(12 * S)}px ${Math.round(9 * S)}px`,
              borderLeft: colIndex === 0 ? "none" : `2px solid ${P.line}`,
              borderTop: rowIndex === 0 ? "none" : `2px solid ${P.line}`,
              minHeight: rows > 0 ? 0 : undefined,
            }}
          >
            {w ? (
              <div style={col}>
                <div style={sora(12 * S, 600, P.mut, 1.3)}>{w.label}</div>
                {w.lines ? (
                  <div style={{ ...col, marginTop: 6 }}>
                    {w.lines.map((line, li) => (
                      <div key={li} style={sora(12.5 * S, 500, P.ink, 1.35)}>
                        {line}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ ...sora(15 * S, 500, P.ink, 1.3), marginTop: 6 }}>{w.value}</div>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The `All laps` grid: number, then time, three to a row as on a phone; best in purple, mistakes
 * in red. Four to a row was tried and a flagged `10. 19.610s` ran into its neighbour.
 */
function LapChips({ laps }: { laps: ShareLap[] }) {
  const perRow = 3;
  // Inside the well's 18px padding AND its 2px edges: satori sizes boxes border-box, so leaving
  // the edges out made three chips 4px too wide and the grid quietly fell to two a row.
  const chipW = Math.floor((INNER - 36 - 4) / perRow);
  const size = 13.5 * S;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        width: INNER,
        padding: "18px 18px 14px",
        borderRadius: 12 * S,
        border: `2px solid ${P.line}`,
        backgroundColor: P.well,
      }}
    >
      {laps.map((l) => {
        const flagged = l.flag != null;
        const fill = l.flag === "best" ? P.flagBest : l.flag === "miss" ? P.flagMistake : "transparent";
        return (
          <div key={l.lapNumber} style={{ ...row, width: chipW, padding: "4px 0" }}>
            <div
              style={{
                ...row,
                alignItems: "flex-end",
                padding: "6px 14px 6px 6px",
                borderRadius: 10,
                backgroundColor: fill,
                opacity: l.excluded ? 0.5 : 1,
              }}
            >
              <div style={{ ...sora(size, 500, flagged ? "rgba(255,255,255,0.8)" : P.mut, 1), width: size * 1.7, justifyContent: "flex-end", marginRight: 10 }}>
                {`${l.lapNumber}.`}
              </div>
              <Figure
                text={l.time}
                size={size}
                weight={500}
                color={flagged ? P.white : P.ink}
                style={l.excluded ? { textDecoration: "line-through" } : undefined}
              />
              <div style={{ ...sora(size, 500, flagged ? "rgba(255,255,255,0.8)" : P.mut, 1), marginLeft: 2 }}>s</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** `SetupChangedSincePreviousList`: new value first, what it replaced struck through after it. */
function SetupDiff({ rows }: { rows: { label: string; from: string; to: string }[] }) {
  const NOW_W = 210;
  const WAS_W = 210;
  const head = (text: string, width: number | undefined, align: "flex-start" | "flex-end") => (
    <div style={{ ...eyebrow(26, P.faint), ...(width ? { width } : { flexGrow: 1 }), justifyContent: align, padding: "0 4px" }}>
      {text}
    </div>
  );
  return (
    <div style={{ ...col, width: INNER, borderRadius: 12 * S, border: `2px solid ${P.line}` }}>
      <div
        style={{
          ...row,
          padding: "18px 28px",
          backgroundColor: P.band,
          borderBottom: `2px solid ${P.line}`,
          borderTopLeftRadius: 12 * S - 2,
          borderTopRightRadius: 12 * S - 2,
        }}
      >
        {head("Parameter", undefined, "flex-start")}
        {head("Now", NOW_W, "flex-end")}
        {head("Was", WAS_W, "flex-end")}
      </div>
      {rows.map((r, i) => (
        <div
          key={r.label}
          style={{ ...row, alignItems: "baseline", padding: "20px 28px", borderTop: i === 0 ? "none" : `2px solid ${P.line}` }}
        >
          <div style={{ ...sora(13.5 * S, 500, P.mut, 1.3), flexGrow: 1, flexShrink: 1, paddingRight: 16 }}>{r.label}</div>
          <div style={{ ...sora(14 * S, 500, P.ink, 1.3), width: NOW_W, justifyContent: "flex-end", padding: "0 4px" }}>
            {r.to}
          </div>
          <div
            style={{
              ...sora(13 * S, 400, P.faint, 1.3),
              width: WAS_W,
              justifyContent: "flex-end",
              padding: "0 4px",
              textDecoration: "line-through",
            }}
          >
            {r.from}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Balance tile heights, from `HandlingAssessmentFields`'s `BALANCE_TILE_H`, at picture scale. */
const BALANCE_TILE_H: Record<1 | 2 | 3, number> = { 1: 11, 2: 20, 3: 31 };
/** Notable staircase, from `SEVERITY_STEP_H`, at picture scale. */
const NOTABLE_STEP_H: Record<1 | 2 | 3, number> = { 1: 7, 2: 13, 3: 22 };
const SEVERITY_WORD: Record<1 | 2 | 3, string> = { 1: "mild", 2: "moderate", 3: "severe" };

/**
 * One pole of one phase. Tiles climb toward the OUTER edge, so the lit run grows out of the centre
 * seam. Read-back is the monochrome ink ramp, never the accent the capture control fills with.
 */
function BalanceZone({ sign, value, width }: { sign: -1 | 1; value: number; width: number }) {
  const magnitude = value !== 0 && Math.sign(value) === sign ? (Math.abs(value) as 1 | 2 | 3) : 0;
  const levels: (1 | 2 | 3)[] = sign < 0 ? [3, 2, 1] : [1, 2, 3];
  const word = magnitude > 0 ? SEVERITY_WORD[magnitude as 1 | 2 | 3] : "";
  return (
    <div
      style={{
        ...col,
        width,
        justifyContent: "center",
        gap: 8,
        padding: "14px 22px",
        alignItems: sign < 0 ? "flex-end" : "flex-start",
      }}
    >
      <div style={{ ...sora(21, 600, P.ink, 1.2), height: 25, alignItems: "center" }}>{word}</div>
      <div style={{ ...row, alignItems: "flex-end", gap: 6 }}>
        {levels.map((level) => (
          <div
            key={level}
            style={{
              display: "flex",
              width: 26,
              height: BALANCE_TILE_H[level],
              borderRadius: 4,
              backgroundColor: level <= magnitude ? P.inkRamp[level - 1] : P.unlit,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function CornerBalance({ feel }: { feel: ShareFeel }) {
  if (!feel.balance) return null;
  const LABEL_W = 110;
  const PIP_W = 66;
  const SEAM = 2;
  // The frame's two edges, then three seams: after the label, and either side of the pip.
  const TRACK = INNER - SEAM * 2 - SEAM * 3;
  const zoneW = Math.floor((TRACK - LABEL_W - PIP_W) / 2);
  const zoneWLast = TRACK - LABEL_W - PIP_W - zoneW;
  const seam = `${SEAM}px solid ${P.line}`;
  const colHead = (text: string, width: number, align: "flex-start" | "flex-end") => (
    <div style={{ ...eyebrow(24, P.faint), width, justifyContent: align, padding: "0 22px" }}>{text}</div>
  );
  // Seams are borders on transparent cells, never a coloured row showing through gaps: nothing
  // here clips (see `Card`), so a filled cell would square off the frame's rounded corners.
  return (
    <div style={{ ...col, width: INNER, borderRadius: 12 * S, border: seam }}>
      <div
        style={{
          ...row,
          padding: "16px 0",
          backgroundColor: P.band,
          borderBottom: seam,
          borderTopLeftRadius: 12 * S - SEAM,
          borderTopRightRadius: 12 * S - SEAM,
        }}
      >
        <div style={{ display: "flex", width: LABEL_W + SEAM }} />
        {colHead("Understeer", zoneW + SEAM, "flex-start")}
        <div style={{ display: "flex", width: PIP_W + SEAM }} />
        {colHead("Oversteer", zoneWLast, "flex-end")}
      </div>
      {feel.balance.map((b, i) => (
        <div key={b.label} style={{ ...row, borderTop: i === 0 ? "none" : seam }}>
          <div style={{ ...sora(24, 600, P.ink, 1.2), width: LABEL_W + SEAM, alignItems: "center", paddingLeft: 22, borderRight: seam }}>
            {b.label}
          </div>
          <BalanceZone sign={-1} value={b.value} width={zoneW} />
          <div style={{ display: "flex", width: PIP_W + SEAM * 2, alignItems: "center", justifyContent: "center", borderLeft: seam, borderRight: seam }}>
            <div
              style={{
                display: "flex",
                width: b.value === 0 ? 14 : 8,
                height: b.value === 0 ? 14 : 8,
                borderRadius: 7,
                backgroundColor: b.value === 0 ? P.mut : P.line,
              }}
            />
          </div>
          <BalanceZone sign={1} value={b.value} width={zoneWLast} />
        </div>
      ))}
    </div>
  );
}

/** `CarHandlingRatingQuickPick`'s read-back: ten numbers in four bands, the driver's lit. */
function Felt({ feel }: { feel: ShareFeel }) {
  const bandColor = (caption: string) => P.rating[caption] ?? P.mut;
  const ratingInk = feel.bandCaption ? bandColor(feel.bandCaption) : P.faint;
  const bigW = 200;
  const gap = 12;
  const cellW = Math.floor((INNER - bigW - 24 - gap * 3 - 2 * 6) / 10);
  const tileW = Math.floor((INNER - 12) / 2);
  return (
    <div style={col}>
      <div style={sora(13 * S, 500, P.mut, 1.3)}>Car handling rating</div>
      <div style={{ ...row, alignItems: "flex-end", justifyContent: "space-between", marginTop: 18 }}>
        <div style={{ ...row, gap }}>
          {feel.bands.map((band) => (
            <div key={band.caption} style={col}>
              <div style={{ ...row, gap: 2 }}>
                {band.ratings.map((n) => {
                  const selected = feel.rating === n;
                  return (
                    <div
                      key={n}
                      style={{
                        ...sora(30, 600, selected ? P.white : band.active ? P.ink : P.mut, 1),
                        width: cellW,
                        height: 76,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: selected ? bandColor(band.caption) : band.active ? P.band : P.card,
                        border: selected ? "none" : `2px solid ${P.line}`,
                        borderRadius: 8,
                      }}
                    >
                      {String(n)}
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  ...sora(22, 600, band.active ? bandColor(band.caption) : P.faint, 1.2),
                  marginTop: 10,
                  width: band.ratings.length * cellW + (band.ratings.length - 1) * 2,
                  justifyContent: "center",
                }}
              >
                {band.caption}
              </div>
            </div>
          ))}
        </div>
        <div style={{ ...col, width: bigW, alignItems: "flex-end" }}>
          <div style={{ ...row, alignItems: "baseline" }}>
            <div style={{ ...sora(84, 700, ratingInk, 1), letterSpacing: -2 }}>{feel.rating != null ? String(feel.rating) : "—"}</div>
            {feel.rating != null ? <div style={{ ...sora(30, 500, P.faint, 1), marginLeft: 6 }}>/ 10</div> : null}
          </div>
          <div style={{ ...sora(28, 600, ratingInk, 1.2), marginTop: 6 }}>{feel.bandCaption ?? "Not rated"}</div>
        </div>
      </div>

      {feel.balance ? (
        <div style={{ ...col, marginTop: 44 }}>
          <div style={{ ...sora(13 * S, 500, P.mut, 1.3), marginBottom: 16 }}>Corner balance</div>
          <CornerBalance feel={feel} />
        </div>
      ) : null}

      {feel.notables.length > 0 ? (
        <div style={{ ...col, marginTop: 40 }}>
          <div style={{ ...sora(13 * S, 500, P.mut, 1.3), marginBottom: 16 }}>Notable</div>
          <div style={{ display: "flex", flexWrap: "wrap", width: INNER }}>
            {feel.notables.map((n, i) => {
              const flagged = n.severity != null;
              const stepW = Math.floor((tileW - 44 - 12 - 4) / 3);
              return (
                <div
                  key={n.label}
                  style={{
                    ...col,
                    gap: 16,
                    width: tileW,
                    padding: 22,
                    marginRight: i % 2 === 0 ? 12 : 0,
                    marginBottom: 12,
                    borderRadius: 12 * S * 0.9,
                    border: `2px solid ${flagged ? P.lossEdge : P.line}`,
                    backgroundColor: flagged ? P.lossFill : P.card,
                  }}
                >
                  <div style={{ ...sora(26, 600, flagged ? P.ink : P.mut, 1.2), height: 31 }}>{n.label}</div>
                  <div style={{ ...row, alignItems: "flex-end", height: 22, gap: 6 }}>
                    {([1, 2, 3] as const).map((s) => (
                      <div
                        key={s}
                        style={{
                          display: "flex",
                          width: stepW,
                          height: NOTABLE_STEP_H[s],
                          borderRadius: 3,
                          backgroundColor: n.severity != null && s <= n.severity ? P.loss : P.unlit,
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
  );
}

/** "Lead with the lap": the best lap, big, in its own card above the report. */
function HeroCard({ card }: { card: ShareRunCard }) {
  const best = card.tiles[0]?.value ?? "—";
  const size = fitSoraSize(best, INNER, { max: 200, min: 130, weight: 700, letterSpacingEm: -0.04 });
  return (
    <Card radius={16 * S} style={{ width: CARD_W, marginTop: 36 }}>
      <Band label="Best lap" size={30} padX={PAD} />
      <div style={{ ...col, padding: `28px ${PAD}px ${PAD}px` }}>
        <Figure text={best} size={size} weight={700} tabular={false} tracking={-0.04} />
        <div style={{ display: "flex", marginTop: 30 }}>
          <Wells
            wells={card.tiles.slice(1).map((t) => ({ label: t.label, value: t.value }))}
            cols={3}
          />
        </div>
      </div>
    </Card>
  );
}

function Section({ title, first, children }: { title: string; first: boolean; children: ReactNode }) {
  return (
    <div style={col}>
      {first ? null : <Heading>{title}</Heading>}
      {children}
    </div>
  );
}

export function ReportCard({ card }: { card: ShareRunCard }) {
  const hero = card.style === "hero";
  const titleSize = fitSoraSize(card.title, W - 160, { max: 74, min: 48, weight: 700, letterSpacingEm: -0.02 });
  const titleW = Math.min(W - 160, Math.max(240, Math.round(soraWidth(card.title, titleSize, 700, -titleSize * 0.02))));

  // The sections that exist, in the app's order. The first one opens the card with the band.
  const sections: { key: string; title: string; body: ReactNode }[] = [];
  if (card.details.length > 0) {
    sections.push({ key: "details", title: "Session details", body: <Wells wells={card.details} cols={2} /> });
  }
  const lapBody = (
    <div style={col}>
      {card.lapWells.length > 0 ? <Wells wells={card.lapWells} cols={3} /> : null}
      {card.laps ? (
        <div style={{ display: "flex", marginTop: card.lapWells.length > 0 ? 24 : 0 }}>
          <LapChips laps={card.laps} />
        </div>
      ) : null}
      {card.trace ? (
        <div style={{ ...col, marginTop: 30 }}>
          <Trace trace={card.trace} box={REPORT_TRACE} k={2.6} labelSize={26} />
          <div style={{ display: "flex", marginTop: 12 }}>
            <TraceKey size={26} />
          </div>
        </div>
      ) : null}
    </div>
  );
  if (card.lapWells.length > 0 || card.laps || card.trace) {
    sections.push({ key: "laps", title: "Laptimes", body: lapBody });
  }
  if (card.changed) sections.push({ key: "setup", title: "Setup vs previous run", body: <SetupDiff rows={card.changed} /> });
  if (card.notes) {
    sections.push({
      key: "notes",
      title: "Notes",
      body: <div style={{ ...sora(14.5 * S, 400, P.ink, 1.5), width: INNER }}>{card.notes}</div>,
    });
  }
  if (card.feel) sections.push({ key: "feel", title: "How the car felt", body: <Felt feel={card.feel} /> });

  return (
    <div style={{ ...col, width: W, backgroundColor: P.ground, padding: `52px ${GUTTER}px 0` }}>
      <div style={{ ...row, alignItems: "center", justifyContent: "space-between", padding: "0 6px" }}>
        <Lockup tile={54} text={30} />
        <div style={eyebrow(26)}>{card.dateStamp}</div>
      </div>

      <div style={{ ...col, alignItems: "center", marginTop: 50 }}>
        {card.eyebrow ? <div style={{ ...eyebrow(27), marginBottom: 14 }}>{card.eyebrow}</div> : null}
        <div style={{ ...sora(titleSize, 700, P.ink, 1.12), letterSpacing: -titleSize * 0.02 }}>{card.title}</div>
        <div style={{ display: "flex", marginTop: 16 }}>
          <TitleRule width={titleW} thickness={4} />
        </div>
        {/* The driver on a line of their own, then where and in what — never a name broken off
            onto a second line by itself. Each line is sized to fit rather than wrapped. */}
        {[
          { text: card.driverName, weight: 600 as const, color: P.ink },
          { text: [card.trackName, card.carName].filter(Boolean).join(" · "), weight: 500 as const, color: P.mut },
        ]
          .filter((line) => line.text)
          .map((line, i) => (
            <div
              key={i}
              style={{
                ...sora(fitSoraSize(line.text!, W - 140, { max: 33, min: 22, weight: line.weight }), line.weight, line.color, 1.35),
                marginTop: i === 0 ? 22 : 2,
                whiteSpace: "nowrap",
              }}
            >
              {line.text}
            </div>
          ))}
      </div>

      {hero ? (
        <HeroCard card={card} />
      ) : (
        <div style={{ display: "flex", marginTop: 36 }}>
          <Wells wells={card.tiles.map((t) => ({ label: t.label, value: t.value }))} cols={4} width={CARD_W} />
        </div>
      )}

      {sections.length > 0 ? (
        <Card radius={16 * S} style={{ width: CARD_W, marginTop: 28 }}>
          <Band label={sections[0]!.title} size={30} padX={PAD} />
          <div style={{ ...col, padding: `${PAD}px ${PAD}px ${PAD + 6}px` }}>
            {sections.map((s, i) => (
              <Section key={s.key} title={s.title} first={i === 0}>
                {s.body}
              </Section>
            ))}
          </div>
        </Card>
      ) : null}

      <div style={{ ...row, alignItems: "center", justifyContent: "space-between", padding: "44px 6px 48px" }}>
        <Lockup tile={46} text={27} />
        <div style={sora(26, 500, P.faint, 1)}>{BRAND_DOMAIN}</div>
      </div>
      <Sentinel />
    </div>
  );
}

/**
 * Painted at 2/3 of its layout size: paint is ~98% of a render's cost and tracks pixel area, and
 * WhatsApp and Messenger recompress to ~1600px on the long edge anyway (measured 2026-08-17).
 * See the note on `CARD_PAINT_SCALE` in the old renderer's history for the numbers.
 */
export const REPORT_PAINT_SCALE = 2 / 3;

/** The tallest the page is ever laid out at before it is cut to its content. */
const LAYOUT_CEILING = 9000;

export async function renderReportPng(card: ShareRunCard, opts?: { scale?: number }): Promise<Buffer> {
  const svg = await satori(<ReportCard card={card} />, { width: W, height: LAYOUT_CEILING, fonts: shareCardFonts() });
  // No sentinel means the content ran past the ceiling; the ceiling is then the honest height.
  const height = sentinelTop(svg) ?? LAYOUT_CEILING;
  return sharp(Buffer.from(cropSvgHeight(svg, height)), {
    unlimited: true,
    density: 72 * (opts?.scale ?? REPORT_PAINT_SCALE),
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
