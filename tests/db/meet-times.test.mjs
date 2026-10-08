// Scenario tests for finding a time in a chat: shared days, suggested slots, taps.
// Run with: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, rpc, makeUser } from "./harness.mjs";

let db;
const U = {};
let chat;

const friends = async (a, b) => {
  await db.query(`insert into public.connections (user_id, other_id, source) values ($1, $2, 'friend'), ($2, $1, 'friend')`, [a, b]);
};
const trip = (who, city, from, to, visibility = "fof") =>
  db.query(
    `insert into public.trips (user_id, city_id, starts_on, ends_on, visibility)
     values ($1, $2, current_date + $3::int, current_date + $4::int, $5)`,
    [U[who], city, from, to, visibility],
  );
const clearTrips = () => db.query(`delete from public.trips`);
const day = async (offset) => (await db.query(`select (current_date + $1::int)::text d`, [offset])).rows[0].d;
const options = (who, c = chat) => as(db, U[who], () => rpc(db, "meet_options", { p_chat: c }));
const state = (who, c = chat) => as(db, U[who], () => rpc(db, "meet_state", { p_chat: c }));
const propose = async (who, slots, c = chat) =>
  as(db, U[who], () => rpc(db, "propose_times", { p_chat: c, p_slots: JSON.stringify(slots) }));
const pick = (who, id, d, part, on = true) =>
  as(db, U[who], () => rpc(db, "pick_time", { p_message: id, p_day: d, p_part: part, p_on: on }));

before(async () => {
  db = await freshDb();
  U.arren = await makeUser(db, { first: "Arren", nb: "sf-mission" });        // lives in San Francisco
  U.thomas = await makeUser(db, { first: "Thomas", city: "new-york" });
  U.priya = await makeUser(db, { first: "Priya", nb: "sf-noe-valley" });     // lives in San Francisco
  U.outsider = await makeUser(db, { first: "Outsider", city: "new-york" });
  await friends(U.arren, U.thomas);
  await friends(U.arren, U.priya);
  chat = await as(db, U.arren, () => rpc(db, "open_direct_chat", { p_other: U.thomas }));
});

test("with no trips, a New Yorker and a San Franciscan share no days", async () => {
  const o = await options("arren");
  assert.deepEqual(o.runs, []);
  assert.deepEqual(o.days, []);
});

test("a visit makes the shared days appear, for both of them", async () => {
  await trip("thomas", "san-francisco", 3, 6);
  for (const who of ["arren", "thomas"]) {
    const o = await options(who);
    assert.equal(o.runs.length, 1);
    assert.equal(o.runs[0].city, "San Francisco");
    assert.equal(o.runs[0].from, await day(3));
    assert.equal(o.runs[0].to, await day(6));
    assert.equal(o.days.length, 4);
  }
});

test("a trip hidden from you adds no shared days", async () => {
  await clearTrips();
  await trip("thomas", "san-francisco", 3, 6, "nobody");
  assert.deepEqual((await options("arren")).days, []);
});

test("two people in the same home city share every day, marked ongoing", async () => {
  const c2 = await as(db, U.arren, () => rpc(db, "open_direct_chat", { p_other: U.priya }));
  const o = await options("arren", c2);
  assert.equal(o.runs.length, 1);
  assert.equal(o.runs[0].ongoing, true);
  assert.equal(o.days.length, 14);
});

test("suggesting times posts one message, and the suggester counts as free", async () => {
  await clearTrips();
  await trip("thomas", "san-francisco", 3, 6);
  const d = await day(4);
  const id = await propose("arren", [{ day: d, part: "evening" }, { day: d, part: "lunch" }, { day: d, part: "evening" }]);
  const msg = (await db.query(`select kind, sender_id, body from public.messages where id = $1`, [id])).rows[0];
  assert.equal(msg.kind, "times");
  assert.equal(msg.sender_id, U.arren);
  assert.match(msg.body, /San Francisco/);

  const s = await state("thomas");
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].options.map((x) => x.part), ["lunch", "evening"]);   // in day order, no duplicates
  assert.ok(s[0].options.every((x) => x.by.length === 1 && x.by[0] === U.arren));
});

test("the other person taps what works, and can take it back", async () => {
  const [{ message_id: id, options: opts }] = await state("thomas");
  const evening = opts.find((x) => x.part === "evening");
  await pick("thomas", id, evening.day, "evening");
  let s = (await state("arren"))[0].options;
  assert.deepEqual(s.find((x) => x.part === "evening").by.sort(), [U.arren, U.thomas].sort());
  assert.deepEqual(s.find((x) => x.part === "lunch").by, [U.arren]);

  await pick("thomas", id, evening.day, "evening", false);
  s = (await state("arren"))[0].options;
  assert.deepEqual(s.find((x) => x.part === "evening").by, [U.arren]);
  // The tap touched the message, so open chats refresh.
});

test("only days you will both be in the same city can be suggested", async () => {
  await assert.rejects(async () => propose("arren", [{ day: await day(30), part: "evening" }]), /not in a city you will both be in/);
  await assert.rejects(async () => propose("arren", [{ day: await day(4), part: "brunch" }]), /time of day/);
  await assert.rejects(async () => propose("arren", []), /between 1 and 24/);
});

test("a time that was not suggested cannot be picked", async () => {
  const [{ message_id: id }] = await state("arren");
  await assert.rejects(async () => pick("thomas", id, await day(5), "morning"), /not suggested/);
});

test("people outside the chat can see, suggest or pick nothing", async () => {
  const [{ message_id: id, options: opts }] = await state("arren");
  assert.deepEqual(await state("outsider"), []);
  assert.equal(await options("outsider"), null);
  await assert.rejects(async () => propose("outsider", [{ day: await day(4), part: "evening" }]), /Not available/);
  await assert.rejects(async () => pick("outsider", id, opts[0].day, opts[0].part), /Not available/);
  // The raw tables are closed too.
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: U.outsider })]);
  try {
    await assert.rejects(async () => db.query(`select * from public.meet_picks`));
    await assert.rejects(async () => db.query(`select * from public.meet_slots`));
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
});

test("after a block, suggesting and picking stop", async () => {
  const [{ message_id: id, options: opts }] = await state("arren");
  await db.query(`insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`, [U.arren, U.thomas]);
  await assert.rejects(async () => propose("arren", [{ day: await day(4), part: "night" }]), /Not available/);
  await assert.rejects(async () => pick("thomas", id, opts[0].day, opts[0].part), /Not available/);
  assert.deepEqual(await state("thomas"), []);
  await db.query(`delete from public.blocks`);
});
