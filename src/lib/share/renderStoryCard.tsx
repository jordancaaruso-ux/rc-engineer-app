import "server-only";

import satori from "satori";
import sharp from "sharp";
import type { ReactNode } from "react";
import type { ShareRunCard, ShareTile, ShareTraceBox } from "@/lib/share/shareCardModel";
import { shareCardFonts } from "@/lib/share/shareFonts";
import { fitSoraSize, soraWidth } from "@/lib/share/textMeasure";
import {
  Band,
  Card,
  Figure,
  Lockup,
  Mark,
  P,
  ShadowStrip,
  TitleRule,
  Trace,
  TraceKey,
  col,
  eyebrow,
  row,
  sora,
} from "@/lib/share/paperParts";
import { BRAND_DOMAIN, PRODUCT_NAME } from "@/lib/brand/brandNames";

/**
 * The run as an Instagram / Facebook story: one 1080 × 1920 picture, 9:16, the size a story is.
 *
 * Added 2026-09-25 (founder: "good for stories on Instagram and Facebook … super professional").
 * The long picture stays for team chats; a story shows a long strip shrunk to a thin column, so
 * this one is laid out for the frame it will be seen in.
 *
 * Fixed size, so every headline is sized to fit before it is drawn (`fitSoraSize`): satori clips
 * whatever overflows and says nothing.
 */

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

export type StoryVariant = "app" | "poster" | "yellow";

/** The trace's box on a story, for the model to lay the trace out in. Same in every variant. */
export const STORY_TRACE: ShareTraceBox = {
  width: 896,
  height: 300,
  padLeft: 92,
  padRight: 14,
  padTop: 22,
  padBottom: 58,
};

/** A story's chart against the on-screen one (≈343px wide at 390pt): 896 / 343. */
const K = 2.6;

/*
 * The safe band. Instagram covers the top ~230px with its progress bar and the poster's name, and
 * the bottom ~280px with the reply bar. Every layout centres its content between the two, so a
 * short run and a long one both sit in the middle of the frame instead of hanging off the top.
 */
const SAFE_TOP = 230;
const SAFE_BOTTOM = 280;

type Story = {
  best: string;
  stats: ShareTile[];
  /** The headline: the track, or the session when the run has no track. */
  track: string;
  /** The line over the headline: the event, else the session. */
  eyebrowText: string;
  /** The line under it: whatever the eyebrow did not already say, then the car. */
  sub: string;
  /** The raw pieces, for a layout that arranges them its own way. */
  event: string | null;
  /** The session, unless it is already the headline. */
  session: string | null;
  car: string;
  driver: string | null;
  /** `SUN 9 AUG 2026`, for an eyebrow. */
  dateCaps: string;
  /** `Sun 9 Aug 2026`, for a sentence. */
  date: string;
};

function storyFrom(card: ShareRunCard): Story {
  const session = card.title;
  const hasTrack = card.trackName != null;
  const event = card.eventName;
  // Each fact once: the event (or the session) over the headline, the rest under it.
  const eyebrowText = event ?? (hasTrack ? session : card.carName);
  const sub = [event && hasTrack ? session : null, event || hasTrack ? card.carName : null]
    .filter(Boolean)
    .join(" · ");
  return {
    best: card.tiles[0]?.value ?? "—",
    stats: card.tiles.slice(1, 4),
    track: card.trackName ?? session,
    eyebrowText,
    sub,
    event,
    session: hasTrack ? session : null,
    car: card.carName,
    driver: card.driverName,
    dateCaps: card.dateStamp,
    date: card.dateStamp
      .toLowerCase()
      .replace(/(^|\s)([a-z])/g, (_m, space: string, c: string) => space + c.toUpperCase()),
  };
}

function Frame({ children, ground, padX, center }: { children: ReactNode; ground: string; padX: number; center?: boolean }) {
  return (
    <div
      style={{
        ...col,
        width: STORY_WIDTH,
        height: STORY_HEIGHT,
        justifyContent: "center",
        alignItems: center ? "center" : "stretch",
        backgroundColor: ground,
        padding: `${SAFE_TOP}px ${padX}px ${SAFE_BOTTOM}px`,
      }}
    >
      {children}
    </div>
  );
}

/** Three stats as the app's instrument well: one hairline frame, seams between, label over value. */
function StatWells({ stats, width }: { stats: ShareTile[]; width: number }) {
  const cellW = Math.floor((width - 4) / 3);
  return (
    <div
      style={{
        ...row,
        width,
        borderRadius: 30,
        border: `2px solid ${P.line}`,
        backgroundColor: P.well,
      }}
    >
      {stats.map((t, i) => (
        <div
          key={t.label}
          style={{
            ...col,
            width: i === 2 ? width - 4 - cellW * 2 : cellW,
            padding: "22px 28px 24px",
            borderLeft: i === 0 ? "none" : `2px solid ${P.line}`,
          }}
        >
          <div style={sora(29, 600, P.mut, 1.2)}>{t.label}</div>
          <Figure text={t.value} size={t.label === "Laps / time" ? 46 : 54} weight={600} style={{ marginTop: 12 }} />
        </div>
      ))}
    </div>
  );
}

