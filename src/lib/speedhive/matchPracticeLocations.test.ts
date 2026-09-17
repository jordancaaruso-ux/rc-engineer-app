import test from "node:test";
import assert from "node:assert/strict";
import { rankPracticeLocations, type PracticeLocationRow } from "./matchPracticeLocations";

// Real names from Speedhive's RC directory, 2026-09-16.
const ROWS: PracticeLocationRow[] = [
  { id: 4591, name: "Arena33 DJK Onroad", country: "de", status: "ONLINE" },
  { id: 4592, name: "Arena33 DJK Offroad", country: "de", status: "OFFLINE" },
  { id: 1, name: "Boronia Circuit - Track 6", country: "au", status: "ACTIVE" },
  { id: 2, name: "Sydney On Road Model Car Club", country: "au", status: "OFFLINE" },
  { id: 3, name: "RRCSA Littlehampton", country: "au", status: "ONLINE" },
  { id: 4, name: "AMCA Apeldoorn", country: "nl", status: "ONLINE" },
  { id: 5, name: "RC-Motorsport.nl", country: "nl", status: "OFFLINE" },
  { id: 6, name: "Adrenalin Arena", country: "au", status: "OFFLINE" },
  { id: 7, name: "Littlehampton RC Club", country: "gb", status: "OFFLINE" },
  { id: 8, name: "SERCCC Track", country: "au", status: "ONLINE" },
  { id: 9, name: "MPRCCC Somerville", country: "au", status: "ONLINE" },
  { id: 10, name: "NSWRCRCC", country: "au", status: "ONLINE" },
];

const top = (track: Parameters<typeof rankPracticeLocations>[1]) =>
  rankPracticeLocations(ROWS, track).map((m) => m.id);

test("the distinctive word finds the track, generic words don't", () => {
  assert.deepEqual(top({ name: "Boronia RC Raceway" }), [1]);
  assert.equal(top({ name: "Arena33", countryCode: "de" })[0], 4591);
});

test("generic words alone match nothing", () => {
  assert.deepEqual(top({ name: "RC Raceway Club" }), []);
});

test("the country breaks a tie between two clubs with the same town in their name", () => {
  assert.equal(top({ name: "Littlehampton", countryCode: "gb" })[0], 7);
  assert.equal(top({ name: "Littlehampton", countryCode: "au" })[0], 3);
});

test("the town stands in when the club name says nothing", () => {
  assert.equal(top({ name: "Castle Hill", location: "Apeldoorn, Gelderland" })[0], 4);
});

test("a strong hit drops the weak tail", () => {
  assert.deepEqual(top({ name: "Apeldoorn", location: "NL" }), [4]);
});

test("a full club name finds the club's initials", () => {
  assert.equal(top({ name: "South Eastern Radio Controlled Car Club", location: "Dandenong" })[0], 8);
  assert.equal(top({ name: "Mornington Peninsula RC Car Club" })[0], 9);
  assert.equal(top({ name: "NSW Radio Control Racing Car Club" })[0], 10);
  assert.equal(top({ name: "SOUTH EASTERN RADIO CONTROLLED CAR CLUB" })[0], 8);
});

test("typed initials find the club's full name", () => {
  assert.equal(top({ name: "SORMCC" })[0], 2);
});

test("every match links to the practice page the lap import reads", () => {
  const [m] = rankPracticeLocations(ROWS, { name: "Sydney On Road" });
  assert.equal(m.url, "https://speedhive.mylaps.com/practice/2");
});
