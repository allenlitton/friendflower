// Scenario tests for the friend graph, privacy rules and verification.
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, asServer, rpc, makeUser } from "./harness.mjs";

let db;
const U = {};

before(async () => {
  db = await freshDb();
  U.arren = await makeUser(db, { first: "Arren", nb: "sf-mission" });
  U.priya = await makeUser(db, { first: "Priya", nb: "sf-noe-valley" });
  U.barbara = await makeUser(db, { first: "Barbara", nb: "sf-hayes-valley" });
  U.kenji = await makeUser(db, { first: "Kenji", city: "new-york", nb: "ny-williamsburg" });
  U.theo = await makeUser(db, { first: "Theo" });
  U.shy = await makeUser(db, { first: "Shy", visibility: "first" });
  U.stranger = await makeUser(db, { first: "Stranger" });

  // Everyone registers their own phone hash (the server does this at sign-up).
  for (const [name, id] of Object.entries(U)) {
    await asServer(db, () => rpc(db, "srv_set_identity_hashes", {
      p_user: id, p_items: JSON.stringify([{ kind: "phone", hash: `${name}-phone-hash`.padEnd(64, "0").replace(/[^0-9a-f]/g, "a") }]),
    }));
  }
  // Nearby (circle_in_city) only lists people with live distance on, so turn it on
  // for everyone whose absence below should be down to something else.
  await db.query(`update public.profiles set share_live_location = true where id <> $1`, [U.stranger]);
});

const setLive = (who, on) =>
  as(db, U[who], () => db.query(`update public.profiles set share_live_location = $2 where id = $1`, [U[who], on]));

const hashOf = (name) => `${name}-phone-hash`.padEnd(64, "0").replace(/[^0-9a-f]/g, "a");
const upload = (who, names) =>
  asServer(db, () => rpc(db, "srv_add_contact_hashes", { p_user: U[who], p_hashes: names.map(hashOf) }));

test("contact matches only count as 1st degree when both sides have each other", async () => {
  await upload("arren", ["priya", "theo"]);          // Arren has Priya and Theo
  const r = await upload("priya", ["arren", "barbara", "kenji", "shy"]); // Priya has Arren back
  assert.equal(r.new_matches, 1);                     // Priya<->Arren only (others haven't uploaded)
  await upload("barbara", ["priya"]);
  await upload("kenji", ["priya"]);
  await upload("shy", ["priya"]);

  const circle = await as(db, U.arren, () => rpc(db, "circle_in_city", { p_city: "san-francisco" }));
  const byName = Object.fromEntries(circle.map((p) => [p.first_name, p]));
  assert.equal(byName.Priya.degree, 1);
  assert.equal(byName.Barbara.degree, 2);
  assert.deepEqual(byName.Barbara.via_names, ["Priya P."]);
  assert.equal(byName.Theo, undefined, "one-sided contact match must not appear in the circle");
  assert.equal(byName.Kenji, undefined, "Kenji is in New York");
  assert.equal(byName.Shy, undefined, "Shy only lets 1st-degree connections see them");
});

test("one-sided contact matches show only to the person who has the number", async () => {
  const mine = await as(db, U.arren, () => rpc(db, "inbox"));
  assert.deepEqual(mine.contact_suggestions.map((s) => s.first_name), ["Theo"]);
  const theirs = await as(db, U.theo, () => rpc(db, "inbox"));
  assert.equal(theirs.contact_suggestions.length, 0, "Theo must not learn Arren has his number");
});

test("distance is coarse and neighbourhood-based within a city", async () => {
  const circle = await as(db, U.arren, () => rpc(db, "circle_in_city", { p_city: "san-francisco" }));
  const priya = circle.find((p) => p.first_name === "Priya");
  assert.ok(priya.distance_mi > 0.5 && priya.distance_mi < 2, `got ${priya.distance_mi}`);
  assert.equal(priya.neighbourhood, "Noe Valley");
});

test("you can only browse your home city or a city you have a trip to", async () => {
  await assert.rejects(as(db, U.arren, () => rpc(db, "circle_in_city", { p_city: "new-york" })));
  await as(db, U.arren, () =>
    db.query(`insert into public.trips (user_id, city_id, starts_on, ends_on) values ($1, 'new-york', current_date + 3, current_date + 10)`, [U.arren]));
  const ny = await as(db, U.arren, () =>
    rpc(db, "circle_in_city", { p_city: "new-york", p_from: todayPlus(3), p_to: todayPlus(10) }));
  assert.deepEqual(ny.map((p) => [p.first_name, p.degree, p.presence]), [["Kenji", 2, "lives"]]);
});

