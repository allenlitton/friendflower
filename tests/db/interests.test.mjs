// Interest tags: search existing tags, add/remove your own, and see which ones
// you share with someone on their profile.
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
const search = (who, q) => as(db, U[who], () => rpc(db, "search_interests", { p_query: q }));
const add = (who, name) => as(db, U[who], () => rpc(db, "add_interest", { p_name: name }));
const mine = (who) => as(db, U[who], () => rpc(db, "my_interests"));
const theirs = (who, id) => as(db, U[who], () => rpc(db, "person_interests", { p_id: id }));

before(async () => {
  db = await freshDb();
  U.arren = await makeUser(db, { first: "Arren" });
  U.priya = await makeUser(db, { first: "Priya" });
  U.cass = await makeUser(db, { first: "Cass", city: "new-york" });
  await friends(U.arren, U.priya);
});

test("starter tags show up in search", async () => {
  const hits = await search("arren", "climb");
  const names = hits.map((h) => h.name);
  assert.ok(names.includes("Rock climbing"));
  assert.ok(names.includes("Climbing"));
  assert.equal(names[0], "Climbing", "prefix matches come first");
  assert.ok((await search("arren", "")).length > 0, "empty query lists tags");
});

test("adding by name reuses an existing tag, ignoring case and spacing", async () => {
  const a = await add("arren", "  rock   CLIMBING ");
  assert.equal(a.name, "Rock climbing");
  const again = await add("arren", "Rock climbing");
  assert.equal(again.id, a.id);
  assert.deepEqual((await mine("arren")).map((t) => t.name), ["Rock climbing"]);
  const hits = await search("arren", "rock climbing");
  assert.ok(!hits.some((h) => h.id === a.id), "tags you already have aren't offered again");
});

test("a new name becomes a new tag others can find, while someone has it", async () => {
  const t = await add("priya", "Sourdough");
  assert.equal(t.name, "Sourdough");
  const hits = await search("arren", "sourd");
  assert.equal(hits[0]?.name, "Sourdough");
  assert.equal(hits[0].uses, 1);

  await as(db, U.priya, () => rpc(db, "remove_interest", { p_id: t.id }));
  assert.deepEqual(await search("arren", "sourd"), [], "unused non-starter tags drop out of search");
});

test("shared tags are marked on someone's profile", async () => {
  await add("arren", "Coffee");
  await add("priya", "Coffee");
  await add("priya", "Board games");
  await add("priya", "Rock climbing");
  const tags = await theirs("arren", U.priya);
  assert.deepEqual(
    tags.map((t) => [t.name, t.shared]),
    [["Coffee", true], ["Rock climbing", true], ["Board games", false]],
  );
  const own = await theirs("arren", U.arren);
  assert.ok(own.every((t) => !t.shared), "nothing is 'shared' on your own profile");
});

test("people outside your circle can't see your tags", async () => {
  assert.equal(await theirs("cass", U.priya), null);
});

test("tags are private tables, reachable only through the functions", async () => {
  await assert.rejects(as(db, U.arren, () => db.query(`select * from private.user_interests`)));
  await assert.rejects(as(db, U.arren, () => db.query(`select * from private.interests`)));
});

test("limits", async () => {
  await assert.rejects(add("cass", "   "), /Type an interest/);
  await assert.rejects(add("cass", "x".repeat(41)), /under 40/);
  for (let i = 0; i < 20; i++) await add("cass", `Thing ${i}`);
  await assert.rejects(add("cass", "One too many"), /up to 20/);
});
