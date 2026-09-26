import "server-only";

import satori from "satori";
import sharp from "sharp";
import QRCode from "qrcode";
import type { CSSProperties, ReactNode } from "react";
import { shareCardFonts, FONT_STORY, FONT_UI, type FontWeight } from "@/lib/share/shareFonts";
import { fitTextSize, textWidth } from "@/lib/share/textMeasure";
import { BrandTile } from "@/lib/share/paperParts";
import { BRAND_DOMAIN, PRODUCT_NAME } from "@/lib/brand/brandNames";
import { meetingNameLessTrack } from "@/lib/events/meetingNameLessTrack";
import {
  formatPaceGap,
  ordinal,
  type StoryData,
  type StoryFrame,
  type StoryLook,
  type StoryTrace,
} from "@/lib/share/storyModel";

/**
 * The story looks, drawn: A (photo + frosted panel), B (framed poster), C (big gold numbers),
 * D (no photo, dark). Designed with the founder over three rounds of the share interview
 * (2026-09-25) after the Arccos posts he sent; the bench page's HTML was the spec.
 *
 * Satori has no backdrop blur, so look A's frosted panel is composited here: the photo is blurred
 * with sharp, cut to the panel's rectangle (found from two 1px marks satori draws at the panel's
 * corners) and laid under a transparent satori layer that carries the tint, the numbers and the
 * shade. Film grain is a sharp overlay on every look.
 *
 * Output is JPEG: a story is a photo, and a 1080 × 1920 photo as PNG is several megabytes.
 */

export const STORY_W = 1080;

type Geometry = { h: number; top: number; bottom: number };

/*
 * The safe band. Instagram covers the top ~250px of a story with its progress bar and the poster's
 * name, and the bottom ~290px with the reply bar. A 4:5 feed post is shown whole.
 */
const FRAMES: Record<StoryFrame, Geometry> = {
  story: { h: 1920, top: 250, bottom: 290 },
  post: { h: 1350, top: 72, bottom: 72 },
};

const GUTTER = 64;
const INNER = STORY_W - GUTTER * 2;

const YELLOW = "#FFD60A";
const GOLD = "#C49A00";
const GOLD_LABEL = "#A88400";
const INK = "#191815";
const MUTED_ON_LIGHT = "#57544E";
const LOSS_RED = "#E5644E";

const QR_URL = `https://${BRAND_DOMAIN}`;

const col = { display: "flex", flexDirection: "column" } as const;
const row = { display: "flex", flexDirection: "row" } as const;

function cond(size: number, weight: FontWeight, color: string, extra?: CSSProperties): CSSProperties {
  return { display: "flex", fontFamily: FONT_STORY, fontSize: size, fontWeight: weight, color, lineHeight: 1, ...extra };
}

/** Wide-tracked capitals, the Arccos label voice. Callers pass the text already upper-cased. */
function caps(size: number, color: string, tracking = 0.2, weight: FontWeight = 600): CSSProperties {
  return cond(size, weight, color, { letterSpacing: Math.round(size * tracking) });
}

function sora(size: number, weight: FontWeight, color: string, extra?: CSSProperties): CSSProperties {
  return { display: "flex", fontFamily: FONT_UI, fontSize: size, fontWeight: weight, color, lineHeight: 1.2, ...extra };
}

