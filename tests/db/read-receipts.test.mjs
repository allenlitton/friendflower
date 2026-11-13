// Read receipts: you see the newest message each other member has read, only
// while you both have read receipts on.
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, rpc, makeUser } from "./harness.mjs";

let db;
const U = {};
let chat;

const friends = async (a, b) => {
  await db.query(`insert into public.friend_requests (from_id, to_id, status) values ($1, $2, 'accepted')`, [a, b]);
  await db.query(`insert into public.connections (user_id, other_id, source) values ($1, $2, 'friend'), ($2, $1, 'friend')`, [a, b]);
};
const reads = (who) => as(db, U[who], () => rpc(db, "chat_reads", { p_chat: chat }));
const lastRead = async (who) => (await reads(who))[0]?.last_read_id ?? null;
const receipts = (who, on) =>
  db.query(`update public.profiles set show_read_receipts = $2 where id = $1`, [U[who], on]);

let hi;

before(async () => {
  db = await freshDb();
  U.arren = await makeUser(db, { first: "Arren", nb: "sf-mission" });
  U.priya = await makeUser(db, { first: "Priya", nb: "sf-noe-valley" });
  U.cass = await makeUser(db, { first: "Cass", nb: "sf-mission" });
  await friends(U.arren, U.priya);
  chat = await as(db, U.arren, () => rpc(db, "open_direct_chat", { p_other: U.priya }));
});

test("a message isn't read until the other person opens the chat", async () => {
  hi = await as(db, U.arren, () => rpc(db, "send_message", { p_chat: chat, p_body: "hi Priya" }));
  // Priya last had the chat open a minute ago, before this message.
  await db.query(`update public.chat_members set last_read_at = now() - interval '1 minute' where chat_id = $1 and user_id = $2`, [chat, U.priya]);
  assert.equal(await lastRead("arren"), null);

  await as(db, U.priya, () => rpc(db, "mark_read", { p_chat: chat }));
  const [r] = await reads("arren");
  assert.equal(r.user_id, U.priya);
  assert.equal(r.last_read_id, hi);
});

test("turning read receipts off hides them both ways", async () => {
  await receipts("priya", false);
  assert.equal(await lastRead("arren"), null, "Arren can't see that Priya read his");
  const back = await as(db, U.priya, () => rpc(db, "send_message", { p_chat: chat, p_body: "hey" }));
  await as(db, U.arren, () => rpc(db, "mark_read", { p_chat: chat }));
  assert.equal(await lastRead("priya"), null, "and Priya can't see that Arren read hers");

  await receipts("priya", true);
  assert.equal(await lastRead("priya"), back);
});

test("sending a message counts as reading everything before it", async () => {
  const id = await as(db, U.priya, () => rpc(db, "send_message", { p_chat: chat, p_body: "you around?" }));
  assert.equal(await lastRead("arren"), id);
});

test("people outside the chat see nothing", async () => {
  assert.deepEqual(await reads("cass"), []);
});
