// Scenario tests for Concierge watch: who's in your city, or headed to it.
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, rpc, makeUser } from "./harness.mjs";

let db;
const U = {};

const friends = async (a, b) => {
  await db.query(`insert into public.connections (user_id, other_id, source) values ($1, $2, 'friend'), ($2, $1, 'friend')`, [a, b]);
  await db.query(`insert into public.friend_requests (from_id, to_id, status) values ($1, $2, 'accepted')`, [a, b]);
};
const trip = (who, city, from, to, visibility = "fof") =>
  db.query(
    `insert into public.trips (user_id, city_id, starts_on, ends_on, visibility)
     values ($1, $2, current_date + $3::int, current_date + $4::int, $5)`,
    [U[who], city, from, to, visibility],
  );
const clearTrips = () => db.query(`delete from public.trips`);
const watch = (who) => as(db, U[who], () => rpc(db, "concierge_watch"));
const unseen = (who) => as(db, U[who], () => rpc(db, "concierge_unseen_count"));
const markSeen = (who) => as(db, U[who], () => rpc(db, "concierge_mark_seen"));

before(async () => {
  db = await freshDb();
  U.arren = await makeUser(db, { first: "Arren", nb: "sf-mission" });          // lives in San Francisco
  U.thomas = await makeUser(db, { first: "Thomas", city: "new-york" });
  U.nina = await makeUser(db, { first: "Nina", city: "new-york" });
  U.priya = await makeUser(db, { first: "Priya", nb: "sf-noe-valley" });       // lives in San Francisco
  U.stranger = await makeUser(db, { first: "Stranger", city: "new-york" });
  await friends(U.arren, U.thomas);
  await friends(U.arren, U.nina);
  await friends(U.arren, U.priya);
});

test("a friend arriving in your city is flagged to you", async () => {
  await clearTrips();
  await trip("thomas", "san-francisco", 3, 7);
  const w = await watch("arren");
  assert.equal(w.length, 1);
  assert.equal(w[0].friend.first_name, "Thomas");
  assert.equal(w[0].city, "San Francisco");
  assert.equal(w[0].kind, "visiting_you");
  assert.equal(w[0].is_new, true);
});

test("and you are flagged to them when you travel to where they live", async () => {
  await clearTrips();
  await trip("arren", "new-york", 1, 4);
  for (const who of ["thomas", "nina"]) {
    const t = await watch(who);
    assert.equal(t.length, 1);   // Arren is visiting where they live
    assert.ok(t.every((x) => x.kind === "visiting_you" && x.friend.first_name === "Arren"));
  }
  const a = await watch("arren");
  assert.deepEqual(a.map((x) => x.friend.first_name).sort(), ["Nina", "Thomas"]);
  assert.ok(a.every((x) => x.kind === "you_visiting"));
});

test("two friends who live in the same city are not an alert", async () => {
  await clearTrips();
  assert.equal((await watch("arren")).length, 0);
  assert.equal((await watch("priya")).length, 0);
});

test("both travelling to the same place is flagged", async () => {
  await clearTrips();
  await trip("arren", "los-angeles", 2, 5);
  await trip("thomas", "los-angeles", 4, 9);
  const w = await watch("arren");
  assert.equal(w.length, 1);
  assert.equal(w[0].kind, "both_away");
  assert.equal(w[0].city_id, "los-angeles");
  // Only the days you are both there.
  const days = await db.query(`select (current_date + 4)::text a, (current_date + 5)::text b`);
  assert.equal(w[0].from, days.rows[0].a);
  assert.equal(w[0].to, days.rows[0].b);
});

test("trips that do not line up are ignored", async () => {
  await clearTrips();
  await trip("thomas", "san-francisco", -20, -10);    // already over
  await trip("thomas", "san-francisco", 200, 204);    // too far ahead
  assert.equal((await watch("arren")).length, 0);
  await trip("nina", "los-angeles", 1, 3);
  await trip("arren", "los-angeles", 10, 12);
  assert.equal((await watch("arren")).length, 0);
});

test("a trip hidden from you never alerts", async () => {
  await clearTrips();
  await trip("thomas", "san-francisco", 1, 5, "nobody");
  assert.equal((await watch("arren")).length, 0);
  await clearTrips();
  await db.query(`update public.profiles set show_trips = false where id = $1`, [U.thomas]);
  await trip("thomas", "san-francisco", 1, 5);
  assert.equal((await watch("arren")).length, 0);
  await db.query(`update public.profiles set show_trips = true where id = $1`, [U.thomas]);
});

test("only saved friends alert, not friends of friends or blocked people", async () => {
  await clearTrips();
  await trip("stranger", "san-francisco", 1, 5);
  assert.equal((await watch("arren")).length, 0);

  await trip("nina", "san-francisco", 1, 5);
  assert.equal((await watch("arren")).length, 1);
  await db.query(`insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`, [U.arren, U.nina]);
  assert.equal((await watch("arren")).length, 0);
  await db.query(`delete from public.blocks`);
});

test("editing or deleting the trip updates the alert straight away", async () => {
  await clearTrips();
  await trip("thomas", "san-francisco", 1, 5);
  assert.equal((await watch("arren")).length, 1);
  await db.query(`update public.trips set starts_on = current_date + 40, ends_on = current_date + 44`);
  assert.equal((await watch("arren")).length, 1);   // still within the 120-day window
  await db.query(`update public.trips set starts_on = current_date + 200, ends_on = current_date + 204`);
  assert.equal((await watch("arren")).length, 0);
  await clearTrips();
  assert.equal((await watch("arren")).length, 0);
});

test("seen alerts stay quiet, a longer or ongoing stay stays seen, a new trip alerts again", async () => {
  await clearTrips();
  await trip("thomas", "san-francisco", 0, 3);
  assert.equal(await unseen("arren"), 1);
  await markSeen("arren");
  assert.equal(await unseen("arren"), 0);
  assert.equal((await watch("arren"))[0].is_new, false);

  // He extends the trip: not news.
  await db.query(`update public.trips set ends_on = current_date + 6`);
  assert.equal(await unseen("arren"), 0);

  // Thomas has not looked at his own view of this: it is separate.
  assert.equal(await unseen("thomas"), 1);

  // A different, later trip to the same city is news.
  await trip("thomas", "san-francisco", 30, 33);
  assert.equal(await unseen("arren"), 1);
  await markSeen("arren");
  assert.equal(await unseen("arren"), 0);
});

test("people outside the app cannot call the watch or read anyone's seen list", async () => {
  await assert.rejects(() => rpc(db, "concierge_watch"));
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: U.stranger })]);
  try {
    const rows = await db.query(`select * from public.concierge_seen`);
    assert.equal(rows.rows.length, 0);
    await assert.rejects(() => db.query(`select * from private.concierge_overlaps($1)`, [U.arren]));
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
});
