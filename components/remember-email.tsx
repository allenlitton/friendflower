"use client";

import { useEffect } from "react";
import { rememberEmail } from "@/lib/remembered-email";

/** Saves the signed-in email on this device so the sign-in page is pre-filled next time. */
export function RememberEmail({ email }: { email: string }) {
  useEffect(() => rememberEmail(email), [email]);
  return null;
}
