const fs = require("fs");
const path = require("path");

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function write(rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  console.log("wrote", rel);
}

// --- tracks/[trackId]/route.ts ---
{
  let f = read("src/app/api/tracks/[trackId]/route.ts");
  if (!f.includes("communityTrackByIdWhere")) {
    f = f.replace(
      'import { parseCoordinates } from "@/lib/location/coordinates";',
      'import { parseCoordinates } from "@/lib/location/coordinates";\nimport { communityTrackByIdWhere } from "@/lib/tracks/communityTrackAccess";\nimport { revalidateAfterTrackMutation } from "@/lib/revalidateUser";'
    );
    f = f.replace(/where: \{ id: trackId, userId: user\.id \}/g, "where: communityTrackByIdWhere(trackId)");
    f = f.replace(
      /latitude\?: unknown;\s*longitude\?: unknown;\s*clearLocation\?: boolean;/,
      `latitude?: unknown;
    longitude?: unknown;
    locationSource?: string | null;
    clearLocation?: boolean;`
    );
    f = f.replace(
      'data.locationSource = "device";',
      `const src = typeof body.locationSource === "string" ? body.locationSource.trim() : "";
    data.locationSource = src === "manual_paste" || src === "device" ? src : "device";`
    );
    f = f.replace(
      "return NextResponse.json({ track });",
      "revalidateAfterTrackMutation(user.id);\n  return NextResponse.json({ track });"
    );
    write("src/app/api/tracks/[trackId]/route.ts", f);
  }
}

// --- tracks/route.ts GET/POST ---
{
  let f = read("src/app/api/tracks/route.ts");
  if (!f.includes("communityTrackListWhere")) {
    f = f.replace(
      'import { validateLiveRcTrackUrl } from "@/lib/lapWatch/liveRcTrackUrl";',
      'import { validateLiveRcTrackUrl } from "@/lib/lapWatch/liveRcTrackUrl";\nimport { communityTrackListWhere } from "@/lib/tracks/communityTrackAccess";'
    );
    f = f.replace(
      `    const whereBase = {
      userId: user.id,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { location: { contains: q } },
            ],
          }
        : {}),
    };`,
      "    const whereBase = communityTrackListWhere(q);"
    );
    f = f.replace(
      `    const track = await prisma.track.create({
      data: {
        userId: user.id,
        name,
        location: body.location?.trim() || null,
        liveRcUrl,
      },
      select: { id: true, name: true, location: true, liveRcUrl: true, gripTags: true, layoutTags: true },
    });`,
      `    const existing = await prisma.track.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: {
        id: true,
        name: true,
        location: true,
        liveRcUrl: true,
        gripTags: true,
        layoutTags: true,
        latitude: true,
        longitude: true,
      },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "A track with this name already exists in the community catalog.",
          existingTrackId: existing.id,
          track: existing,
        },
        { status: 409 }
      );
    }

    const track = await prisma.track.create({
      data: {
        userId: user.id,
        name,
        location: body.location?.trim() || null,
        liveRcUrl,
      },
      select: {
        id: true,
        name: true,
        location: true,
        liveRcUrl: true,
        gripTags: true,
        layoutTags: true,
        latitude: true,
        longitude: true,
      },
    });`
    );
    write("src/app/api/tracks/route.ts", f);
  }
}

// --- runs/route.ts ---
{
  let f = read("src/app/api/runs/route.ts");
  if (!f.includes("communityTrackByIdWhere")) {
    f = f.replace(
      'import { buildPromptMarkTrackLocation } from "@/lib/trackLocationPrompt";',
      'import { buildPromptMarkTrackLocation } from "@/lib/trackLocationPrompt";\nimport { communityTrackByIdWhere } from "@/lib/tracks/communityTrackAccess";'
    );
    f = f.replace(
      `  const track = body.trackId
    ? await prisma.track.findFirst({
        where: { id: body.trackId, userId: params.userId },
        select: { name: true },
      })
    : null;`,
      `  const track = body.trackId
    ? await prisma.track.findFirst({
        where: communityTrackByIdWhere(body.trackId),
        select: { name: true },
      })
    : null;`
    );
    f = f.replace(
      `  const promptMarkTrackLocation = await buildPromptMarkTrackLocation({
    userId: params.userId,
    trackId: body.trackId,
    loggingComplete,
    newlyCompleted,
    countCompletedRunsAtTrack: (userId, trackId) =>
      prisma.run.count({
        where: { userId, trackId, loggingComplete: true },
      }),
    findTrack: (userId, trackId) =>
      prisma.track.findFirst({
        where: { id: trackId, userId },
        select: {
          id: true,
          name: true,
          latitude: true,
          longitude: true,
        },
      }),
  });`,
      `  const promptMarkTrackLocation = await buildPromptMarkTrackLocation({
    userId: params.userId,
    trackId: body.trackId,
    loggingComplete,
    newlyCompleted,
    hasDismissedRunLocationPrompt: async (userId, trackId) => {
      const row = await prisma.trackLocationRunPromptDismissal.findUnique({
        where: { userId_trackId: { userId, trackId } },
      });
      return row != null;
    },
    findTrack: (trackId) =>
      prisma.track.findFirst({
        where: communityTrackByIdWhere(trackId),
        select: {
          id: true,
          name: true,
          latitude: true,
          longitude: true,
        },
      }),
  });`
    );
    write("src/app/api/runs/route.ts", f);
  }
}

// --- revalidateUser ---
{
  let f = read("src/lib/revalidateUser.ts");
  if (!f.includes('revalidatePath("/tracks")')) {
    f = f.replace(
      `export function revalidateAfterTrackMutation(userId: string): void {
  revalidatePath("/tracks");
  revalidatePath("/runs/new");
  revalidatePath("/events");
  revalidateTag(tracksTag(userId), IMMEDIATE);
}`,
      `export function revalidateAfterTrackMutation(userId: string): void {
  revalidatePath("/tracks");
  revalidatePath("/runs/new");
  revalidatePath("/events");
  revalidateTag(tracksTag(userId), IMMEDIATE);
  revalidatePath("/tracks", "layout");
}`
    );
  }
}

console.log("patch pass 1 done");
