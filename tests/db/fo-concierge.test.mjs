// Scenario tests for Fo Concierge: private threads, limits, and the shared token.
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, asServer, rpc, makeUser } from "./harness.mjs";

let db;
const U = {};
let chat;

const begin = (who, text, c = chat) => asServer(db, () => rpc(db, "srv_fo_begin", { p_user: U[who], p_chat: c, p_text: text }));
const update = (who, status, text, conv = "conv-1", c = chat) =>
  asServer(db, () => rpc(db, "srv_fo_update", { p_user: U[who], p_chat: c, p_conversation: conv, p_status: status, p_text: text }));
const thread = (who, c = chat) => as(db, U[who], () => rpc(db, "fo_thread", { p_chat: c }));

before(async () => {
  db = await freshDb();
  U.arren = await makeUser(db, { first: "Arren", nb: "sf-mission" });
  U.thomas = await makeUser(db, { first: "Thomas", city: "new-york" });
  U.outsider = await makeUser(db, { first: "Outsider", city: "new-york" });
  await db.query(`insert into public.connections (user_id, other_id, source) values ($1, $2, 'friend'), ($2, $1, 'friend')`, [U.arren, U.thomas]);
  chat = await as(db, U.arren, () => rpc(db, "open_direct_chat", { p_other: U.thomas }));
});

test("an empty thread", async () => {
  assert.deepEqual(await thread("arren"), { status: "idle", progress: null, messages: [] });
});

test("starting a request tells Fo who is asking and who they're meeting", async () => {
  const r = await begin("arren", "Book us a table for Friday");
  assert.equal(r.status, "ok");
  assert.equal(r.conversation_id, null);
  assert.equal(r.me, "Arren A.");
  assert.equal(r.home_city, "San Francisco");
  assert.deepEqual(r.others, ["Thomas T."]);
  const t = await thread("arren");
  assert.equal(t.status, "working");
  assert.deepEqual(t.messages.map((m) => [m.role, m.body]), [["me", "Book us a table for Friday"]]);
});

test("one request at a time", async () => {
  assert.equal((await begin("arren", "And flowers?")).status, "busy");
});

test("progress, then the reply, which frees the thread and keeps Fo's conversation", async () => {
  await update("arren", "working", "Calling the restaurant");
  assert.equal((await thread("arren")).progress, "Calling the restaurant");
  await update("arren", "complete", "Booked for 7pm Friday.", "");
  const t = await thread("arren");
  assert.equal(t.status, "idle");
  assert.equal(t.progress, null);
  assert.deepEqual(t.messages.map((m) => m.role), ["me", "fo"]);
  assert.equal((await begin("arren", "Thanks!")).conversation_id, "conv-1");
  await update("arren", "complete", "You're welcome.");
});

test("the thread is private, and Fo's conversation id never reaches the browser", async () => {
  const theirs = await thread("thomas");
  assert.deepEqual(theirs.messages, []);
  assert.ok(!JSON.stringify(await thread("arren")).includes("conv-1"));
  await assert.rejects(as(db, U.arren, () => db.query(`select * from public.fo_threads`)));
  await assert.rejects(as(db, U.arren, () => db.query(`select * from public.fo_messages`)));
});

test("only chat members can ask Fo", async () => {
  assert.equal((await begin("outsider", "Hi")).status, "not_member");
});

test("members can't call the server functions or read the token", async () => {
  await assert.rejects(as(db, U.arren, () => rpc(db, "srv_fo_begin", { p_user: U.arren, p_chat: chat, p_text: "x" })));
  await assert.rejects(as(db, U.arren, () => rpc(db, "srv_fo_auth")));
  await assert.rejects(as(db, U.arren, () => rpc(db, "srv_fo_save_auth", { p_client_id: "c", p_access: "a", p_refresh: "r", p_expires_at: "2030-01-01" })));
});

test("outside chats, each member has one more thread of their own", async () => {
  assert.deepEqual(await thread("outsider", null), { status: "idle", progress: null, messages: [] });
  const r = await begin("outsider", "Find me a courier to Paris", null);
  assert.equal(r.status, "ok");
  assert.deepEqual(r.others, []);
  assert.equal((await begin("outsider", "Again", null)).status, "busy");
  await update("outsider", "complete", "On it.", "conv-out", null);
  assert.equal((await begin("outsider", "Thanks", null)).conversation_id, "conv-out");
  await update("outsider", "complete", "Any time.", "", null);
  assert.deepEqual((await thread("outsider", null)).messages.map((m) => m.role), ["me", "fo", "me", "fo"]);
  assert.deepEqual((await thread("arren", null)).messages, []);
  // It's separate from the member's chat threads.
  assert.ok((await thread("arren")).messages.every((m) => !m.body.includes("Paris")));
  assert.equal((await db.query(`select count(*)::int n from public.fo_threads where user_id = $1 and chat_id is null`, [U.outsider])).rows[0].n, 1);
});

test("with Live distance on, Fo gets your fresh live position and the nearest neighbourhood", async () => {
  const nb = (await db.query(`select name, lat, lng from public.neighbourhoods where id = 'sf-mission'`)).rows[0];
  const ask = async () => { const r = await begin("arren", "Coffee near me?"); await update("arren", "complete", "Sure."); return r.location; };
  const setLive = (on) => db.query(`update public.profiles set share_live_location = $2, show_distance = $2 where id = $1`, [U.arren, on]);
  const putLive = (ago = "0 minutes") => db.query(
    `insert into private.live_locations (user_id, lat, lng, updated_at) values ($1, $2, $3, now() - $4::interval)
     on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = excluded.updated_at`,
    [U.arren, Math.round(nb.lat * 1000) / 1000, Math.round(nb.lng * 1000) / 1000, ago]);

  assert.equal(await ask(), null);                       // off: nothing
  await setLive(true);
  await putLive();
  const loc = await ask();
  assert.equal(loc.neighbourhood, nb.name);
  assert.equal(loc.city, "San Francisco");
  assert.equal(loc.lat, Math.round(nb.lat * 1000) / 1000);
  await putLive("45 minutes");
  assert.equal(await ask(), null);                       // stale: nothing
  await putLive();
  await setLive(false);                                  // turning it off erases it
  assert.equal(await ask(), null);
  assert.equal((await db.query(`select count(*)::int n from private.live_locations where user_id = $1`, [U.arren])).rows[0].n, 0);
});

test("the daily limit", async () => {
  await db.query(`delete from public.fo_messages`);
  for (let i = 0; i < 20; i++) {
    assert.equal((await begin("thomas", `Request ${i}`)).status, "ok");
    await update("thomas", "complete", "Done");
  }
  assert.equal((await begin("thomas", "One more")).status, "limit");
});

test("saving the shared token keeps the refresh token when a refresh doesn't send a new one", async () => {
  await asServer(db, () => rpc(db, "srv_fo_save_auth", { p_client_id: "c1", p_access: "a1", p_refresh: "r1", p_expires_at: "2030-01-01T00:00:00Z" }));
  await asServer(db, () => rpc(db, "srv_fo_save_auth", { p_client_id: "c1", p_access: "a2", p_refresh: null, p_expires_at: "2030-01-02T00:00:00Z" }));
  const a = await asServer(db, () => rpc(db, "srv_fo_auth"));
  assert.equal(a.access_token, "a2");
  assert.equal(a.refresh_token, "r1");
});
