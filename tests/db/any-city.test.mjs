// Scenario tests for living anywhere: any city, not just the live-map ones.
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, asServer, rpc, makeUser } from "./harness.mjs";

let db;
const U = {};

const PORTLAND_OR = [5746545, "Portland", "Oregon", "United States", 45.52345, -122.67621, "America/Los_Angeles"];
const PORTLAND_ME = [4975802, "Portland", "Maine", "United States", 43.66147, -70.25533, "America/New_York"];
const addCity = (args) => asServer(db, async () =>
  (await db.query(`select public.srv_add_city($1, $2, $3, $4, $5, $6, $7) as v`, args)).rows[0].v);

// Accepted friends, the way add_friend + respond_friend_request leave them.
const friends = async (a, b) => {
  await db.query(`insert into public.friend_requests (from_id, to_id, status) values ($1, $2, 'accepted')`, [a, b]);
  await db.query(`insert into public.connections (user_id, other_id, source) values ($1, $2, 'friend'), ($2, $1, 'friend')`, [a, b]);
};
const world = (who) => as(db, U[who], () => rpc(db, "world"));

before(async () => {
  db = await freshDb();
  U.arren = await makeUser(db, { first: "Arren", nb: "sf-mission" });
  U.priya = await makeUser(db, { first: "Priya", nb: "sf-noe-valley" });
  await friends(U.arren, U.priya);
});

test("a new city gets its own row once, and same-named cities don't collide", async () => {
  const or = await addCity(PORTLAND_OR);
  const me = await addCity(PORTLAND_ME);
  assert.equal(or, "portland");
  assert.equal(me, "portland-maine");
  assert.equal(await addCity(PORTLAND_OR), "portland");
  const { rows } = await db.query(`select is_launched, region, short_name from public.cities where id = 'portland'`);
  assert.deepEqual(rows[0], { is_launched: false, region: "Oregon", short_name: "POR" });
});

test("only the server can add cities", async () => {
  await assert.rejects(as(db, U.arren, () =>
    db.query(`select public.srv_add_city($1, $2, $3, $4, $5, $6, $7)`, [1, "Nowhere", null, "Atlantis", 0, 0, null])));
});

test("a friend living in a city without the live map still shows on World", async () => {
  const city = await addCity(PORTLAND_OR);
  await as(db, U.priya, () =>
    db.query(`update public.profiles set home_city_id = $2, home_neighbourhood_id = null where id = $1`, [U.priya, city]));
  const portland = (await world("arren")).find((c) => c.city_id === city);
  assert.ok(portland, "Portland is on Arren's World");
  assert.equal(portland.is_launched, false);
  assert.deepEqual(portland.people.map((p) => [p.first_name, p.presence]), [["Priya", "lives"]]);
});
