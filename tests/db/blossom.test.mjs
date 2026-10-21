// The free plan's limits, and turning Blossom on with a code.
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, asServer, rpc, makeUser } from "./harness.mjs";

let db;
const U = {};
const friends = async (a, b) => {
  await db.query(`insert into public.connections (user_id, other_id, source) values ($1, $2, 'friend'), ($2, $1, 'friend')`, [a, b]);
  await db.query(`insert into public.friend_requests (from_id, to_id, status, responded_at) values ($1, $2, 'accepted', now())`, [a, b]);
};
const call = (who, fn, args) => as(db, U[who], () => rpc(db, fn, args));
const worldCount = async (who) => new Set((await call(who, "world")).flatMap((c) => c.people.map((p) => p.id))).size;

before(async () => {
  db = await freshDb();
  U.free = await makeUser(db, { first: "Free", nb: "sf-mission", free: true });
  U.paid = await makeUser(db, { first: "Paid", nb: "sf-mission" });
  for (let i = 0; i < 12; i++) {
    const f = await makeUser(db, { first: `Pal${i}`, nb: "sf-mission" });
    await db.query(`update public.profiles set share_live_location = true where id = $1`, [f]);
    await friends(U.free, f);
    await friends(U.paid, f);
  }
});

test("a new member is on the free plan", async () => {
  const plan = await call("free", "my_plan");
  assert.equal(plan.plan, "free");
  assert.equal(plan.friends, 12);
  assert.equal((await call("paid", "my_plan")).plan, "blossom");
});

test("World shows 5 saved friends on the free plan, everyone on Blossom", async () => {
  assert.equal(await worldCount("free"), 5);
  assert.equal(await worldCount("paid"), 12);
});

test("Nearby shows the 10 closest on the free plan, and says how many there are", async () => {
  assert.equal((await call("free", "circle_in_city", { p_city: "san-francisco" })).length, 10);
  assert.equal(await call("free", "circle_in_city_count", { p_city: "san-francisco" }), 12);
  assert.equal((await call("paid", "circle_in_city", { p_city: "san-francisco" })).length, 12);
});

test("seeing a city before your trip starts is Blossom only", async () => {
  for (const who of ["free", "paid"]) {
    await db.query(`insert into public.trips (user_id, city_id, starts_on, ends_on) values ($1, 'new-york', current_date + 10, current_date + 14)`, [U[who]]);
  }
  const args = { p_city: "new-york", p_from: "2099-01-01", p_to: "2099-01-02" };
  await db.query(`update public.trips set starts_on = '2099-01-01', ends_on = '2099-01-05' where city_id = 'new-york'`);
  await assert.rejects(call("free", "circle_in_city", args), /part of Blossom/);
  assert.deepEqual(await call("paid", "circle_in_city", args), []);
});

test("asking for a delivery and Fo Concierge are Blossom only", async () => {
  await assert.rejects(call("free", "request_delivery", { p_from: "san-francisco", p_to: "new-york", p_by: "2099-01-01" }), /part of Blossom/);
  const begin = (who) => asServer(db, () => rpc(db, "srv_fo_begin", { p_user: U[who], p_chat: null, p_text: "hi" }));
  assert.equal((await begin("free")).status, "blossom");
  assert.equal((await begin("paid")).status, "ok");
});

test("nobody can give themselves Blossom", async () => {
  await assert.rejects(as(db, U.free, () => db.query(`insert into private.memberships (user_id, source, until) values ($1, 'paid', now() + interval '1 year')`, [U.free])));
  await assert.rejects(as(db, U.free, () => db.query(`select private.is_blossom($1)`, [U.free])));
});

test("FRIEND33 gives a year of Blossom, once", async () => {
  assert.equal((await call("free", "redeem_code", { p_code: "FRIEND34" })).error, "That code isn't valid.");
  const r = await call("free", "redeem_code", { p_code: " friend33 " });
  assert.equal(r.plan, "blossom");
  const days = (new Date(r.until) - Date.now()) / 86_400_000;
  assert.ok(days > 360 && days < 370, `about a year, got ${days} days`);
  assert.equal((await call("free", "redeem_code", { p_code: "FRIEND33" })).error, "You've already used this code.");
  assert.equal((await call("free", "my_plan")).plan, "blossom");
  assert.equal(await worldCount("free"), 12);
});

test("wrong guesses are limited", async () => {
  for (let i = 0; i < 9; i++) assert.match((await call("free", "redeem_code", { p_code: `GUESS${i}` })).error, /isn't valid/);
  assert.match((await call("free", "redeem_code", { p_code: "GUESS" })).error, /Too many tries/);
});
