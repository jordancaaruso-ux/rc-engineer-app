import "server-only";

import type { CSSProperties, ReactNode } from "react";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";
import { MARK_PATH, MARK_VIEWBOX, markWidth } from "@/lib/share/brandMark";
import { FONT_UI } from "@/lib/share/shareFonts";
import { SHARE_PAPER } from "@/lib/share/shareTheme";
import type { ShareTrace, ShareTraceBox } from "@/lib/share/shareCardModel";

/**
 * The pieces every paper picture is built from — the app's own devices, redrawn for satori.
 *
 * Satori is not a browser. The rules that have bitten these renderers, all still true:
 *   1. A React Fragment is NOT transparent: satori wraps its children in an implicit row box.
 *      One real element per block, explicitly a column where it stacks.
 *   2. Every element with more than one child needs an explicit `display`.
 *   3. Runs of spaces collapse, so separators are real characters.
 *   4. `<text>` inside an SVG is refused outright; words live in HTML laid over the SVG.
 *   5. No CSS variables: every colour arrives as a literal from `SHARE_PAPER`.
 *   6. No OpenType features: Sora's digits are proportional (a "1" is 0.42em, a "0" 0.74em) and
 *      `tabular-nums` does nothing, so a figure that must line up is set digit by digit in fixed
 *      slots ({@link Figure}).
 */

export const P = SHARE_PAPER;

export const col = { display: "flex", flexDirection: "column" } as const;
export const row = { display: "flex", flexDirection: "row" } as const;

export type Weight = 400 | 500 | 600 | 700;

/** Sora at a size, weight and colour, with an explicit line height (satori's implicit 1.2 lies). */
export function sora(size: number, weight: Weight, color: string = P.ink, lineHeight = 1.2): CSSProperties {
  return { display: "flex", fontFamily: FONT_UI, fontSize: size, fontWeight: weight, lineHeight, color };
}

/**
 * `.eyebrow-label` — 11px Sora 600, uppercase, 0.04em, muted — at a picture's scale.
 * `size` is the label's px size in the picture (11px × the picture's scale).
 */
export function eyebrow(size: number, color: string = P.mut): CSSProperties {
  return {
    ...sora(size, 600, color, 1.25),
    textTransform: "uppercase",
    letterSpacing: size * 0.04,
  };
}

/** The JRC mark, drawn rather than fetched — satori cannot reach `public/`. */
export function Mark({ height, color = P.ink }: { height: number; color?: string }) {
  return (
    <svg width={markWidth(height)} height={height} viewBox={MARK_VIEWBOX}>
      <path d={MARK_PATH} fill={color} />
    </svg>
  );
}

/**
 * The app icon: the ink mark on a lit yellow tile, the way the home screen shows it. On paper the
 * bare yellow mark is 1.4:1 and disappears, and an ink mark alone is anonymous; the tile is the
 * one form of the brand that reads on a white page and is already the one people know.
 */
export function BrandTile({ size }: { size: number }) {
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: size * 0.23,
        backgroundImage: `linear-gradient(160deg, ${P.primaryLit} 0%, ${P.primary} 55%, ${P.primaryDeep} 100%)`,
      }}
    >
      <Mark height={Math.round(size * 0.3)} />
    </div>
  );
}

/** Tile and name, side by side: the signature on every picture. */
export function Lockup({ tile, text }: { tile: number; text: number }) {
  return (
    <div style={{ ...row, alignItems: "center", gap: Math.round(tile * 0.32) }}>
      <BrandTile size={tile} />
      <div style={{ ...sora(text, 700, P.ink, 1), letterSpacing: -text * 0.01 }}>{PRODUCT_NAME}</div>
    </div>
  );
}

/**
 * `.page-title`'s seat: a hairline track the width of the title, and one brand-yellow sector
 * skewed −21° sitting on it. The app carries it under every page title; restored 2026-09-05
 * after a day without it, because a bare title floats.
 */
export function TitleRule({
  width,
  thickness,
  sectorAt = 0.5,
}: {
  width: number;
  /** The track's px thickness. The sector is twice it, as on screen (2px track, 4px sector). */
  thickness: number;
  /** Where the sector sits along the track: 0 flush left, 0.5 centred, 1 flush right. */
  sectorAt?: number;
}) {
  const sector = Math.round(width / 5);
  const left = Math.round((width - sector) * Math.min(1, Math.max(0, sectorAt)));
  return (
    <div style={{ display: "flex", position: "relative", width, height: thickness * 2 }}>
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 0,
          top: thickness,
          width,
          height: thickness,
          backgroundColor: P.line,
        }}
      />
      <div
        style={{
          display: "flex",
          position: "absolute",
          left,
          top: 0,
          width: sector,
          height: thickness * 2,
          backgroundColor: P.primary,
          transform: "skewX(-21deg)",
        }}
      />
    </div>
  );
}