/** The same three stats without a frame, for the poster: hairline above, seams between. */
function StatRow({ stats, width }: { stats: ShareTile[]; width: number }) {
  const cellW = Math.floor(width / 3);
  return (
    <div style={{ ...row, width, borderTop: `2px solid ${P.line}`, paddingTop: 32 }}>
      {stats.map((t, i) => (
        <div
          key={t.label}
          style={{
            ...col,
            width: i === 2 ? width - cellW * 2 : cellW,
            paddingLeft: i === 0 ? 0 : 30,
            borderLeft: i === 0 ? "none" : `2px solid ${P.line}`,
          }}
        >
          <div style={sora(29, 600, P.mut, 1.2)}>{t.label}</div>
          <Figure text={t.value} size={t.label === "Laps / time" ? 48 : 56} weight={600} style={{ marginTop: 14 }} />
        </div>
      ))}
    </div>
  );
}

function TraceBlock({ card, heading }: { card: ShareRunCard; heading?: boolean }) {
  if (!card.trace) return null;
  return (
    <div style={col}>
      {heading ? <div style={{ ...eyebrow(29), marginBottom: 12 }}>Lap trace</div> : null}
      <Trace trace={card.trace} box={STORY_TRACE} k={K} labelSize={26} />
      <div style={{ display: "flex", marginTop: 12 }}>
        <TraceKey size={26} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A — the app's own card
// ---------------------------------------------------------------------------

function AppStory({ card, s }: { card: ShareRunCard; s: Story }) {
  const titleSize = fitSoraSize(s.track, 900, { max: 80, min: 50, weight: 700, letterSpacingEm: -0.02 });
  const titleW = Math.min(900, Math.max(240, Math.round(soraWidth(s.track, titleSize, 700, -titleSize * 0.02))));
  const bestSize = fitSoraSize(s.best, 820, { max: 206, min: 140, weight: 700, letterSpacingEm: -0.04 });
  const cardW = STORY_WIDTH - 96;
  const inner = cardW - 4 - 88;
  // Two centred lines under the title, each sized to fit: what it was, then what and when.
  const lines = [[s.event, s.session], [s.car, s.date]]
    .map((parts) => parts.filter(Boolean).join(" · "))
    .filter((line) => line.length > 0);
  return (
    <Frame ground={P.ground} padX={48} center>
      <Lockup tile={54} text={31} />

      <div style={{ ...col, alignItems: "center", marginTop: 46 }}>
        <div style={{ ...sora(titleSize, 700, P.ink, 1.1), letterSpacing: -titleSize * 0.02 }}>{s.track}</div>
        <div style={{ display: "flex", marginTop: 16 }}>
          <TitleRule width={titleW} thickness={4} />
        </div>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              ...sora(fitSoraSize(line, 940, { max: 32, min: 22, weight: 500 }), 500, P.mut, 1.3),
              marginTop: i === 0 ? 22 : 4,
              whiteSpace: "nowrap",
            }}
          >
            {line}
          </div>
        ))}
      </div>

      <Card radius={44} style={{ width: cardW, marginTop: 40 }}>
        <Band
          label="Best lap"
          size={29}
          padX={44}
          topRadius={42}
          right={s.driver ? <div style={sora(29, 600, P.ink, 1.25)}>{s.driver}</div> : undefined}
        />
        <div style={{ ...col, padding: "30px 44px 36px" }}>
          <Figure text={s.best} size={bestSize} weight={700} tabular={false} tracking={-0.04} />
          <div style={{ display: "flex", marginTop: 32 }}>
            <StatWells stats={s.stats} width={inner} />
          </div>
          <div style={{ display: "flex", marginTop: 40 }}>
            <TraceBlock card={card} heading />
          </div>
        </div>
      </Card>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// B — the poster
// ---------------------------------------------------------------------------

