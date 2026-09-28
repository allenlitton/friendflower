// Scenario tests for live trips: live distance keeps your current city up to date.
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, rpc, makeUser } from "./harness.mjs";

let db;
const U = {};

const TARTINE = { p_lat: 37.7620, p_lng: -122.4119 };      // San Francisco
const BRYANT_PARK = { p_lat: 40.7536, p_lng: -73.9832 };   // New York
const SANTA_MONICA = { p_lat: 34.0195, p_lng: -118.4912 }; // Los Angeles
const MID_ATLANTIC = { p_lat: 40.0, p_lng: -40.0 };         // no city near

const friends = async (a, b) => {
  await db.query(`insert into public.connections (user_id, other_id, source) values ($1, $2, 'friend'), ($2, $1, 'friend')`, [a, b]);
};
// Each call pretends the last update was long enough ago to be accepted.
const locate = async (who, where) => {
  await db.query(`delete from private.live_locations where user_id = $1`, [U[who]]);
  return as(db, U[who], () => rpc(db, "update_location", { ...where, p_accuracy_m: 20 }));
};
const trips = async (who) =>
  (await db.query(`select city_id, starts_on::text s, ends_on::text e, from_live from public.trips where user_id = $1 order by starts_on, city_id`, [U[who]])).rows;
const person = (viewer, who) => as(db, U[viewer], () => rpc(db, "person", { p_id: U[who] }));
const today = async (offset = 0) => (await db.query(`select (current_date + $1::int)::text d`, [offset])).rows[0].d;
// Move all of someone's trips back in time, as if days had passed.
const daysPass = (who, n) =>
  db.query(`update public.trips set starts_on = starts_on - $2::int, ends_on = ends_on - $2::int where user_id = $1`, [U[who], n]);

before(async () => {
  db = await freshDb();
  U.thomas = await makeUser(db, { first: "Thomas", city: "new-york" });
  U.arren = await makeUser(db, { first: "Arren", nb: "sf-mission" });
  U.nina = await makeUser(db, { first: "Nina", city: "new-york" });
  await friends(U.thomas, U.arren);
  await db.query(`update public.profiles set share_live_location = true where id in ($1, $2)`, [U.thomas, U.nina]);
});

test("at home, nothing changes", async () => {
  assert.equal(await locate("thomas", BRYANT_PARK), true);
  assert.deepEqual(await trips("thomas"), []);
  assert.equal((await person("arren", "thomas")).now.city, "New York");
});

test("landing in another city starts a live trip there, and asks about dates", async () => {
  await locate("thomas", TARTINE);
  const t = await today();
  assert.deepEqual(await trips("thomas"), [{ city_id: "san-francisco", s: t, e: t, from_live: true }]);

  const p = await person("arren", "thomas");
  assert.equal(p.now.city, "San Francisco");
  assert.equal(p.now.presence, "visiting");
  // Arren sees him on SF Nearby now.
  const nearby = await as(db, U.arren, () => rpc(db, "circle_in_city", { p_city: "san-francisco" }));
  assert.ok(nearby.some((x) => x.first_name === "Thomas"));

  const ask = await as(db, U.thomas, () => rpc(db, "live_trip_to_confirm"));
  assert.equal(ask.city, "San Francisco");
  // Nobody else gets asked about his trip.
  assert.equal(await as(db, U.arren, () => rpc(db, "live_trip_to_confirm")), null);
});

test("more positions the same day don't add more trips; answering stops the question", async () => {
  await locate("thomas", TARTINE);
  assert.equal((await trips("thomas")).length, 1);
  await as(db, U.thomas, () => db.query(`update public.trips set live_asked = true, ends_on = current_date + 4 where user_id = $1`, [U.thomas]));
  assert.equal(await as(db, U.thomas, () => rpc(db, "live_trip_to_confirm")), null);
});

test("coming home early ends the trip yesterday", async () => {
  await daysPass("thomas", 2); // arrived two days ago, planned to leave in two days
  await locate("thomas", BRYANT_PARK);
  const [trip] = await trips("thomas");
  assert.equal(trip.e, await today(-1));
  assert.equal((await person("arren", "thomas")).now.city, "New York");
});

test("staying on past the end carries the live trip on", async () => {
  await locate("thomas", TARTINE); // ended yesterday, back in SF today
  const all = await trips("thomas");
  assert.equal(all.length, 1);
  assert.equal(all[0].e, await today());
});

test("moving to a new city ends the old live trip and starts a new one", async () => {
  await daysPass("thomas", 1);
  await locate("thomas", SANTA_MONICA);
  const all = await trips("thomas");
  assert.deepEqual(all.map((t) => [t.city_id, t.e]), [["san-francisco", await today(-1)], ["los-angeles", await today()]]);
});

test("a live trip that only started today is removed when you leave the same day", async () => {
  await locate("thomas", BRYANT_PARK);
  assert.deepEqual((await trips("thomas")).map((t) => t.city_id), ["san-francisco"]);
});

test("trips you add yourself are never touched, but where you actually are wins", async () => {
  await db.query(`insert into public.trips (user_id, city_id, starts_on, ends_on) values ($1, 'los-angeles', current_date - 1, current_date + 3)`, [U.nina]);
  await locate("nina", TARTINE);
  const all = await trips("nina");
  assert.deepEqual(all.map((t) => [t.city_id, t.from_live]), [["los-angeles", false], ["san-francisco", true]]);
  assert.equal(all[0].e, await today(3));
  assert.equal((await as(db, U.nina, () => rpc(db, "person", { p_id: U.nina }))).now.city, "San Francisco");
});

test("somewhere with no city nearby leaves things alone", async () => {
  const before = await trips("nina");
  await locate("nina", MID_ATLANTIC);
  assert.deepEqual(await trips("nina"), before);
});

test("with live distance off, no trips are made", async () => {
  await db.query(`update public.profiles set share_live_location = false where id = $1`, [U.nina]);
  await db.query(`delete from public.trips where user_id = $1`, [U.nina]);
  assert.equal(await locate("nina", TARTINE), false);
  assert.deepEqual(await trips("nina"), []);
});