const DIGIT = /[0-9]/;
/**
 * One digit slot, in em. Sora's figures run 0.61–0.69em apart from the narrow 1 and the wide 0;
 * 0.64 keeps a column of lap times aligned without letting the 1s float in air.
 */
const DIGIT_SLOT_EM = 0.64;

/**
 * A number set in fixed digit slots, so a column of them lines up the way `tabular-nums` makes it
 * line up in the app. Punctuation keeps its own width.
 */
export function Figure({
  text,
  size,
  weight,
  color = P.ink,
  tabular = true,
  tracking = 0,
  style,
}: {
  text: string;
  size: number;
  weight: Weight;
  color?: string;
  tabular?: boolean;
  /** Letter spacing in em — negative tightens a display figure. */
  tracking?: number;
  style?: CSSProperties;
}) {
  const font = sora(size, weight, color, 1);
  if (!tabular) {
    return <div style={{ ...font, letterSpacing: size * tracking, whiteSpace: "nowrap", ...style }}>{text}</div>;
  }
  return (
    <div style={{ ...row, alignItems: "flex-end", ...style }}>
      {[...text].map((ch, i) =>
        DIGIT.test(ch) ? (
          <div
            key={i}
            style={{ ...font, width: size * (DIGIT_SLOT_EM + tracking), justifyContent: "center" }}
          >
            {ch}
          </div>
        ) : ch === " " ? (
          // A lone space collapses to nothing in satori; hold its width with an empty box.
          <div key={i} style={{ display: "flex", width: size * 0.23 }} />
        ) : (
          <div key={i} style={{ ...font, paddingLeft: size * tracking * 0.5, paddingRight: size * tracking * 0.5 }}>
            {ch}
          </div>
        )
      )}
    </div>
  );
}

/**
 * `LapTimeGraph`, on paper, drawn into the box the model laid it out for. Slower plots HIGHER, as
 * on screen. Ink-2 line and dots, the best lap in best-lap purple, mistakes in the loss red,
 * clamped laps as triangles on the top edge; dots ringed in the card colour so they sit ON the line.
 *
 * `k` is the picture's scale against the on-screen chart (≈2.6 at 1080px wide).
 */
export function Trace({
  trace,
  box,
  k,
  labelSize,
  ground = P.card,
}: {
  trace: ShareTrace;
  box: ShareTraceBox;
  k: number;
  labelSize: number;
  ground?: string;
}) {
  const labelW = 80;
  return (
    <div style={{ display: "flex", position: "relative", width: box.width, height: box.height }}>
      <svg width={box.width} height={box.height} viewBox={`0 0 ${box.width} ${box.height}`}>
        {trace.gridlines.map((g, i) => (
          <line
            key={`g${i}`}
            x1={box.padLeft}
            x2={box.width - box.padRight}
            y1={g.y}
            y2={g.y}
            stroke={P.line}
            strokeWidth={Math.max(1, Math.round(k))}
          />
        ))}
        <polyline
          points={trace.points}
          fill="none"
          stroke={P.mut}
          strokeWidth={2 * k}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {trace.dots.map((d, i) => {
          const fill = d.flag === "best" ? P.bestLap : d.flag === "miss" ? P.loss : P.mut;
          if (d.clamped) {
            const s = 3.5 * k;
            return (
              <path
                key={`d${i}`}
                d={`M ${d.x} ${d.y - s} L ${d.x + s} ${d.y + s * 0.86} L ${d.x - s} ${d.y + s * 0.86} Z`}
                fill={fill}
                stroke={ground}
                strokeWidth={1.25 * k}
              />
            );
          }
          return (
            <circle
              key={`d${i}`}
              cx={d.x}
              cy={d.y}
              r={(d.flag ? 3.4 : 2.6) * k}
              fill={fill}
              stroke={ground}
              strokeWidth={1.1 * k}
            />
          );
        })}
      </svg>

      {trace.gridlines.map((g, i) => (
        <div
          key={`gl${i}`}
          style={{
            ...sora(labelSize, 500, P.faint, 1),
            position: "absolute",
            left: box.padLeft - labelW - labelSize * 0.6,
            top: g.y - labelSize * 0.5,
            width: labelW,
            justifyContent: "flex-end",
          }}
        >
          {g.label}
        </div>
      ))}
      {trace.xLabels.map((x, i) => (
        <div
          key={`x${i}`}
          style={{
            ...sora(labelSize, 500, P.faint, 1),
            position: "absolute",
            left: Math.round(x.x - labelW / 2),
            top: box.height - labelSize * 1.15,
            width: labelW,
            justifyContent: "center",
          }}
        >
          {x.label}
        </div>
      ))}
    </div>
  );
}

/** The trace's key — the same two marks the lap grid uses. */
export function TraceKey({ size }: { size: number }) {
  const dot = (color: string) => (
    <div style={{ display: "flex", width: size * 0.62, height: size * 0.62, borderRadius: size, backgroundColor: color }} />
  );
  return (
    <div style={{ ...row, alignItems: "center", gap: size * 1.2 }}>
      <div style={{ ...row, alignItems: "center", gap: size * 0.45 }}>
        {dot(P.bestLap)}
        <div style={sora(size, 500, P.mut, 1)}>Best lap</div>
      </div>
      <div style={{ ...row, alignItems: "center", gap: size * 0.45 }}>
        {dot(P.loss)}
        <div style={sora(size, 500, P.mut, 1)}>Mistake</div>
      </div>
    </div>
  );
}

