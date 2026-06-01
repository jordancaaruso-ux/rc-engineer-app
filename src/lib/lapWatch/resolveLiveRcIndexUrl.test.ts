import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLiveRcDashboardHtml,
  parsePracticeSessionListDatesFromHtml,
  buildPracticeSessionListUrl,
} from "./liveRcIndexHtmlParse";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");

test("parseLiveRcDashboardHtml finds current event and live practice", () => {
  const html = fixture("tftr-dashboard.html");
  const parsed = parseLiveRcDashboardHtml(html, "https://tftr.liverc.com/");
  assert.equal(parsed.livePractice, true);
  assert.match(parsed.currentEventHubUrl ?? "", /view_event.*id=12345/);
});

test("parsePracticeSessionListDatesFromHtml picks latest date", () => {
  const html = fixture("tftr-practice-month.html");
  const dates = parsePracticeSessionListDatesFromHtml(html, "https://tftr.liverc.com/practice/");
  assert.deepEqual(dates, ["2026-05-31", "2026-05-29"]);
});

test("buildPracticeSessionListUrl", () => {
  const url = buildPracticeSessionListUrl("https://tftr.liverc.com", "2026-05-31");
  assert.match(url, /session_list/);
  assert.match(url, /d=2026-05-31/);
});