test("visitors show as visiting, and hidden trips stay hidden", async () => {
  await as(db, U.kenji, () =>
    db.query(`insert into public.trips (user_id, city_id, starts_on, ends_on, visibility) values ($1, 'san-francisco', current_date - 1, current_date + 5, 'fof')`, [U.kenji]));
  let sf = await as(db, U.arren, () => rpc(db, "circle_in_city", { p_city: "san-francisco" }));
  const k = sf.find((p) => p.first_name === "Kenji");
  assert.equal(k.presence, "visiting");
  assert.equal(k.ends_on, todayPlus(5));

  await as(db, U.kenji, () => db.query(`update public.trips set visibility = 'nobody' where user_id = $1`, [U.kenji]));
  sf = await as(db, U.arren, () => rpc(db, "circle_in_city", { p_city: "san-francisco" }));
  assert.equal(sf.find((p) => p.first_name === "Kenji"), undefined);
  await as(db, U.kenji, () => db.query(`update public.trips set visibility = 'fof' where user_id = $1`, [U.kenji]));
});

test("Nearby leaves out people who haven't turned live distance on", async () => {
  const names = async () =>
    (await as(db, U.arren, () => rpc(db, "circle_in_city", { p_city: "san-francisco" }))).map((p) => p.first_name);
  assert.ok((await names()).includes("Barbara"));
  await setLive("barbara", false);
  assert.ok(!(await names()).includes("Barbara"), "live distance off means off Nearby");
  assert.ok((await names()).includes("Priya"), "others still show");
  const b = await as(db, U.arren, () => rpc(db, "person", { p_id: U.barbara }));
  assert.equal(b.degree, 2, "they still have a profile");
  assert.equal(b.live_on, false);
  await setLive("barbara", true);
});

test("raw tables never expose other people or contact data", async () => {
  await as(db, U.arren, async () => {
    await assert.rejects(db.query(`select * from private.contact_hashes`), /permission denied/);
    await assert.rejects(db.query(`select * from private.identity_hashes`), /permission denied/);
    const profiles = await db.query(`select id from public.profiles`);
    assert.deepEqual(profiles.rows.map((r) => r.id), [U.arren]);
    assert.equal((await db.query(`select * from public.connections`)).rows.length, 0);
    assert.equal((await db.query(`select * from public.trips where user_id <> $1`, [U.arren])).rows.length, 0);
    await assert.rejects(db.query(`select public.srv_add_contact_hashes($1, array['x'])`, [U.arren]), /permission denied/);
  });
});

test("person() is privacy-filtered and never includes contact details", async () => {
  const b = await as(db, U.arren, () => rpc(db, "person", { p_id: U.barbara }));
  assert.equal(b.degree, 2);
  assert.deepEqual(b.mutuals.map((m) => m.first_name), ["Priya"]);
  assert.ok(!JSON.stringify(b).includes("@test.dev"), "no emails");
  assert.ok(!JSON.stringify(b).includes("phone-hash"), "no phone data");
  const nobody = await as(db, U.arren, () => rpc(db, "person", { p_id: U.stranger }));
  assert.equal(nobody, null);
  const far = await as(db, U.priya, () => rpc(db, "person", { p_id: U.kenji }));
  assert.equal(far.degree, 1);
});

test("cross-city distance shows on the profile", async () => {
  await as(db, U.kenji, () => db.query(`delete from public.trips where user_id = $1`, [U.kenji]));
  const k = await as(db, U.priya, () => rpc(db, "person", { p_id: U.kenji }));
  assert.equal(k.distance_kind, "far");
  assert.ok(k.distance_mi > 2500 && k.distance_mi < 2600, `SF-NYC got ${k.distance_mi}`);
});