/** `.glass-card`'s warm drop on paper (`0 12px 26px -20px`), at a picture's ~2.6× scale. */
const CARD_SHADOW = "0 31px 68px -52px rgba(60, 52, 32, 0.55)";

/**
 * A soft drop under something, drawn on a short strip at its foot rather than behind all of it.
 *
 * The paper shadows are offset down and pulled in by a negative spread, so the only part anyone
 * sees is the glow below the bottom edge; the rest sits behind the card. A blur is the costliest
 * thing satori's SVG asks the rasteriser to paint, and it is paid over the whole shadowed box: on
 * the ~3,000px report, one full-card shadow took a render from ~2s to ~10s (2026-09-25). The strip
 * draws the same bottom edge for the price of a few hundred pixels of height.
 */
export function ShadowStrip({
  width,
  radius,
  shadow,
  left = 0,
  bottom = 0,
}: {
  width: number;
  radius: number;
  shadow: string;
  left?: number;
  bottom?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        left,
        bottom,
        width,
        height: 180,
        borderRadius: radius,
        backgroundColor: P.card,
        boxShadow: shadow,
      }}
    />
  );
}

export { CARD_SHADOW };

/**
 * A white card on paper: the `.glass-card` edge and warm drop. `style.width` is required.
 *
 * **Never `overflow: hidden` here, or on any big box.** Satori turns it into an SVG mask that
 * every descendant references, and the rasteriser paints each masked element through an
 * offscreen surface the size of the mask: one clipping card made 562 elements do that and the
 * report took ~6s to paint where 0.16s did the same picture without it (2026-09-25). A band that
 * must follow the card's corners rounds its own (`Band`'s `topRadius`).
 */
export function Card({
  children,
  radius,
  style,
}: {
  children: ReactNode;
  radius: number;
  style: CSSProperties & { width: number };
}) {
  const { width, marginTop, ...inner } = style;
  return (
    <div style={{ ...col, position: "relative", width, marginTop }}>
      <ShadowStrip width={width} radius={radius} shadow={CARD_SHADOW} />
      <div
        style={{
          ...col,
          width,
          borderRadius: radius,
          border: `2px solid ${P.cardEdge}`,
          backgroundColor: P.card,
          ...inner,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The band a card opens with: a 2.2% ink tint and one hairline, edge to edge, the label inside.
 * `label` is set with {@link eyebrow}; `right` optional (a count, a date). `topRadius` rounds its
 * top corners to sit inside a card's (the card's radius less its edge), since nothing clips it.
 */
export function Band({
  label,
  size,
  padX,
  right,
  topRadius = 0,
}: {
  label: string;
  size: number;
  padX: number;
  right?: ReactNode;
  topRadius?: number;
}) {
  return (
    <div
      style={{
        ...row,
        alignItems: "center",
        justifyContent: "space-between",
        padding: `${Math.round(size * 0.64)}px ${padX}px ${Math.round(size * 0.64)}px`,
        backgroundColor: P.band,
        borderBottom: `2px solid ${P.line}`,
        borderTopLeftRadius: topRadius,
        borderTopRightRadius: topRadius,
      }}
    >
      <div style={eyebrow(size)}>{label}</div>
      {right ?? null}
    </div>
  );
}

/**
 * The last thing a variable-height picture draws: a 1px mark the renderer looks for in satori's
 * SVG to learn where the content really ended, then crops the picture there. Satori reports no
 * layout, and predicting heights from font metrics clipped the old card's footer more than once.
 */
export const SENTINEL_FILL = "#010203";
export function Sentinel() {
  return <div style={{ display: "flex", width: 1, height: 1, backgroundColor: SENTINEL_FILL }} />;
}

/** Where the {@link Sentinel} landed in satori's SVG, or null when it was clipped off the canvas. */
export function sentinelTop(svg: string): number | null {
  const rect = svg.match(new RegExp(`<rect[^>]*fill="${SENTINEL_FILL}"[^>]*/>`, "i"))?.[0];
  const y = rect?.match(/\sy="([\d.]+)"/)?.[1];
  return y == null ? null : Math.round(Number(y));
}

/** Satori's SVG, cut to `height` — the canvas below is never painted, which is where the cost is. */
export function cropSvgHeight(svg: string, height: number): string {
  return svg.replace(
    /^<svg([^>]*?)\sheight="[\d.]+"([^>]*?)\sviewBox="0 0 ([\d.]+) [\d.]+"/,
    (_all, a: string, b: string, w: string) => `<svg${a} height="${height}"${b} viewBox="0 0 ${w} ${height}"`
  );
}
