import "server-only";
import { createHash } from "node:crypto";

// The round device makes up its own secret (64 hex characters) and uses it as
// its key once it's linked. Only the SHA-256 of it is ever stored.
export function deviceSecretHash(secret: unknown) {
  if (typeof secret !== "string" || !/^[0-9a-f]{64}$/.test(secret)) return null;
  return createHash("sha256").update(secret).digest("hex");
}

/** The key from an `Authorization: Bearer <secret>` header. */
export function bearerHash(request: Request) {
  const m = /^Bearer\s+(\S+)$/.exec(request.headers.get("authorization") ?? "");
  return m ? deviceSecretHash(m[1]) : null;
}
