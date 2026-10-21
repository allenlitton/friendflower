// Blossom, the paid plan. The limits are enforced by the database
// (supabase/migrations/…25_blossom.sql); these copies are for the screens.

export const BLOSSOM = {
  price: "$8",
  freeFriends: 10, // saved friends on World
  freeNearby: 10, // people on Nearby
} as const;

export type Plan = { plan: "free" | "blossom"; until: string | null; source: "code" | "paid" | "gift" | null; friends: number };
