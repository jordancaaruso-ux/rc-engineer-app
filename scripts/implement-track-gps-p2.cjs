const fs = require("fs");
const path = require("path");
const root = process.cwd();
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
  console.log("wrote", rel);
}

function dropUserIdFromTrackWhere(f) {
  return f.replace(/where: \{ id: trackId, userId: user\.id \}/g, "where: { id: trackId }")
    .replace(/where: \{ id: body\.trackId, userId: params\.userId \}/g, "where: { id: body.trackId }")
    .replace(/where: \{ id: trackId, userId: user\.id \}/g, "where: { id: trackId }")
    .replace(/where: \{ userId: user\.id \}/g, "where: {}");
}

const pages = [
  "src/app/tracks/page.tsx",
  "src/app/tracks/[trackId]/page.tsx",
  "src/app/runs/new/page.tsx",
  "src/app/runs/[id]/edit/page.tsx",
  "src/app/events/page.tsx",
];

for (const rel of pages) {
  let f = read(rel);
  if (rel.includes("tracks/page")) {
    f = f.replace("where: { userId: user.id },", "where: {},");
    f = f.replace(
      'select: { id: true, name: true, location: true, liveRcUrl: true },',
      'select: { id: true, name: true, location: true, liveRcUrl: true, latitude: true, longitude: true },'
    );
    f = f.replace(
      "Add and manage tracks. Use them when logging runs or creating events.",
      "Search the community track catalog. Add a track only if you cannot find it."
    );
  }
  if (rel.includes("tracks/[trackId]")) {
    f = f.replace("where: { id: trackId, userId: user.id },", "where: { id: trackId },");
    f = f.replace(
      'select: { id: true, name: true, location: true, liveRcUrl: true, createdAt: true },',
      'select: { id: true, name: true, location: true, liveRcUrl: true, createdAt: true, latitude: true, longitude: true, locationSource: true },'
    );
    if (!f.includes("TrackLocationNotSetBanner")) {
      f = f.replace(
        'import { TrackLiveRcUrlEditor } from "@/components/tracks/TrackLiveRcUrlEditor";',
        'import { TrackLiveRcUrlEditor } from "@/components/tracks/TrackLiveRcUrlEditor";\nimport { TrackLocationNotSetBanner } from "@/components/tracks/TrackLocationNotSetBanner";\nimport { TrackLocationEditor } from "@/components/tracks/TrackLocationEditor";'
      );
      f = f.replace(
        '<TrackLiveRcUrlEditor trackId={track.id} initialLiveRcUrl={track.liveRcUrl} />',
        `<TrackLocationNotSetBanner
            trackId={track.id}
            trackName={track.name}
            location={track.location}
            initial={{ latitude: track.latitude, longitude: track.longitude, locationSource: track.locationSource }}
            showCurrentLocation
          />

          <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm">
            <div className="ui-title text-sm text-muted-foreground mb-2">GPS location</div>
            <TrackLocationEditor
              trackId={track.id}
              trackName={track.name}
              location={track.location}
              initial={{ latitude: track.latitude, longitude: track.longitude, locationSource: track.locationSource }}
              showCurrentLocation
            />
          </div>

          <TrackLiveRcUrlEditor trackId={track.id} initialLiveRcUrl={track.liveRcUrl} />`
      );
    }
  }
  if (rel.includes("runs/new") || rel.includes("runs/[id]/edit")) {
    f = f.replace("where: { userId: user.id },", "where: {},");
  }
  if (rel.includes("events/page")) {
    f = f.replace("where: { userId: user.id },", "where: {},");
  }
  write(rel, f);
}

const apiFiles = [
  "src/app/api/events/route.ts",
  "src/app/api/laps/discover-sessions/route.ts",
  "src/app/api/laps/scan-day-url/route.ts",
  "src/app/api/new-run/bootstrap/route.ts",
  "src/app/api/tracks/[trackId]/camera-profiles/route.ts",
  "src/app/api/tracks/[trackId]/favourite/route.ts",
  "src/app/api/videos/route.ts",
  "src/app/videos/analysis/page.tsx",
];

for (const rel of apiFiles) {
  let f = read(rel);
  const before = f;
  f = f.replace(/where: \{ id: trackId, userId: user\.id \}/g, "where: { id: trackId }");
  f = f.replace(/where: \{ id: body\.trackId, userId: user\.id \}/g, "where: { id: body.trackId }");
  f = f.replace(/where: \{ id: trackId, userId: params\.userId \}/g, "where: { id: trackId }");
  f = f.replace(/where: \{ userId: user\.id \},\s*orderBy: \{ name: "asc" \}/g, 'where: {},\n      orderBy: { name: "asc" }');
  if (f !== before) write(rel, f);
}

console.log("patch pass 2 done");
