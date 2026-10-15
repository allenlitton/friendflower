// Scenario tests for package deliveries: who gets matched, and the chat that opens.
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, rpc, makeUser } from "./harness.mjs";

let db;
const U = {};
const offer = (who, city, from, to, { legs = "both", luggage = true, space = "some", open = true } = {}) =>
  db.query(
    `insert into public.trips (user_id, city_id, starts_on, ends_on, visibility, deliver_open, deliver_legs, deliver_luggage, deliver_space)
     values ($1, $2, current_date + $3::int, current_date + $4::int, 'nobody', $5, $6, $7, $8)`,
    [U[who], city, from, to, open, open ? legs : null, open ? luggage : null, open && luggage ? space : null],
  );
const ask = (who, from, to, by, scope = "network", after = null) =>
  as(db, U[who], () => rpc(db, "request_delivery", { p_from: from, p_to: to, p_by: by, p_scope: scope, p_after: after }));
const day = async (offset) => (await db.query(`select (current_date + $1::int)::text d`, [offset])).rows[0].d;

before(async () => {
  db = await freshDb();
  U.sender = await makeUser(db, { first: "Sender", city: "new-york" });
  U.sfer = await makeUser(db, { first: "Sfer", city: "san-francisco" });     // flies SF -> New York
  U.nyer = await makeUser(db, { first: "Nyer", city: "new-york" });          // visits SF, flies home
});

test("nobody has opted in yet", async () => {
  assert.equal(await ask("sender", "san-francisco", "new-york", await day(20)), null);
});

test("an inbound offer matches a stranger outside your circle, and opens a chat", async () => {
  await offer("sfer", "new-york", 5, 9, { legs: "in" });
  const r = await ask("sender", "san-francisco", "new-york", await day(10));
  assert.equal(r.helper, "Sfer S.");
  const chat = await as(db, U.sender, () => rpc(db, "chat_detail", { p_chat: r.chat }));
  assert.equal(chat.other.id, U.sfer);
});

test("it must land by the date", async () => {
  assert.equal(await ask("sender", "san-francisco", "new-york", await day(3)), null);
});

test("an inbound-only offer is not used for the outbound direction", async () => {
  assert.equal(await ask("sender", "new-york", "san-francisco", await day(20)), null);
});

test("an outbound offer carries packages from the city they visit to home", async () => {
  await offer("nyer", "san-francisco", 2, 4, { legs: "out", luggage: false });
  const r = await ask("sender", "san-francisco", "new-york", await day(4));
  assert.equal(r.helper, "Nyer N.");
});

test("the most spare room wins", async () => {
  await offer("sfer", "new-york", 6, 8, { legs: "both", space: "lot" });
  const r = await ask("sender", "san-francisco", "new-york", await day(10));
  assert.equal(r.helper, "Sfer S.");
});

test("trips that are not offered are never matched, and you can't match yourself", async () => {
  await db.query(`delete from public.trips`);
  await offer("sfer", "new-york", 5, 9, { open: false });
  assert.equal(await ask("sender", "san-francisco", "new-york", await day(10)), null);
  await offer("sender", "san-francisco", 1, 3, { legs: "out" });
  assert.equal(await ask("sender", "san-francisco", "new-york", await day(10)), null);
});

test("space must agree with luggage", async () => {
  await assert.rejects(offer("sfer", "new-york", 5, 9, { luggage: true, space: null }));
});

test("circles only skips strangers but finds friends", async () => {
  await db.query(`delete from public.trips`);
  await offer("sfer", "new-york", 5, 9, { legs: "in" });
  assert.equal(await ask("sender", "san-francisco", "new-york", await day(10), "circle"), null);
  assert.ok(await ask("sender", "san-francisco", "new-york", await day(10), "network"));
  await db.query(`insert into public.connections (user_id, other_id, source) values ($1, $2, 'friend'), ($2, $1, 'friend')`, [U.sender, U.sfer]);
  const r = await ask("sender", "san-francisco", "new-york", await day(10), "circle");
  assert.equal(r.helper, "Sfer S.");
});

test("a flexible window only matches arrivals inside it", async () => {
  await db.query(`delete from public.trips`);
  await offer("sfer", "new-york", 5, 9, { legs: "in" });   // arrives day 5
  assert.equal(await ask("sender", "san-francisco", "new-york", await day(12), "network", await day(7)), null);
  assert.ok(await ask("sender", "san-francisco", "new-york", await day(12), "network", await day(3)));
  await assert.rejects(ask("sender", "san-francisco", "new-york", await day(3), "network", await day(7)));
});
