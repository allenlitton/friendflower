import { Capacitor } from "@capacitor/core";
import { Contacts } from "@capacitor-community/contacts";

/** True inside the Friend Flower iPhone app, where we can read the address book directly. */
export function hasNativeContacts() {
  return Capacitor.isNativePlatform();
}

export type NativeContactsResult =
  | { ok: true; values: string[] }
  | { ok: false; reason: "denied" };

/**
 * Asks iOS for contacts access (the system prompt shows once) and returns every
 * phone number and email in the address book. Names, photos and the rest are never requested.
 * "Limited" access (iOS 18) works too — we simply get the contacts the person chose to share.
 */
export async function readNativeContacts(): Promise<NativeContactsResult> {
  let status = await Contacts.checkPermissions();
  if (status.contacts === "prompt" || status.contacts === "prompt-with-rationale") {
    status = await Contacts.requestPermissions();
  }
  if (status.contacts !== "granted" && status.contacts !== "limited") return { ok: false, reason: "denied" };
  const { contacts } = await Contacts.getContacts({ projection: { phones: true, emails: true } });
  const values = contacts.flatMap((c) => [
    ...(c.phones ?? []).map((p) => p.number),
    ...(c.emails ?? []).map((e) => e.address),
  ]).filter((v): v is string => !!v?.trim());
  return { ok: true, values };
}