test("in-app verification: consent, pod chat, one-tap confirm with intro, mutual can leave", async () => {
  const { id } = await as(db, U.arren, () =>
    rpc(db, "request_verification", { p_target: U.barbara, p_method: "in_app", p_mutual: U.priya }));

  // Priya isn't asked until Barbara agrees.
  assert.equal((await as(db, U.priya, () => rpc(db, "inbox"))).verifications.length, 0);
  const bInbox = await as(db, U.barbara, () => rpc(db, "inbox"));
  assert.equal(bInbox.verifications[0].role, "target");

  const chat = await as(db, U.barbara, () => rpc(db, "respond_verification", { p_id: id, p_accept: true }));
  assert.ok(chat);
  assert.equal((await as(db, U.priya, () => rpc(db, "inbox"))).verifications[0].role, "mutual");

  // Arren can't confirm on Priya's behalf.
  await assert.rejects(as(db, U.arren, () => rpc(db, "confirm_verification", { p_id: id, p_confirm: true })));
  await as(db, U.priya, () =>
    rpc(db, "confirm_verification", { p_id: id, p_confirm: true, p_intro: "Barbara, meet Arren — you'll get on." }));

  const b = await as(db, U.arren, () => rpc(db, "person", { p_id: U.barbara }));
  assert.equal(b.verified.method, "in_app");
  assert.equal(b.verified.by.first_name, "Priya");

  await as(db, U.priya, () => rpc(db, "leave_chat", { p_chat: chat }));
  await as(db, U.arren, () => rpc(db, "send_message", { p_chat: chat, p_body: "Coffee Thursday?" }));
  await assert.rejects(as(db, U.priya, () => rpc(db, "send_message", { p_chat: chat, p_body: "hi" })));
  const priyaSees = await as(db, U.priya, () => db.query(`select body from public.messages where chat_id = $1`, [chat]));
  assert.ok(!priyaSees.rows.some((m) => m.body === "Coffee Thursday?"), "left members don't see new messages");
  const barbaraSees = await as(db, U.barbara, () => db.query(`select body from public.messages where chat_id = $1`, [chat]));
  assert.ok(barbaraSees.rows.some((m) => m.body.startsWith("Barbara, meet Arren")));
  const outsider = await as(db, U.theo, () => db.query(`select * from public.messages where chat_id = $1`, [chat]));
  assert.equal(outsider.rows.length, 0);
});

test("verification requests expire after 7 days", async () => {
  const kenjiVisibleToArren = await as(db, U.arren, () => rpc(db, "person", { p_id: U.kenji }));
  assert.equal(kenjiVisibleToArren.degree, 2);
  const { id } = await as(db, U.arren, () =>
    rpc(db, "request_verification", { p_target: U.kenji, p_method: "in_app", p_mutual: U.priya }));
  await db.query(`update public.verifications set expires_at = now() - interval '1 minute' where id = $1`, [id]);
  await assert.rejects(as(db, U.kenji, () => rpc(db, "respond_verification", { p_id: id, p_accept: true })), /no longer open/);
  const k = await as(db, U.arren, () => rpc(db, "person", { p_id: U.kenji }));
  assert.equal(k.verification.status, "expired");
});

test("off-app verification by link: only a third person can confirm", async () => {
  const { token } = await as(db, U.arren, () =>
    rpc(db, "request_verification", { p_target: U.kenji, p_method: "link", p_mutual_name: "Priya (by text)" }));
  assert.ok(token && token.length > 40);
  const view = await as(db, U.kenji, () => rpc(db, "verification_by_token", { p_token: token }));
  assert.equal(view.can_confirm, false);
  await assert.rejects(as(db, U.kenji, () => rpc(db, "confirm_verification_link", { p_token: token, p_confirm: true })));
  await as(db, U.priya, () => rpc(db, "confirm_verification_link", { p_token: token, p_confirm: true }));
  const k = await as(db, U.arren, () => rpc(db, "person", { p_id: U.kenji }));
  assert.equal(k.verified.method, "link");
  assert.equal(k.verified.by.first_name, "Priya");
  await assert.rejects(as(db, U.stranger, () => rpc(db, "confirm_verification_link", { p_token: token, p_confirm: true })));
});

test("self-reported verification is allowed but labelled as such", async () => {
  const shyFriend = await makeUser(db, { first: "Omar" });
  await asServer(db, () => rpc(db, "srv_set_identity_hashes", {
    p_user: shyFriend, p_items: JSON.stringify([{ kind: "phone", hash: hashOf("omar") }]) }));
  await asServer(db, () => rpc(db, "srv_add_contact_hashes", { p_user: shyFriend, p_hashes: [hashOf("priya")] }));
  await upload("priya", ["omar"]);
  await as(db, U.arren, () => rpc(db, "request_verification", { p_target: shyFriend, p_method: "self", p_mutual: U.priya }));
  const o = await as(db, U.arren, () => rpc(db, "person", { p_id: shyFriend }));
  assert.equal(o.verified.method, "self");
  assert.equal(o.verified.by.first_name, "Arren");
});

