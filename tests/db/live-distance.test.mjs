// Scenario tests for live distance (opt-in live location on Nearby and profiles).
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, rpc, makeUser } from "./harness.mjs";

let db;
const U = {};

// Real spots in San Francisco.
const TARTINE = { p_lat: 37.7620, p_lng: -122.4119 };   // the Mission
const DOLORES = { p_lat: 37.7596, p_lng: -122.4269 };   // ~0.8 mi from Tartine
const SACRAMENTO = { p_lat: 38.5816, p_lng: -121.4944 }; // far outside SF

const friends = async (a, b) => {
  await db.query(`insert into public.connections (user_id, other_id, source) values ($1, $2, 'friend'), ($2, $1, 'friend')`, [a, b]);
};
const setProfile = (who, patch) => as(db, U[who], () => {
  const keys = Object.keys(patch);
  return db.query(`update public.profiles set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`,
    [U[who], ...keys.map((k) => patch[k])]);
});
const locate = (who, where, accuracy = 20) =>
  as(db, U[who], () => rpc(db, "update_location", { ...where, p_accuracy_m: accuracy }));
// Pretend the last update happened a while ago (as the database owner).
const age = (who, interval) =>
  db.query(`update private.live_locations set updated_at = now() - $2::interval where user_id = $1`, [U[who], interval]);
const nearby = (who) => as(db, U[who], () => rpc(db, "circle_in_city", { p_city: "san-francisco" }));
const find = (list, name) => list.find((p) => p.first_name === name);

before(async () => {
  db = await freshDb();
  U.arren = await makeUser(db, { first: "Arren", nb: "sf-mission" });
  U.priya = await makeUser(db, { first: "Priya", nb: "sf-noe-valley" });
  U.barbara = await makeUser(db, { first: "Barbara", nb: "sf-hayes-valley" });
  U.kenji = await makeUser(db, { first: "Kenji", nb: "sf-mission" });
  await friends(U.arren, U.priya);
  await friends(U.arren, U.barbara);
  await friends(U.arren, U.kenji);
});

test("live location is off by default and nothing is stored", async () => {
  assert.equal(await locate("arren", TARTINE), false);
  const { rows } = await db.query(`select count(*)::int n from private.live_locations`);
  assert.equal(rows[0].n, 0);
  assert.equal(find(await nearby("arren"), "Priya").distance_live, false);
});

test("when both share, Nearby shows the real distance instead of neighbourhoods", async () => {
  const before = find(await nearby("arren"), "Priya").distance_mi; // Mission <-> Noe Valley centres
  await setProfile("arren", { share_live_location: true });
  await setProfile("priya", { share_live_location: true });
  assert.equal(await locate("arren", TARTINE), true);
  assert.equal(await locate("priya", DOLORES), true);

  const priya = find(await nearby("arren"), "Priya");
  assert.equal(priya.distance_live, true);
  assert.ok(priya.distance_mi > 0.6 && priya.distance_mi < 1, `got ${priya.distance_mi}`);
  assert.notEqual(priya.distance_mi, before);
  // And it's the same from the other side.
  assert.equal(find(await nearby("priya"), "Arren").distance_mi, priya.distance_mi);
});

test("profiles show live distance too", async () => {
  const p = await as(db, U.arren, () => rpc(db, "person", { p_id: U.priya }));
  assert.equal(p.distance_live, true);
  assert.equal(p.distance_kind, "nearby");
  assert.ok(p.distance_mi > 0.6 && p.distance_mi < 1);
});

test("someone who doesn't share keeps the neighbourhood estimate", async () => {
  const barbara = find(await nearby("arren"), "Barbara");
  assert.equal(barbara.distance_live, false);
  assert.ok(barbara.distance_mi > 0, "falls back to neighbourhood distance");
});

test("you only see live distances if you share your own", async () => {
  // Barbara doesn't share, so Arren's live position must not be used for her.
  const arren = find(await nearby("barbara"), "Arren");
  assert.equal(arren.distance_live, false);
});

test("nobody can read coordinates: not from the table, not from any result", async () => {
  await assert.rejects(as(db, U.priya, () => db.query(`select * from private.live_locations`)));
  await assert.rejects(as(db, U.priya, () => db.query(`select * from private.live_point($1, 'san-francisco')`, [U.arren])));
  const everything = JSON.stringify([
    await nearby("priya"),
    await as(db, U.priya, () => rpc(db, "person", { p_id: U.arren })),
  ]);
  assert.ok(!everything.includes("37.762") && !everything.includes("122.412"), "Arren's coordinates leaked");
  assert.ok(!/"(lat|lng)"/.test(everything));
});

test("positions are rounded to ~100 m before they're stored", async () => {
  await age("arren", "1 minute");
  await locate("arren", { p_lat: 37.762049, p_lng: -122.411937 });
  const { rows } = await db.query(`select lat, lng from private.live_locations where user_id = $1`, [U.arren]);
  assert.deepEqual([rows[0].lat, rows[0].lng], [37.762, -122.412]);
});

test("updates are rate-limited, and impossible jumps are ignored", async () => {
  assert.equal(await locate("arren", TARTINE), false, "second update within 20 seconds is skipped");
  await age("arren", "1 minute");
  assert.equal(await locate("arren", SACRAMENTO), false, "75 miles in a minute is ignored");
  assert.equal(await locate("arren", DOLORES), true, "0.8 mi in a minute is fast but possible");
  await age("arren", "1 minute");
  assert.equal(await locate("arren", TARTINE, 2000), false, "very rough fixes are ignored");
});

test("stale positions stop counting after 30 minutes", async () => {
  await age("priya", "31 minutes");
  assert.equal(find(await nearby("arren"), "Priya").distance_live, false);
  // ...and are erased the next time anyone reports a position.
  await age("arren", "1 minute");
  await locate("arren", TARTINE);
  const { rows } = await db.query(`select count(*)::int n from private.live_locations where user_id = $1`, [U.priya]);
  assert.equal(rows[0].n, 0);
});

test("a live position outside the city isn't used there", async () => {
  await setProfile("kenji", { share_live_location: true });
  assert.equal(await locate("kenji", SACRAMENTO), true);
  const kenji = find(await nearby("arren"), "Kenji");
  assert.equal(kenji.distance_live, false);
});

test("turning off live location, or distance, erases the position", async () => {
  await setProfile("kenji", { share_live_location: false });
  let { rows } = await db.query(`select count(*)::int n from private.live_locations where user_id = $1`, [U.kenji]);
  assert.equal(rows[0].n, 0);

  await db.query(`insert into private.live_locations (user_id, lat, lng) values ($1, 37.7596, -122.4269)
                  on conflict (user_id) do update set updated_at = now()`, [U.priya]);
  await setProfile("priya", { show_distance: false });
  ({ rows } = await db.query(`select count(*)::int n from private.live_locations where user_id = $1`, [U.priya]));
  assert.equal(rows[0].n, 0);
  const priya = find(await nearby("arren"), "Priya");
  assert.equal(priya.distance_mi, null, "distance off means no distance at all");
  assert.equal(priya.distance_live, false);
});

test("signed-out visitors can't report a position", async () => {
  await db.exec(`set role anon`);
  try {
    await assert.rejects(db.query(`select public.update_location(37.76, -122.41)`));
  } finally {
    await db.exec(`reset role`);
  }
});
