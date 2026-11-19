// Invite hand-off: an iPhone without the app notes the invite before the App
// Store; the new app account picks it up once, from the same network, within an hour.
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, asServer, rpc, makeUser } from "./harness.mjs";

let db;
let arren, code;

before(async () => {
  db = await freshDb();
  arren = await makeUser(db, { first: "Arren" });
  code = (await db.query(`select invite_code from public.profiles where id = $1`, [arren])).rows[0].invite_code;
});

test("the server notes an invite and hands it back once, to the same network", async () => {
  await asServer(db, () => rpc(db, "srv_note_invite_handoff", { p_ip_hash: "net-a", p_code: code }));
  assert.equal(await asServer(db, () => rpc(db, "srv_take_invite_handoff", { p_ip_hash: "net-b" })), null);
  assert.equal(await asServer(db, () => rpc(db, "srv_take_invite_handoff", { p_ip_hash: "net-a" })), code);
  assert.equal(await asServer(db, () => rpc(db, "srv_take_invite_handoff", { p_ip_hash: "net-a" })), null);
});

test("unknown codes aren't noted, and old notes expire", async () => {
  await asServer(db, () => rpc(db, "srv_note_invite_handoff", { p_ip_hash: "net-c", p_code: "nope" }));
  assert.equal(await asServer(db, () => rpc(db, "srv_take_invite_handoff", { p_ip_hash: "net-c" })), null);

  await asServer(db, () => rpc(db, "srv_note_invite_handoff", { p_ip_hash: "net-d", p_code: code }));
  await db.query(`update private.invite_handoffs set created_at = now() - interval '2 hours'`);
  assert.equal(await asServer(db, () => rpc(db, "srv_take_invite_handoff", { p_ip_hash: "net-d" })), null);
});

test("signed-in users and visitors can't call the hand-off functions", async () => {
  const someone = await makeUser(db, { first: "Priya" });
  await assert.rejects(as(db, someone, () => rpc(db, "srv_take_invite_handoff", { p_ip_hash: "net-a" })));
  await assert.rejects(as(db, someone, () => rpc(db, "srv_note_invite_handoff", { p_ip_hash: "x", p_code: code })));
});