test("add friend: request then accept, and friends show on the World page", async () => {
  assert.equal(await as(db, U.arren, () => rpc(db, "add_friend", { p_other: U.barbara })), "pending");
  const w0 = await as(db, U.arren, () => rpc(db, "world"));
  assert.equal(w0.length, 0);
  assert.equal(await as(db, U.barbara, () => rpc(db, "add_friend", { p_other: U.arren })), "accepted");
  const w = await as(db, U.arren, () => rpc(db, "world"));
  assert.equal(w[0].city, "San Francisco");
  assert.deepEqual(w[0].people.map((p) => p.first_name), ["Barbara"]);
  // strangers can't be added
  await assert.rejects(as(db, U.arren, () => rpc(db, "add_friend", { p_other: U.stranger })));
});

test("blocking hides both people from each other and stops messages", async () => {
  const chat = await as(db, U.arren, () => rpc(db, "open_direct_chat", { p_other: U.priya }));
  await as(db, U.arren, () => rpc(db, "send_message", { p_chat: chat, p_body: "hey" }));
  await as(db, U.priya, () => rpc(db, "report_user", { p_other: U.arren, p_reason: "fake_profile", p_details: "not him" }));
  assert.equal(await as(db, U.arren, () => rpc(db, "person", { p_id: U.priya })), null);
  assert.equal(await as(db, U.priya, () => rpc(db, "person", { p_id: U.arren })), null);
  await assert.rejects(as(db, U.arren, () => rpc(db, "send_message", { p_chat: chat, p_body: "hello?" })));
  const chats = await as(db, U.arren, () => rpc(db, "my_chats"));
  assert.ok(!chats.some((c) => c.id === chat));
  const report = await db.query(`select reason from public.reports`);
  assert.equal(report.rows[0].reason, "fake_profile");
  await as(db, U.priya, () => db.query(`delete from public.blocks where blocker_id = $1`, [U.priya]));
});

test("flight matches only show people in your circle on the same flight and day", async () => {
  const mkFlight = (who) => as(db, U[who], async () => {
    const t = await db.query(
      `insert into public.trips (user_id, city_id, starts_on, ends_on) values ($1, 'tokyo', current_date + 20, current_date + 30) returning id`, [U[who]]);
    await db.query(
      `insert into public.trip_flights (trip_id, user_id, direction, flight_no, flight_date) values ($1, $2, 'in', 'JL1', current_date + 20)`,
      [t.rows[0].id, U[who]]);
  });
  await mkFlight("arren");
  await mkFlight("barbara");
  await mkFlight("stranger");
  const m = await as(db, U.arren, () => rpc(db, "flight_matches"));
  assert.deepEqual(m.map((x) => x.person.first_name), ["Barbara"]);
});

test("users can't set system-managed fields or read while signed out", async () => {
  await as(db, U.theo, () => db.query(`update public.profiles set onboarded_at = null, invite_code = 'hacked' where id = $1`, [U.theo]));
  const r = await db.query(`select onboarded_at, invite_code from public.profiles where id = $1`, [U.theo]);
  assert.ok(r.rows[0].onboarded_at);
  assert.notEqual(r.rows[0].invite_code, "hacked");

  await db.exec(`set role anon`);
  try {
    await assert.rejects(db.query(`select public.person($1)`, [U.theo]), /permission denied/);
    await assert.rejects(db.query(`select * from public.profiles`), /permission denied/);
  } finally {
    await db.exec(`reset role`);
  }
});

