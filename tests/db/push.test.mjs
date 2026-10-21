// Push notifications: who gets queued, and that tokens stay private.
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, rpc, makeUser } from "./harness.mjs";

let db;
const U = {};
const outbox = async () => (await db.query(`select * from private.push_outbox order by id`)).rows;
const clear = () => db.query(`delete from private.push_outbox`);
const register = (u, token) => db.query(`select public.srv_push_register($1, $2)`, [u, token]);

before(async () => {
  db = await freshDb();
  U.arren = await makeUser(db, { first: "Arren", nb: "sf-mission" });
  U.priya = await makeUser(db, { first: "Priya", nb: "sf-noe-valley" });
  U.sam = await makeUser(db, { first: "Sam", nb: "sf-mission" });
  await db.query(`insert into public.friend_requests (from_id, to_id, status) values ($1, $2, 'accepted')`, [U.arren, U.priya]);
  await db.query(`insert into public.connections (user_id, other_id, source) values ($1, $2, 'friend'), ($2, $1, 'friend')`, [U.arren, U.priya]);
});

test("nothing is queued for people without the app registered", async () => {
  const chat = await as(db, U.arren, () => rpc(db, "open_direct_chat", { p_other: U.priya }));
  await as(db, U.arren, () => rpc(db, "send_message", { p_chat: chat, p_body: "hello" }));
  assert.equal((await outbox()).length, 0);
});

test("a message notifies the other person, not the sender", async () => {
  await register(U.priya, "tok-priya");
  await register(U.arren, "tok-arren");
  const chat = await as(db, U.arren, () => rpc(db, "open_direct_chat", { p_other: U.priya }));
  await as(db, U.arren, () => rpc(db, "send_message", { p_chat: chat, p_body: "lunch?" }));
  const rows = await outbox();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, U.priya);
  assert.equal(rows[0].body, "lunch?");
  assert.equal(rows[0].url, `/chat/${chat}`);
  assert.match(rows[0].title, /^Arren/);
});

test("blocked people do not trigger notifications", async () => {
  await clear();
  const chat = await as(db, U.arren, () => rpc(db, "open_direct_chat", { p_other: U.priya }));
  await db.query(`insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`, [U.priya, U.arren]);
  await db.query(`insert into public.messages (chat_id, sender_id, body) values ($1, $2, 'ping')`, [chat, U.arren]);
  assert.equal((await outbox()).length, 0);
  await db.query(`delete from public.blocks`);
});

test("friend requests and acceptances notify the right person", async () => {
  await clear();
  await register(U.sam, "tok-sam");
  await db.query(`insert into public.friend_requests (from_id, to_id) values ($1, $2)`, [U.arren, U.sam]);
  let rows = await outbox();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, U.sam);
  assert.equal(rows[0].body, "wants to be friends");
  await clear();
  const req = (await db.query(`select id from public.friend_requests where to_id = $1`, [U.sam])).rows[0].id;
  await as(db, U.sam, () => rpc(db, "respond_friend_request", { p_id: req, p_accept: true }));
  rows = await outbox();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, U.arren);
  assert.match(rows[0].body, /accepted/);
});

test("claiming drains the outbox with tokens; dead tokens are dropped", async () => {
  await clear();
  await db.query(`select private.push_enqueue($1, 'T', 'B', '/chats')`, [U.priya]);
  await register(U.priya, "tok-priya-2");
  const claimed = (await db.query(`select public.srv_push_claim() as c`)).rows[0].c;
  assert.equal(claimed.length, 1);
  assert.deepEqual(claimed[0].tokens.map((t) => t.token).sort(), ["tok-priya", "tok-priya-2"]);
  assert.equal((await outbox()).length, 0);
  await db.query(`select public.srv_push_token_result('tok-priya-2', null, true)`);
  await db.query(`select public.srv_push_token_result('tok-priya', 'sandbox', false)`);
  const t = (await db.query(`select token, env from private.push_tokens where user_id = $1`, [U.priya])).rows;
  assert.deepEqual(t, [{ token: "tok-priya", env: "sandbox" }]);
});

test("members cannot read or call the push internals", async () => {
  await assert.rejects(as(db, U.arren, () => db.query(`select * from private.push_tokens`)));
  await assert.rejects(as(db, U.arren, () => db.query(`select public.srv_push_claim()`)));
});

test("a token moves to whoever signs in on the device", async () => {
  await register(U.sam, "tok-shared");
  await register(U.arren, "tok-shared");
  const owner = (await db.query(`select user_id from private.push_tokens where token = 'tok-shared'`)).rows[0].user_id;
  assert.equal(owner, U.arren);
});
