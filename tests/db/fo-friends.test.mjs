// Scenario tests for Fo Concierge and your friends: the opt-in, what Fo sees,
// and messages Fo drafts that only go out when you tap Send.
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, asServer, rpc, makeUser } from "./harness.mjs";

let db;
const U = {};

const friends = async (a, b) => {
  await db.query(`insert into public.connections (user_id, other_id, source) values ($1, $2, 'friend'), ($2, $1, 'friend')`, [a, b]);
  await db.query(`insert into public.friend_requests (from_id, to_id, status) values ($1, $2, 'accepted')`, [a, b]);
};
const begin = (who, text) => asServer(db, () => rpc(db, "srv_fo_begin", { p_user: U[who], p_chat: null, p_text: text }));
const reply = (who, text, actions = []) => asServer(db, () => rpc(db, "srv_fo_update", {
  p_user: U[who], p_chat: null, p_conversation: "c", p_status: "complete", p_text: text, p_actions: JSON.stringify(actions),
}));
const thread = (who) => as(db, U[who], () => rpc(db, "fo_thread", { p_chat: null }));
const share = (who, on, email = null, phone = null) =>
  as(db, U[who], () => rpc(db, "set_fo_sharing", { p_on: on, p_email: email, p_phone: phone }));
const fo = async (who) => { const r = await begin(who, "Who's around?"); await reply(who, "Let me look."); return r.friends; };
const ref = (who) => U[who].slice(-8);

before(async () => {
  db = await freshDb();
  U.arren = await makeUser(db, { first: "Arren", nb: "sf-mission" });
  U.thomas = await makeUser(db, { first: "Thomas", city: "new-york" });
  U.priya = await makeUser(db, { first: "Priya", nb: "sf-noe-valley" });
  U.stranger = await makeUser(db, { first: "Stranger", city: "new-york" });
  await friends(U.arren, U.thomas);
  await friends(U.arren, U.priya);
  await db.query(
    `insert into public.trips (user_id, city_id, starts_on, ends_on, visibility) values ($1, 'london', current_date + 10, current_date + 14, 'fof')`,
    [U.thomas]);
});

test("sharing is off by default", async () => {
  assert.deepEqual(await as(db, U.thomas, () => rpc(db, "my_fo_sharing")), { on: false, email: null, phone: null });
});

test("without the opt-in, Fo only gets a friend's name", async () => {
  const list = await fo("arren");
  assert.deepEqual(list.map((f) => f.name), ["Priya P.", "Thomas T."]);
  const t = list.find((f) => f.name === "Thomas T.");
  assert.deepEqual(t, { ref: ref("thomas"), name: "Thomas T.", shares: false });
});

test("with the opt-in, Fo sees where they are, their trips and the contact details they chose", async () => {
  await share("thomas", true, " Thomas@Example.com ", "+1 415 555 0100");
  assert.deepEqual(await as(db, U.thomas, () => rpc(db, "my_fo_sharing")), { on: true, email: "thomas@example.com", phone: "+1 415 555 0100" });
  const t = (await fo("arren")).find((f) => f.name === "Thomas T.");
  assert.equal(t.shares, true);
  assert.equal(t.now.city, "New York");
  assert.equal(t.now.presence, "lives");
  assert.deepEqual(t.upcoming.map((u) => u.city), ["London"]);
  assert.equal(t.email, "thomas@example.com");
  assert.equal(t.phone, "+1 415 555 0100");
  assert.ok(!("lat" in t) && !("lat" in t.now));       // never a position
});

test("sharing with no email or phone still shares where you are", async () => {
  await share("priya", true);
  const p = (await fo("arren")).find((f) => f.name === "Priya P.");
  assert.equal(p.now.city, "San Francisco");
  assert.equal(p.email, null);
  assert.equal(p.phone, null);
});

test("turning it off takes it all back", async () => {
  await share("thomas", false);
  const t = (await fo("arren")).find((f) => f.name === "Thomas T.");
  assert.deepEqual(t, { ref: ref("thomas"), name: "Thomas T.", shares: false });
});

test("bad contact details are refused", async () => {
  await assert.rejects(share("thomas", true, "not-an-email"));
  await assert.rejects(share("thomas", true, null, "call me"));
});

test("people who aren't your friends never appear", async () => {
  await share("stranger", true, "s@example.com");
  assert.ok(!(await fo("arren")).some((f) => f.name === "Stranger S."));
});

test("nobody can read the opt-in table or call Fo's server functions", async () => {
  await assert.rejects(as(db, U.arren, () => db.query(`select * from private.fo_sharing`)));
  await assert.rejects(as(db, U.arren, () => db.query(`select private.fo_friends($1)`, [U.arren])));
  await assert.rejects(as(db, U.arren, () => db.query(`select * from public.fo_actions`)));
});

test("Fo's drafted message waits for you, and only friends can be drafted to", async () => {
  await begin("arren", "Tell Thomas I'm in New York next week");
  await reply("arren", "Here's a message for Thomas.", [
    { ref: ref("thomas"), body: "Hey! I'm in New York next week, coffee?" },
    { ref: ref("stranger"), body: "Hi stranger" },             // not a friend: dropped
    { ref: "zzzzzzzz", body: "Nobody" },                       // no such person: dropped
  ]);
  const last = (await thread("arren")).messages.at(-1);
  assert.equal(last.actions.length, 1);
  assert.equal(last.actions[0].friend.first_name, "Thomas");
  assert.equal(last.actions[0].status, "pending");
  const n = (await db.query(`select count(*)::int n from public.messages where body like 'Hey! I''m in New York%'`)).rows[0].n;
  assert.equal(n, 0);                                           // nothing sent yet
});

test("tapping Send posts it as you in your chat with them, once", async () => {
  const action = (await thread("arren")).messages.at(-1).actions[0];
  await assert.rejects(as(db, U.thomas, () => rpc(db, "fo_send_action", { p_action: action.id })));   // not theirs
  const chat = await as(db, U.arren, () => rpc(db, "fo_send_action", { p_action: action.id }));
  const msg = (await db.query(`select chat_id, sender_id, body from public.messages where body like 'Hey! I''m in New York%'`)).rows;
  assert.deepEqual(msg, [{ chat_id: chat, sender_id: U.arren, body: "Hey! I'm in New York next week, coffee?" }]);
  assert.equal((await thread("arren")).messages.at(-1).actions[0].status, "sent");
  await assert.rejects(as(db, U.arren, () => rpc(db, "fo_send_action", { p_action: action.id })));    // already sent
});

test("you can dismiss a draft instead", async () => {
  await begin("arren", "Say hi to Priya");
  await reply("arren", "Draft ready.", [{ ref: ref("priya"), body: "Hi Priya!" }]);
  const action = (await thread("arren")).messages.at(-1).actions[0];
  await as(db, U.arren, () => rpc(db, "fo_dismiss_action", { p_action: action.id }));
  assert.equal((await thread("arren")).messages.at(-1).actions[0].status, "dismissed");
  await assert.rejects(as(db, U.arren, () => rpc(db, "fo_send_action", { p_action: action.id })));
});