/** The largest condensed size, up to `max`, at which `text` fits `width`. */
function fitCond(text: string, width: number, max: number, weight: FontWeight = 800, trackingEm = 0): number {
  return fitTextSize(FONT_STORY, text, width, { max, min: Math.round(max * 0.45), weight, letterSpacingEm: trackingEm });
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

export function StoryLogo({ color, tile = 54, text = 30 }: { color: string; tile?: number; text?: number }) {
  return (
    <div style={{ ...row, alignItems: "center", justifyContent: "center", gap: Math.round(tile * 0.3) }}>
      <BrandTile size={tile} />
      <div style={caps(text, color, 0.3)}>{PRODUCT_NAME.toUpperCase()}</div>
    </div>
  );
}

let qrPath: { d: string; n: number } | null = null;

/** The QR code's modules as one path, made once per lambda: it always says the same thing. */
function qrModules(): { d: string; n: number } {
  if (qrPath) return qrPath;
  const code = QRCode.create(QR_URL, { errorCorrectionLevel: "M" });
  const n = code.modules.size;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (code.modules.get(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  qrPath = { d, n };
  return qrPath;
}

function Qr({ size, pad, radius, ring }: { size: number; pad: number; radius: number; ring?: string }) {
  const { d, n } = qrModules();
  return (
    <div
      style={{
        display: "flex",
        padding: pad,
        borderRadius: radius,
        backgroundColor: "#FFFFFF",
        border: ring ? `2px solid ${ring}` : "none",
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges">
        <path d={d} fill={INK} />
      </svg>
    </div>
  );
}

function LoggedWith({ color, strong, size, stacked }: { color: string; strong: string; size: number; stacked?: boolean }) {
  const name = <div style={sora(size, 600, strong)}>{PRODUCT_NAME}</div>;
  if (stacked) {
    return (
      <div style={{ ...col, gap: 4 }}>
        <div style={{ ...row, gap: size * 0.3 }}>
          <div style={sora(size, 400, color)}>Logged with</div>
          {name}
        </div>
        <div style={sora(size, 400, color)}>{BRAND_DOMAIN}</div>
      </div>
    );
  }
  return (
    <div style={{ ...row, gap: size * 0.3, justifyContent: "center" }}>
      <div style={sora(size, 400, color)}>Logged with</div>
      {name}
      <div style={sora(size, 400, color)}>{`· ${BRAND_DOMAIN}`}</div>
    </div>
  );
}

type ChartTheme = {
  line: string;
  lineWidth: number;
  grid: string;
  label: string;
  best: string;
  ring: string;
  avg: string;
  axes: boolean;
  dots: boolean;
};

/**
 * The lap chart, slower HIGHER, as the app draws it (`LapTimeGraph`); laps past the clean-pace
 * ceiling pin to the top as triangles. The field's average pace is a dashed line, the device the
 * founder liked in the Arccos strokes-gained chart. Satori draws no SVG `<text>`, so labels are
 * absolutely placed divs over the drawing.
 */
function StoryChart({
  trace,
  fieldAverage,
  width,
  height,
  theme,
}: {
  trace: StoryTrace;
  fieldAverage: number | null;
  width: number;
  height: number;
  theme: ChartTheme;
}) {
  const padL = theme.axes ? 88 : 14;
  const padR = theme.axes ? 16 : 14;
  const padT = theme.axes ? 20 : 16;
  const padB = theme.axes ? 52 : 16;
  const laps = trace.laps;
  const shown = laps.map((l) => Math.min(l.seconds, trace.ceiling));
  let lo = Math.min(...shown);
  let hi = Math.max(...shown);
  const avg = fieldAverage != null && fieldAverage < trace.ceiling ? fieldAverage : null;
  if (avg != null) {
    lo = Math.min(lo, avg);
    hi = Math.max(hi, avg);
  }
  const span = Math.max(hi - lo, 0.2);
  const pad = Math.max(span * 0.1, 0.04);
  const yl = lo - pad;
  const yh = hi + pad;
  const n0 = laps[0]!.lap;
  const n1 = laps[laps.length - 1]!.lap;
  const X = (n: number) => padL + ((n - n0) / Math.max(1, n1 - n0)) * (width - padL - padR);
  const Y = (t: number) => padT + ((yh - t) / (yh - yl)) * (height - padT - padB);

  const minLap = Math.min(...laps.map((l) => l.seconds));
  const maxShown = Math.max(...shown);
  const g1 = Math.ceil(minLap * 10) / 10;
  const g3 = Math.floor(maxShown * 10) / 10;
  const grid = theme.axes ? (g3 > g1 ? [g1, Math.round((g1 + g3) * 5) / 10, g3] : [g1]) : [];

  const count = n1 - n0 + 1;
  const step = count <= 10 ? 1 : count <= 16 ? 2 : 3;
  const xLabels: number[] = [];
  if (theme.axes) {
    for (let n = n0; n <= n1; n++) {
      const i = n - n0;
      if (n === n1 || (i % step === 0 && n1 - n >= Math.ceil(step / 2))) xLabels.push(n);
    }
  }

  const d = laps
    .map((l, i) => `${i ? "L" : "M"}${X(l.lap).toFixed(1)} ${Y(Math.min(l.seconds, trace.ceiling)).toFixed(1)}`)
    .join(" ");
  const labelSize = 26;

  return (
    <div style={{ display: "flex", position: "relative", width, height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {grid.map((v, i) => (
          <line key={`g${i}`} x1={padL} x2={width - padR} y1={Y(v)} y2={Y(v)} stroke={theme.grid} strokeWidth={2} />
        ))}
        {avg != null ? (
          <line
            x1={padL}
            x2={width - padR}
            y1={Y(avg)}
            y2={Y(avg)}
            stroke={theme.avg}
            strokeWidth={3}
            strokeDasharray="10 9"
          />
        ) : null}
        <path d={d} fill="none" stroke={theme.line} strokeWidth={theme.lineWidth} strokeLinejoin="round" strokeLinecap="round" />
        {laps.map((l, i) => {
          const x = X(l.lap);
          const clamped = l.seconds > trace.ceiling;
          const y = Y(Math.min(l.seconds, trace.ceiling));
          const fill = l.flag === "best" ? theme.best : l.flag === "miss" ? LOSS_RED : theme.line;
          if (clamped) {
            const s = 11;
            return (
              <path
                key={`d${i}`}
                d={`M ${x} ${y - s} L ${x + s} ${y + s * 0.86} L ${x - s} ${y + s * 0.86} Z`}
                fill={fill}
                stroke={theme.ring}
                strokeWidth={3}
              />
            );
          }
          if (l.flag === "best") return <circle key={`d${i}`} cx={x} cy={y} r={13} fill={fill} stroke={theme.ring} strokeWidth={5} />;
          if (l.flag === "miss") return <circle key={`d${i}`} cx={x} cy={y} r={10} fill={fill} stroke={theme.ring} strokeWidth={4} />;
          return theme.dots ? <circle key={`d${i}`} cx={x} cy={y} r={6} fill={fill} /> : null;
        })}
      </svg>

      {grid.map((v, i) => (
        <div
          key={`gl${i}`}
          style={{
            ...cond(labelSize, 600, theme.label),
            position: "absolute",
            left: 0,
            top: Y(v) - labelSize * 0.5,
            width: padL - 16,
            justifyContent: "flex-end",
          }}
        >
          {v.toFixed(1)}
        </div>
      ))}
      {xLabels.map((n) => (
        <div
          key={`x${n}`}
          style={{
            ...cond(labelSize, 600, theme.label),
            position: "absolute",
            left: Math.round(X(n) - 40),
            top: height - labelSize - 4,
            width: 80,
            justifyContent: "center",
          }}
        >
          {String(n)}
        </div>
      ))}
      {avg != null ? (
        <div
          style={{
            ...caps(22, theme.avg, 0.14),
            position: "absolute",
            left: padL + 4,
            top: Y(avg) - 34,
          }}
        >
          {`FIELD AVG ${avg.toFixed(2)}`}
        </div>
      ) : null}
    </div>
  );
}

/** Faint racing-line curves for the designed backdrops. */
function Arcs({ width, height, color, opacity }: { width: number; height: number; color: string; opacity: number }) {
  const h = height;
  const paths = [0.78, 0.84, 0.9].map(
    (f) => `M -80 ${h * f} C 240 ${h * (f - 0.26)}, 520 ${h * (f + 0.2)}, ${width + 80} ${h * (f - 0.18)}`
  );
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: "absolute", left: 0, top: 0, opacity }}
    >
      {paths.map((p, i) => (
        <path key={i} d={p} fill="none" stroke={color} strokeWidth={3} />
      ))}
    </svg>
  );
}

function Layer({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
  return <div style={{ display: "flex", position: "absolute", left: 0, top: 0, right: 0, bottom: 0, ...style }}>{children}</div>;
}

function Main({ g, gap, children, center }: { g: Geometry; gap: number; children: ReactNode; center?: boolean }) {
  return (
    <div
      style={{
        ...col,
        position: "absolute",
        left: GUTTER,
        top: g.top,
        width: INNER,
        height: g.h - g.top - g.bottom,
        gap,
        alignItems: center ? "center" : "stretch",
      }}
    >
      {children}
    </div>
  );
}

function headline(data: StoryData): string {
  return (data.driver ?? data.track ?? data.session).toUpperCase();
}

/**
 * Where the run was, less whatever the headline already says (a run with no driver name leads with its track).
 * The meeting's name drops the track it starts with: a new meeting is named "<track> · <day>", and
 * whole it printed "INDOOR RACEWAY | INDOOR RACEWAY · SAT 26 SEP".
 */
function placeParts(data: StoryData): string[] {
  return [data.driver ? data.track : null, meetingNameLessTrack(data.event, data.track)].filter(
    (p): p is string => Boolean(p)
  );
}

// ---------------------------------------------------------------------------
// A and D — headline over a frosted panel
// ---------------------------------------------------------------------------

const MARK_TL = "#010204";
const MARK_BR = "#010205";

function Stat({
  label,
  value,
  size,
  color,
  labelColor,
  of,
}: {
  label: string;
  value: string;
  size: number;
  color: string;
  labelColor: string;
  of?: string;
}) {
  return (
    <div style={{ ...col, alignItems: "center", gap: 12 }}>
      <div style={caps(23, labelColor, 0.2)}>{label}</div>
      <div style={cond(size, 700, color, { lineHeight: 0.9 })}>{value}</div>
      {of ? <div style={caps(26, labelColor, 0.12)}>{of}</div> : null}
    </div>
  );
}

function GlassLook({ data, g, photo, qr }: { data: StoryData; g: Geometry; photo: boolean; qr: boolean }) {
  const post = g.h < 1600;
  const white = "#FFFFFF";
  const soft = "rgba(255, 255, 255, 0.72)";
  // With no driver name the headline is the track, so the meeting's name drops it (`placeParts`).
  const event = data.driver ? data.event : meetingNameLessTrack(data.event, data.track);
  const eyebrow = [event ?? (data.driver ? data.track : null), data.session].filter(Boolean).join(" · ").toUpperCase();
  const name = headline(data);
  const nameSize = fitCond(name, INNER, post ? 150 : 172, 800);
  const panelPadX = post ? 32 : 38;
  const panelInner = INNER - 4 - panelPadX * 2;

  // Row one: best lap, laps, time — then the finish in yellow, past a hairline.
  const statTexts = [data.best ?? "—", String(data.lapCount), data.time ?? "—"];
  const finishText = data.finish ? `P${data.finish.position}` : null;
  let statSize = post ? 88 : 104;
  const rowWidth = (s: number) =>
    [...statTexts, ...(finishText ? [finishText] : [])].reduce((w, t) => w + textWidth(FONT_STORY, t, s, 700), 0) +
    (finishText ? 3 : 2) * 60;
  while (rowWidth(statSize) > panelInner && statSize > 60) statSize -= 4;

  const chartH = post ? 220 : 290;
  const secondSize = post ? 88 : 104;

  return (
    <div style={{ display: "flex", position: "relative", width: STORY_W, height: g.h, backgroundColor: photo ? "transparent" : "#0F0F0E" }}>
      {photo ? (
        <Layer
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(8,8,8,0.8) 0%, rgba(8,8,8,0.5) 20%, rgba(8,8,8,0.16) 46%, rgba(8,8,8,0.06) 60%, rgba(8,8,8,0.5) 84%, rgba(8,8,8,0.88) 100%)",
          }}
        />
      ) : (
        <Layer
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 0%, rgba(255,214,10,0.26) 0%, rgba(255,214,10,0) 55%), linear-gradient(180deg, #1C1C1B 0%, #0E0E0D 100%)",
          }}
        >
          <Arcs width={STORY_W} height={g.h} color="#FFFFFF" opacity={0.07} />
        </Layer>
      )}

      <Main g={g} gap={post ? 22 : 34}>
        <StoryLogo color={white} />
        <div style={{ ...col, alignItems: "center", gap: 14 }}>
          <div style={caps(27, "rgba(255,255,255,0.8)", 0.2)}>{eyebrow}</div>
          <div style={cond(nameSize, 800, white, { lineHeight: 0.88 })}>{name}</div>
        </div>

        <div
          style={{
            ...col,
            position: "relative",
            borderRadius: 40,
            backgroundColor: photo ? "rgba(20, 20, 20, 0.36)" : "rgba(255, 255, 255, 0.05)",
            border: "2px solid rgba(255, 255, 255, 0.14)",
            padding: post ? `26px ${panelPadX}px 28px` : `34px ${panelPadX}px 36px`,
            gap: post ? 20 : 30,
          }}
        >
          <div style={{ display: "flex", position: "absolute", left: 0, top: 0, width: 1, height: 1, backgroundColor: MARK_TL }} />
          <div style={{ display: "flex", position: "absolute", right: 0, bottom: 0, width: 1, height: 1, backgroundColor: MARK_BR }} />

          <div style={{ ...row, justifyContent: "space-between", alignItems: "stretch" }}>
            <Stat label="BEST LAP" value={statTexts[0]!} size={statSize} color={white} labelColor={soft} />
            <Stat label="LAPS" value={statTexts[1]!} size={statSize} color={white} labelColor={soft} />
            <Stat label="TIME" value={statTexts[2]!} size={statSize} color={white} labelColor={soft} />
            {finishText && data.finish ? (
              <div style={{ ...row, gap: 30 }}>
                <div style={{ display: "flex", width: 2, backgroundColor: "rgba(255,255,255,0.22)" }} />
                <Stat label="FINISH" value={finishText} size={statSize} color={YELLOW} labelColor={YELLOW} of={`OF ${data.finish.of}`} />
              </div>
            ) : null}
          </div>

          {data.trace ? (
            <div style={{ ...col, alignItems: "center" }}>
              <div style={{ ...caps(24, soft, 0.2), marginBottom: 12 }}>LAP BY LAP</div>
              <StoryChart
                trace={data.trace}
                fieldAverage={data.fieldAveragePace}
                width={panelInner}
                height={chartH}
                theme={{
                  line: YELLOW,
                  lineWidth: 6,
                  grid: "rgba(255,255,255,0.16)",
                  label: "rgba(255,255,255,0.6)",
                  best: "#FFFFFF",
                  ring: "rgba(20,20,20,0.85)",
                  avg: "rgba(255,255,255,0.7)",
                  axes: true,
                  dots: true,
                }}
              />
            </div>
          ) : null}

          <div style={{ ...row, justifyContent: "space-around" }}>
            {data.paceVsField != null ? (
              <div style={{ ...col, alignItems: "center", gap: 12 }}>
                <div style={cond(secondSize, 700, YELLOW, { lineHeight: 0.9 })}>{formatPaceGap(data.paceVsField)}</div>
                <div style={caps(23, YELLOW, 0.2)}>SEC A LAP VS FIELD</div>
              </div>
            ) : null}
            {data.consistency ? (
              <div style={{ ...col, alignItems: "center", gap: 12 }}>
                <div style={cond(secondSize, 700, white, { lineHeight: 0.9 })}>{data.consistency}</div>
                <div style={caps(23, soft, 0.2)}>CONSISTENCY</div>
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", flexGrow: 1 }} />
        {qr ? (
          <div style={{ ...row, alignItems: "center", gap: 26 }}>
            <Qr size={128} pad={14} radius={22} />
            <div style={{ ...col, gap: 8 }}>
              <div style={cond(44, 700, white)}>{`Scan to get ${PRODUCT_NAME}`}</div>
              <LoggedWith color="rgba(255,255,255,0.75)" strong="rgba(255,255,255,0.9)" size={26} />
            </div>
          </div>
        ) : (
          <LoggedWith color="rgba(255,255,255,0.8)" strong="#FFFFFF" size={28} />
        )}
      </Main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// B — the framed poster
// ---------------------------------------------------------------------------

function PosterLook({ data, g, photoUri, qr }: { data: StoryData; g: Geometry; photoUri: string | null; qr: boolean }) {
  const post = g.h < 1600;
  const frameW = 800;
  const frameH = post ? 600 : 840;
  const winner = data.finish?.position === 1;
  const big = data.finish
    ? winner
      ? "WINNER"
      : `${ordinal(data.finish.position)} PLACE`.toUpperCase()
    : (data.best ?? data.session).toUpperCase();
  const eyebrow = (data.finish ? data.session : "Best lap").toUpperCase();
  const bigSize = fitCond(big, frameW + 180, post ? 210 : 250, 800);
  const nline = (
    data.finish
      ? [data.driver, data.best ? `${data.best} best lap` : null]
      : [data.driver, data.session]
  )
    .filter(Boolean)
    .join(" | ")
    .toUpperCase();
  const nlineSize = fitCond(nline, INNER, 64, 700, 0.06);
  const place = [data.track, meetingNameLessTrack(data.event, data.track)].filter(Boolean).join(" · ").toUpperCase();
  const stats: { v: string; l: string }[] = [
    { v: String(data.lapCount), l: "LAPS" },
    ...(data.time ? [{ v: data.time, l: "TIME" }] : []),
    ...(data.paceVsField != null ? [{ v: formatPaceGap(data.paceVsField), l: "VS FIELD" }] : []),
    ...(data.consistency ? [{ v: data.consistency, l: "CONSISTENCY" }] : []),
  ];

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: STORY_W,
        height: g.h,
        backgroundColor: "#EEEEEC",
        backgroundImage: "radial-gradient(circle at 50% 28%, #FFFFFF 0%, #F2F2F0 45%, #E7E7E4 100%)",
      }}
    >
      <Main g={g} gap={post ? 22 : 30} center>
        <StoryLogo color={INK} />

        <div style={{ display: "flex", position: "relative", width: frameW, height: frameH }}>
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: 0,
              top: 0,
              width: frameW,
              height: frameH,
              borderRadius: 6,
              overflow: "hidden",
              backgroundColor: "#1B1B1A",
              boxShadow: "0 60px 70px -50px rgba(40, 36, 28, 0.55)",
            }}
          >
            {photoUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUri} alt="" width={frameW} height={frameH} style={{ position: "absolute", left: 0, top: 0 }} />
            ) : (
              <Layer
                style={{
                  backgroundImage:
                    "radial-gradient(circle at 15% 0%, rgba(255,214,10,0.3) 0%, rgba(255,214,10,0) 60%), linear-gradient(180deg, #2A2A28 0%, #111110 100%)",
                }}
              >
                <Arcs width={frameW} height={frameH} color="#FFFFFF" opacity={0.08} />
              </Layer>
            )}
            <Layer
              style={{
                backgroundImage:
                  "linear-gradient(180deg, rgba(10,10,10,0.55) 0%, rgba(10,10,10,0.1) 34%, rgba(10,10,10,0) 55%, rgba(10,10,10,0.55) 100%)",
              }}
            />
          </div>

          <div
            style={{
              ...col,
              position: "absolute",
              left: -90,
              width: frameW + 180,
              top: 34,
              alignItems: "center",
              gap: 6,
            }}
          >
            <div style={caps(30, "#FFFFFF", 0.3)}>{eyebrow}</div>
            <div style={cond(bigSize, 800, "#FFFFFF", { lineHeight: 0.86 })}>{big}</div>
          </div>

          {data.trace ? (
            <div style={{ ...col, position: "absolute", left: 36, bottom: 26, width: frameW - 72 }}>
              <div style={{ ...caps(22, "rgba(255,255,255,0.85)", 0.2), marginBottom: 8 }}>LAP BY LAP</div>
              <StoryChart
                trace={data.trace}
                fieldAverage={data.fieldAveragePace}
                width={frameW - 72}
                height={post ? 120 : 150}
                theme={{
                  line: "#FFFFFF",
                  lineWidth: 5,
                  grid: "transparent",
                  label: "#FFFFFF",
                  best: YELLOW,
                  ring: "rgba(20,20,20,0.6)",
                  avg: "rgba(255,255,255,0.6)",
                  axes: false,
                  dots: false,
                }}
              />
            </div>
          ) : null}
        </div>

        <div style={cond(nlineSize, 700, INK, { letterSpacing: Math.round(nlineSize * 0.06) })}>{nline}</div>
        {place ? <div style={caps(26, MUTED_ON_LIGHT, 0.34)}>{place}</div> : null}
        <div style={{ ...row, gap: 44, justifyContent: "center" }}>
          {stats.map((s) => (
            <div key={s.l} style={{ ...col, alignItems: "center", gap: 10 }}>
              <div style={cond(66, 700, INK, { lineHeight: 0.9 })}>{s.v}</div>
              <div style={caps(20, "rgba(25,24,21,0.7)", 0.2)}>{s.l}</div>
            </div>
          ))}
        </div>

        <div style={{ ...row, width: INNER, alignItems: "center", justifyContent: "space-between" }}>
          <LoggedWith color={MUTED_ON_LIGHT} strong={INK} size={26} stacked />
          {qr ? <Qr size={112} pad={10} radius={16} ring="rgba(25,24,21,0.08)" /> : null}
        </div>
      </Main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// C — big gold numbers
