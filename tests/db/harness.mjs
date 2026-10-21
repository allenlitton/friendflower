// Runs the real Supabase migrations inside an in-memory Postgres (PGlite),
// with just enough of Supabase's `auth` and `storage` schemas stubbed in.
// Lets us test the privacy rules without any cloud account.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(import.meta.dirname, "../../supabase/migrations");

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  $$;

  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select string_to_array(name, '/')
  $$;

  -- Mirror Supabase's default grants on the public schema.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export async function freshDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${e.message}`);
    }
  }
  return db;
}

/** Run `fn` as a signed-in user, the way PostgREST would. */
export async function as(db, userId, fn) {
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId })]);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

/** Run `fn` as the backend (service role key). */
export async function asServer(db, fn) {
  await db.exec(`set role service_role`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
  }
}

/** Call an RPC and return its single value. */
export async function rpc(db, fnName, args = {}) {
  const keys = Object.keys(args);
  const sql = `select public.${fnName}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as v`;
  const res = await db.query(sql, keys.map((k) => args[k]));
  return res.rows[0]?.v;
}

let n = 0;
/** Create an onboarded user, on Blossom unless `free` (so plan limits don't get in the way of other tests). */
export async function makeUser(db, { first, city = "san-francisco", nb = null, visibility = "fof", free = false, ...rest }) {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${first.toLowerCase()}${n}@test.dev`]);
  await db.query(
    `update public.profiles set first_name = $2, last_initial = $3, home_city_id = $4,
       home_neighbourhood_id = $5, visibility = $6, onboarded_at = now(), bio = $7
     where id = $1`,
    [id, first, first[0], city, nb, visibility, rest.bio ?? ""],
  );
  if (!free) {
    await db.query(`insert into private.memberships (user_id, source, until) values ($1, 'paid', now() + interval '1 month')`, [id]);
  }
  return id;
}

export const sha = async (s) => {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(s).digest("hex");
};