test("invite links create a friendship", async () => {
  const newbie = await makeUser(db, { first: "Nia" });
  const { rows } = await db.query(`select invite_code from public.profiles where id = $1`, [U.theo]);
  await as(db, newbie, () => rpc(db, "redeem_invite", { p_code: rows[0].invite_code }));
  const t = await as(db, newbie, () => rpc(db, "person", { p_id: U.theo }));
  assert.equal(t.degree, 1);
  assert.equal(t.is_friend, true);
});

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test("screen data functions run for a typical user", async () => {
  const chats = await as(db, U.arren, () => rpc(db, "my_chats"));
  assert.ok(chats.length >= 1);
  for (const c of chats) {
    const d = await as(db, U.arren, () => rpc(db, "chat_detail", { p_chat: c.id }));
    assert.ok(d && d.members.length >= 2);
    if (c.kind === "pod") assert.equal(d.verification.status, "confirmed");
  }
  // not a member -> nothing
  assert.equal(await as(db, U.stranger, () => rpc(db, "chat_detail", { p_chat: chats[0].id })), null);

  const venues = await as(db, U.arren, () => rpc(db, "venues_in", { p_city: "san-francisco" }));
  assert.ok(venues.length >= 5);
  assert.ok(venues.every((v) => typeof v.walk_min === "number"));
  await as(db, U.barbara, () => db.query(`insert into public.venue_regulars (user_id, venue_id) values ($1, $2)`, [U.barbara, venues[0].id]));
  const again = await as(db, U.arren, () => rpc(db, "venues_in", { p_city: "san-francisco" }));
  assert.deepEqual(again.find((v) => v.id === venues[0].id).regulars.map((r) => r.first_name), ["Barbara"]);
  const strangerView = await as(db, U.stranger, () => rpc(db, "venues_in", { p_city: "san-francisco" }));
  assert.equal(strangerView.find((v) => v.id === venues[0].id).regulars.length, 0, "regulars only show people in your circle");

  const me = await as(db, U.arren, () => rpc(db, "person", { p_id: U.arren }));
  assert.equal(me.is_me, true);
  const inbox = await as(db, U.arren, () => rpc(db, "inbox"));
  assert.ok(Array.isArray(inbox.friend_requests));
});

test("places people add are shared with their circle only", async () => {
  const id = await as(db, U.barbara, () => rpc(db, "add_place", {
    p_city: "san-francisco", p_neighbourhood: "sf-hayes-valley", p_name: "Barbara's Secret Bakery", p_kind: "coffee", p_note: "Go early" }));
  const seen = async (who) => (await as(db, who, () => rpc(db, "venues_in", { p_city: "san-francisco" }))).find((v) => v.id === id);
  const mine = await seen(U.barbara);
  assert.equal(mine.mine, true);
  assert.equal(mine.i_go, true);
  const arrens = await seen(U.arren);
  assert.equal(arrens.added_by.first_name, "Barbara");
  assert.equal(await seen(U.stranger), undefined, "strangers don't see circle places");
  const direct = await as(db, U.stranger, () => db.query(`select id from public.venues where id = $1`, [id]));
  assert.equal(direct.rows.length, 0, "and can't read them from the table either");
  await as(db, U.arren, () => rpc(db, "remove_place", { p_id: id }));
  assert.ok(await seen(U.barbara), "only the person who added it can remove it");
  await as(db, U.barbara, () => rpc(db, "remove_place", { p_id: id }));
  assert.equal(await seen(U.barbara), undefined);
  await assert.rejects(as(db, U.barbara, () => rpc(db, "add_place", {
    p_city: "san-francisco", p_neighbourhood: "ny-soho", p_name: "Wrong city", p_kind: "bar" })));
});

test("find a friend by email/phone: found, not found, self, blocked, and daily limit", async () => {
  const find = (who, h) => asServer(db, () => rpc(db, "srv_find_person", { p_user: U[who], p_hash: h }));
  const r = await find("stranger", hashOf("theo"));
  assert.equal(r.status, "found");
  assert.equal(r.person.first_name, "Theo");
  assert.equal(await as(db, U.stranger, () => rpc(db, "add_friend", { p_other: U.theo })), "pending",
    "finding someone lets you send them a friend request");
  assert.equal((await find("stranger", "f".repeat(64))).status, "not_found");
  assert.equal((await find("stranger", hashOf("stranger"))).status, "self");
  await as(db, U.theo, () => rpc(db, "block_user", { p_other: U.stranger }));
  assert.equal((await find("stranger", hashOf("theo"))).status, "not_found", "blocked people can't be found");
  for (let i = 0; i < 30; i++) await find("kenji", "e".repeat(64));
  assert.equal((await find("kenji", hashOf("priya"))).status, "limit");
  await assert.rejects(as(db, U.kenji, () => rpc(db, "srv_find_person", { p_user: U.kenji, p_hash: hashOf("priya") })), /permission denied/);
});
