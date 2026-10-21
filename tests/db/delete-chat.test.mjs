// Deleting a chat only removes it for you, and it comes back with just the new messages.
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, rpc, makeUser } from "./harness.mjs";

let db;
const U = {};

const friends = async (a, b) => {
  await db.query(`insert into public.friend_requests (from_id, to_id, status) values ($1, $2, 'accepted')`, [a, b]);
  await db.query(`insert into public.connections (user_id, other_id, source) values ($1, $2, 'friend'), ($2, $1, 'friend')`, [a, b]);
};
const chats = (who) => as(db, U[who], () => rpc(db, "my_chats"));
const bodies = (who, chat) => as(db, U[who], async () =>
  (await db.query(`select body from public.messages where chat_id = $1 order by id`, [chat])).rows.map((r) => r.body));

let chat;

before(async () => {
  db = await freshDb();
  U.arren = await makeUser(db, { first: "Arren", nb: "sf-mission" });
  U.priya = await makeUser(db, { first: "Priya", nb: "sf-noe-valley" });
  await friends(U.arren, U.priya);
  chat = await as(db, U.arren, () => rpc(db, "open_direct_chat", { p_other: U.priya }));
  await as(db, U.arren, () => rpc(db, "send_message", { p_chat: chat, p_body: "hi Priya" }));
  await as(db, U.priya, () => rpc(db, "send_message", { p_chat: chat, p_body: "hi Arren" }));
});

test("deleting a chat hides it and its history for you only", async () => {
  assert.equal((await chats("arren")).length, 1);
  await as(db, U.arren, () => rpc(db, "delete_chat", { p_chat: chat }));
  assert.equal((await chats("arren")).length, 0);
  assert.deepEqual(await bodies("arren", chat), []);
  assert.equal((await chats("priya")).length, 1);
  assert.deepEqual(await bodies("priya", chat), ["hi Priya", "hi Arren"]);
});

test("a new message brings the chat back with only the new messages", async () => {
  await as(db, U.priya, () => rpc(db, "send_message", { p_chat: chat, p_body: "you there?" }));
  const list = await chats("arren");
  assert.equal(list.length, 1);
  assert.equal(list[0].last.body, "you there?");
  assert.equal(list[0].unread, true);
  assert.deepEqual(await bodies("arren", chat), ["you there?"]);
});

test("you can't delete someone else's chat", async () => {
  U.cass = await makeUser(db, { first: "Cass", nb: "sf-mission" });
  await as(db, U.cass, () => rpc(db, "delete_chat", { p_chat: chat }));
  assert.equal((await chats("priya")).length, 1);
  assert.deepEqual(await bodies("priya", chat), ["hi Priya", "hi Arren", "you there?"]);
});
