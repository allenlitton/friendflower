// Scenario tests for linking the round device and what it can read.
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, asServer, rpc, makeUser, sha } from "./harness.mjs";

let db;
const U = {};

const friends = async (a, b) => {
  await db.query(`insert into public.friend_requests (from_id, to_id, status) values ($1, $2, 'accepted')`, [a, b]);
  await db.query(`insert into public.connections (user_id, other_id, source) values ($1, $2, 'friend'), ($2, $1, 'friend')`, [a, b]);
};
const shareLive = (who) => as(db, U[who], () =>
  db.query(`update public.profiles set share_live_location = true, show_distance = true where id = $1`, [U[who]]));
const start = (hash) => asServer(db, () => rpc(db, "srv_device_pair_start", { p_secret_hash: hash }));
const status = (hash) => asServer(db, () => rpc(db, "srv_device_pair_status", { p_secret_hash: hash }));
const claim = (who, code) => as(db, U[who], () => rpc(db, "claim_device", { p_code: code }));
const summary = (hash) => asServer(db, () => rpc(db, "srv_device_summary", { p_token_hash: hash }));

/** Link a fresh device to `who` and return its key hash. */
const link = async (who, secret) => {
  const hash = await sha(secret);
  const { code } = await start(hash);
  assert.equal((await claim(who, code)).ok, true);
  return hash;
};

before(async () => {
  db = await freshDb();
  U.arren = await makeUser(db, { first: "Arren", nb: "sf-mission" });
  U.priya = await makeUser(db, { first: "Priya", nb: "sf-noe-valley" });
  U.barbara = await makeUser(db, { first: "Barbara", nb: "sf-hayes-valley" });
  U.stranger = await makeUser(db, { first: "Stranger", nb: "sf-mission" });
  await friends(U.arren, U.priya);
  await friends(U.arren, U.barbara);
  await shareLive("priya");
  await shareLive("stranger");
});

test("pairing: code on screen, member types it, device sees it's linked", async () => {
  const hash = await sha("device-secret-1");
  const { code, expires_in } = await start(hash);
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(expires_in, 600);
  assert.deepEqual(await status(hash), { linked: false, expired: false });
  // typed loosely: lower case, with a space
  assert.equal((await claim("arren", `${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`)).ok, true);
  assert.deepEqual(await status(hash), { linked: true, expired: false });
  assert.equal((await as(db, U.arren, () => rpc(db, "my_devices"))).length, 1);
  // a code works once
  assert.equal((await claim("priya", code)).ok, false);
});

test("expired codes don't work", async () => {
  const hash = await sha("device-secret-2");
  const { code } = await start(hash);
  await db.query(`update private.device_pairings set expires_at = now() - interval '1 minute' where code = $1`, [code]);
  assert.equal((await claim("arren", code)).ok, false);
  assert.equal((await status(hash)).expired, true);
});

test("guessing codes is cut off after 10 wrong tries an hour", async () => {
  for (let i = 0; i < 10; i++) assert.equal((await claim("barbara", "ZZZZZZ")).ok, false);
  await assert.rejects(claim("barbara", "ZZZZZZ"), /Too many wrong codes/);
});

test("the summary shows what Arren's own pages show, and nothing about strangers", async () => {
  const hash = await link("arren", "device-secret-3");
  const s = await summary(hash);
  assert.equal(s.linked, true);
  assert.equal(s.me.first_name, "Arren");
  assert.equal(s.city, "San Francisco");
  const nearby = await as(db, U.arren, () => rpc(db, "circle_in_city", { p_city: "san-francisco" }));
  assert.equal(s.nearby.count, nearby.length);
  assert.deepEqual(s.nearby.people.map((p) => p.first_name), ["Priya"]);
  assert.ok(!JSON.stringify(s).includes("Stranger"));
  assert.ok(!JSON.stringify(s).includes(U.priya), "no ids leave the database");
  assert.deepEqual(s.chats, { unread: 0, items: [] });
  assert.ok(Array.isArray(s.trips) && Array.isArray(s.places));
});

test("removing the device turns its key off", async () => {
  const hash = await link("arren", "device-secret-4");
  const mine = await as(db, U.arren, () => rpc(db, "my_devices"));
  const { rows } = await db.query(`select id from private.devices where token_hash = $1`, [hash]);
  // someone else can't remove it
  await as(db, U.priya, () => rpc(db, "remove_device", { p_id: rows[0].id }));
  assert.equal((await summary(hash)).linked, true);
  await as(db, U.arren, () => rpc(db, "remove_device", { p_id: rows[0].id }));
  assert.deepEqual(await summary(hash), { linked: false });
  assert.equal((await as(db, U.arren, () => rpc(db, "my_devices"))).length, mine.length - 1);
});

test("the caller's identity is put back after the summary", async () => {
  const hash = await link("arren", "device-secret-5");
  await db.query(`select set_config('request.jwt.claims', '{}', false)`);
  await asServer(db, async () => {
    const { rows } = await db.query(`select public.srv_device_summary($1) as s, auth.uid() as uid`, [hash]);
    assert.equal(rows[0].s.linked, true);
    assert.equal(rows[0].uid, null);
  });
});

test("only the server can start pairing or read summaries; members can't", async () => {
  await assert.rejects(as(db, U.arren, () => rpc(db, "srv_device_pair_start", { p_secret_hash: "a".repeat(64) })));
  await assert.rejects(as(db, U.arren, () => rpc(db, "srv_device_summary", { p_token_hash: "a".repeat(64) })));
  await assert.rejects(start("not-a-hash"));
});