// ---------------------------------------------------------------------------

/** The photo's slot in look C: the left 64% of the frame, fading out to the right. */
export const C_PHOTO_W = Math.round(STORY_W * 0.64);

function BigNumbersLook({ data, g, photoUri, qr }: { data: StoryData; g: Geometry; photoUri: string | null; qr: boolean }) {
  const post = g.h < 1600;
  const k = post ? 0.8 : 1;
  const colW = Math.round(INNER * 0.58);
  const name = headline(data);
  const nameSize = fitCond(name, INNER, 96, 800);
  const place = placeParts(data).join(" | ").toUpperCase();
  const line = [`${data.lapCount} LAPS`, data.time, data.consistency ? `${data.consistency} CONSISTENCY` : null]
    .filter(Boolean)
    .join(" · ");

  const figure = (label: string, value: string, size: number) => {
    const fitted = fitCond(value, colW, Math.round(size * k), 700);
    return (
      <div style={{ ...col, alignItems: "flex-end", gap: 10 }}>
        <div style={caps(30, GOLD_LABEL, 0.2)}>{label}</div>
        <div style={cond(fitted, 700, GOLD, { lineHeight: 0.9 })}>{value}</div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", position: "relative", width: STORY_W, height: g.h, backgroundColor: "#E7EAEE" }}>
      {photoUri ? (
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 0,
            top: 0,
            width: C_PHOTO_W,
            height: g.h,
            maskImage: "linear-gradient(90deg, #000 50%, rgba(0,0,0,0) 100%)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUri} alt="" width={C_PHOTO_W} height={g.h} />
        </div>
      ) : (
        <Arcs width={STORY_W} height={g.h} color={INK} opacity={0.06} />
      )}
      <Layer
        style={{
          backgroundImage:
            "radial-gradient(circle at 0% 0%, rgba(255,214,10,0.28) 0%, rgba(255,214,10,0) 45%), linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(231,234,238,0.08) 42%, rgba(231,234,238,0.55) 100%)",
        }}
      />

      <Main g={g} gap={post ? 22 : 34}>
        <StoryLogo color={INK} />
        <div style={{ ...col, flexGrow: 1, alignItems: "flex-end", justifyContent: "center", gap: post ? 14 : 18 }}>
          {data.finish ? figure(`FINISH · ${data.session.toUpperCase()}`, `P${data.finish.position}`, 280) : null}
          {data.best ? figure("BEST LAP", data.best, 180) : null}
          {data.paceVsField != null ? figure("SEC A LAP VS FIELD", formatPaceGap(data.paceVsField), 120) : null}
          <div style={caps(26, MUTED_ON_LIGHT, 0.12)}>{line.toUpperCase()}</div>
          {data.trace ? (
            <StoryChart
              trace={data.trace}
              fieldAverage={data.fieldAveragePace}
              width={colW}
              height={post ? 110 : 130}
              theme={{
                line: GOLD,
                lineWidth: 5,
                grid: "transparent",
                label: MUTED_ON_LIGHT,
                best: INK,
                ring: "#E7EAEE",
                avg: "rgba(25,24,21,0.45)",
                axes: false,
                dots: false,
              }}
            />
          ) : null}
        </div>
        <div style={{ ...col, alignItems: "flex-end", gap: 10 }}>
          <div style={cond(nameSize, 800, INK, { lineHeight: 0.88 })}>{name}</div>
          {place ? <div style={caps(25, "#6B675F", 0.22)}>{place}</div> : null}
          <LoggedWith color={MUTED_ON_LIGHT} strong={INK} size={24} />
        </div>
        {qr ? (
          <div style={{ ...row, justifyContent: "flex-end" }}>
            <Qr size={112} pad={10} radius={16} />
          </div>
        ) : null}
      </Main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compositing
// ---------------------------------------------------------------------------

let grainTile: Buffer | null = null;

/** A fixed noise tile (seeded, so the same run always renders the same bytes). */
async function grain(): Promise<Buffer> {
  if (grainTile) return grainTile;
  const size = 256;
  const px = Buffer.alloc(size * size * 4);
  let seed = 1234567;
  for (let i = 0; i < size * size; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = seed % 256;
    px[i * 4] = v;
    px[i * 4 + 1] = v;
    px[i * 4 + 2] = v;
    px[i * 4 + 3] = 16;
  }
  grainTile = await sharp(px, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  return grainTile;
}

function markPoint(svg: string, fill: string): { x: number; y: number } | null {
  const rect = svg.match(new RegExp(`<rect[^>]*fill="${fill}"[^>]*/>`, "i"))?.[0];
  if (!rect) return null;
  const x = rect.match(/\sx="(-?[\d.]+)"/)?.[1];
  const y = rect.match(/\sy="(-?[\d.]+)"/)?.[1];
  return x == null || y == null ? null : { x: Number(x), y: Number(y) };
}

function stripMarks(svg: string): string {
  return svg.replace(new RegExp(`<rect[^>]*fill="(${MARK_TL}|${MARK_BR})"[^>]*/>`, "gi"), "");
}

async function toJpeg(input: sharp.Sharp): Promise<Buffer> {
  return input.jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
}

async function photoFor(photo: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(photo)
    .rotate()
    .resize(width, height, { fit: "cover", position: sharp.strategy.attention })
    .jpeg({ quality: 88 })
    .toBuffer();
}

function dataUri(jpeg: Buffer): string {
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

export type StoryRenderOptions = {
  look: StoryLook;
  frame: StoryFrame;
  /** The driver's own photo. Ignored by D; without it A draws as D. */
  photo?: Buffer | null;
  qr?: boolean;
};

/** A story picture as a JPEG, 1080 wide: 1920 tall for a story, 1350 for a post. */
export async function renderStoryLook(data: StoryData, opts: StoryRenderOptions): Promise<Buffer> {
  const g = FRAMES[opts.frame];
  const qr = opts.qr !== false;
  const hasPhoto = opts.photo != null && opts.photo.length > 0 && opts.look !== "D";
  const look: StoryLook = opts.look === "A" && !hasPhoto ? "D" : opts.look;
  const fonts = shareCardFonts();
  const tile = await grain();

  if (look === "A" && opts.photo) {
    const base = await photoFor(opts.photo, STORY_W, g.h);
    const svg = await satori(<GlassLook data={data} g={g} photo qr={qr} />, { width: STORY_W, height: g.h, fonts });
    const tl = markPoint(svg, MARK_TL);
    const br = markPoint(svg, MARK_BR);
    const overlay = await sharp(Buffer.from(stripMarks(svg))).png().toBuffer();
    const layers: sharp.OverlayOptions[] = [];
    if (tl && br) {
      // The marks sit inside the panel's 2px border; the panel is 2px out on each side.
      const left = Math.max(0, Math.round(tl.x) - 2);
      const top = Math.max(0, Math.round(tl.y) - 2);
      const width = Math.min(STORY_W - left, Math.round(br.x) + 3 - left);
      const height = Math.min(g.h - top, Math.round(br.y) + 3 - top);
      const frost = await sharp(base).blur(28).extract({ left, top, width, height }).toBuffer();
      const mask = Buffer.from(
        `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="40" ry="40" fill="#fff"/></svg>`
      );
      const rounded = await sharp(frost).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
      layers.push({ input: rounded, left, top });
    }
    layers.push({ input: overlay, left: 0, top: 0 }, { input: tile, tile: true, left: 0, top: 0 });
    return toJpeg(sharp(base).composite(layers));
  }

  let tree: ReactNode;
  if (look === "B") {
    const uri = hasPhoto ? dataUri(await photoFor(opts.photo!, 800, g.h < 1600 ? 600 : 840)) : null;
    tree = <PosterLook data={data} g={g} photoUri={uri} qr={qr} />;
  } else if (look === "C") {
    const uri = hasPhoto ? dataUri(await photoFor(opts.photo!, C_PHOTO_W, g.h)) : null;
    tree = <BigNumbersLook data={data} g={g} photoUri={uri} qr={qr} />;
  } else {
    tree = <GlassLook data={data} g={g} photo={false} qr={qr} />;
  }
  const svg = await satori(tree, { width: STORY_W, height: g.h, fonts });
  return toJpeg(sharp(Buffer.from(stripMarks(svg))).composite([{ input: tile, tile: true, left: 0, top: 0 }]));
}
