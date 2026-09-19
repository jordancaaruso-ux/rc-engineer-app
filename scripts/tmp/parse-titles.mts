import { extractLiveRcPracticeSessionWhenRaw, parseLiveRcSessionDisplayTimeToUtcIso } from "../../src/lib/lapUrlParsers/livercSessionTime";
for (const t of [
  "Bendigo On Road Radio Control Car Club :: Practice Session for Cooper Webster on August 30, 2026 (Sunday) at 3:38:26pm :: LiveRC",
  "Bendigo On Road Radio Control Car Club :: Practice Session for Justin Vergunst on August 30, 2026 (Sunday) at 3:50:14pm :: LiveRC",
]) { const raw = extractLiveRcPracticeSessionWhenRaw(t); console.log(JSON.stringify(raw), "->", parseLiveRcSessionDisplayTimeToUtcIso(raw ?? "")); }