function PosterStory({ card, s }: { card: ShareRunCard; s: Story }) {
  const W = STORY_WIDTH - 144;
  const trackSize = fitSoraSize(s.track, W, { max: 104, min: 58, weight: 700, letterSpacingEm: -0.025 });
  const bestSize = fitSoraSize(s.best, W, { max: 236, min: 150, weight: 700, letterSpacingEm: -0.045 });
  return (
    <Frame ground={P.card} padX={72}>
      <div style={{ ...row, alignItems: "center", justifyContent: "space-between", height: 58 }}>
        <Lockup tile={58} text={32} />
        <div style={eyebrow(27)}>{s.dateCaps}</div>
      </div>

      <div style={{ ...col, marginTop: 64 }}>
        <div style={eyebrow(29)}>{s.eyebrowText}</div>
        <div style={{ ...sora(trackSize, 700, P.ink, 1.05), letterSpacing: -trackSize * 0.025, marginTop: 10 }}>
          {s.track}
        </div>
        <div style={{ display: "flex", marginTop: 20 }}>
          <TitleRule width={W} thickness={4} sectorAt={0} />
        </div>
        {s.sub ? <div style={{ ...sora(35, 500, P.mut, 1.3), marginTop: 20 }}>{s.sub}</div> : null}
      </div>

      <div style={{ ...col, marginTop: 54 }}>
        <div style={eyebrow(29)}>Best lap</div>
        <Figure text={s.best} size={bestSize} weight={700} tabular={false} tracking={-0.045} style={{ marginTop: 10 }} />
      </div>

      <div style={{ display: "flex", marginTop: 46 }}>
        <StatRow stats={s.stats} width={W} />
      </div>

      <div style={{ display: "flex", marginTop: 48 }}>
        <TraceBlock card={card} />
      </div>

      <div style={{ ...row, alignItems: "baseline", justifyContent: "space-between", marginTop: 30 }}>
        <div style={sora(36, 600, P.ink, 1.2)}>{s.driver ?? ""}</div>
        <div style={sora(27, 500, P.faint, 1.2)}>{BRAND_DOMAIN}</div>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// C — the yellow hero
// ---------------------------------------------------------------------------

/** Ink over the yellow face, at the three strengths the face can carry. */
const ON_YELLOW = { strong: P.ink, mid: "rgba(25, 24, 21, 0.72)", soft: "rgba(25, 24, 21, 0.58)" } as const;

function YellowStory({ card, s }: { card: ShareRunCard; s: Story }) {
  const cardW = STORY_WIDTH - 96;
  const inner = cardW - 4 - 88;
  const bestSize = fitSoraSize(s.best, inner, { max: 236, min: 150, weight: 700, letterSpacingEm: -0.045 });
  const trackSize = fitSoraSize(s.track, inner, { max: 58, min: 40, weight: 700, letterSpacingEm: -0.015 });
  const under = [s.eyebrowText === s.track ? null : s.eyebrowText, s.sub].filter(Boolean).join(" · ");
  const underSize = fitSoraSize(under, inner, { max: 32, min: 24, weight: 500 });
  return (
    <Frame ground={P.ground} padX={48}>
      <div style={{ ...col, position: "relative", width: cardW }}>
      {/* `.primary-face` (2026-09-25): lit from above, and a golden shadow instead of a rim. */}
      <ShadowStrip
        width={cardW}
        radius={44}
        shadow="0 3px 6px rgba(122, 90, 0, 0.2), 0 30px 60px -34px rgba(214, 160, 0, 0.75)"
      />
      <div
        style={{
          ...col,
          width: cardW,
          padding: "42px 44px 44px",
          borderRadius: 44,
          backgroundImage: `linear-gradient(172deg, ${P.primaryLit} 0%, ${P.primary} 48%, ${P.primaryDeep} 100%)`,
        }}
      >
        <div style={{ ...row, alignItems: "center", justifyContent: "space-between", height: 42 }}>
          <Mark height={38} />
          <div style={eyebrow(27, ON_YELLOW.soft)}>{s.dateCaps}</div>
        </div>
        <div style={{ ...eyebrow(29, ON_YELLOW.soft), marginTop: 54 }}>Best lap</div>
        <Figure text={s.best} size={bestSize} weight={700} tabular={false} tracking={-0.045} style={{ marginTop: 10 }} />
        <div style={{ ...sora(trackSize, 700, ON_YELLOW.strong, 1.1), letterSpacing: -trackSize * 0.015, marginTop: 34 }}>
          {s.track}
        </div>
        {under ? <div style={{ ...sora(underSize, 500, ON_YELLOW.mid, 1.3), marginTop: 8 }}>{under}</div> : null}
      </div>
      </div>

      <Card radius={44} style={{ width: cardW, marginTop: 28 }}>
        <div style={{ ...col, padding: "36px 44px 36px" }}>
          <StatWells stats={s.stats} width={inner} />
          <div style={{ display: "flex", marginTop: 40 }}>
            <TraceBlock card={card} heading />
          </div>
        </div>
      </Card>

      <div style={{ ...row, justifyContent: "space-between", alignItems: "baseline", width: cardW, marginTop: 26, padding: "0 8px" }}>
        <div style={sora(33, 600, P.ink, 1.2)}>{s.driver ?? ""}</div>
        <div style={sora(27, 600, P.mut, 1.2)}>{PRODUCT_NAME}</div>
      </div>
    </Frame>
  );
}

export function StoryCard({ card, variant }: { card: ShareRunCard; variant: StoryVariant }) {
  const s = storyFrom(card);
  if (variant === "poster") return <PosterStory card={card} s={s} />;
  if (variant === "yellow") return <YellowStory card={card} s={s} />;
  return <AppStory card={card} s={s} />;
}

/** The story as a PNG, at full size — it is a 1080 × 1920 frame and every pixel of it is shown. */
export async function renderStoryPng(card: ShareRunCard, variant: StoryVariant): Promise<Buffer> {
  const svg = await satori(<StoryCard card={card} variant={variant} />, {
    width: STORY_WIDTH,
    height: STORY_HEIGHT,
    fonts: shareCardFonts(),
  });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
