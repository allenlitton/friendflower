import "server-only";
import { createHash } from "node:crypto";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

// Contact matching: phone numbers and emails are normalised, then hashed with a
// secret "pepper" that only the server knows. Only these hashes are stored.
// The raw values are never saved anywhere.

function pepper() {
  const p = process.env.CONTACT_HASH_PEPPER;
  if (!p || p.length < 32) throw new Error("CONTACT_HASH_PEPPER is missing or too short");
  return p;
}

export function normalisePhone(raw: string, defaultCountry: CountryCode = "US") {
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry);
  return parsed?.isValid() ? parsed.number : null; // E.164, e.g. +14155550123
}

export function normaliseEmail(raw: string) {
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function hashIdentifier(kind: "phone" | "email", normalised: string) {
  return createHash("sha256").update(`${pepper()}|${kind}|${normalised}`).digest("hex");
}

/** Turn a messy list of phone numbers / emails into unique hashes. */
export function hashContacts(values: string[], defaultCountry: CountryCode = "US") {
  const out = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string" || v.length > 200) continue;
    if (v.includes("@")) {
      const e = normaliseEmail(v);
      if (e) out.add(hashIdentifier("email", e));
    } else {
      const p = normalisePhone(v, defaultCountry);
      if (p) out.add(hashIdentifier("phone", p));
    }
  }
  return [...out];
}
