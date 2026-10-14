// Shapes returned by the database functions in supabase/migrations.

export type Mini = { id: string; first_name: string; name: string; avatar_url: string | null };

export type CirclePerson = {
  uid: string;
  first_name: string;
  name: string;
  avatar_url: string | null;
  degree: 1 | 2;
  via_kind: "direct" | "friend" | "school";
  via_school: string | null;
  via_names: string[] | null;
  presence: "lives" | "visiting";
  starts_on: string | null;
  ends_on: string | null;
  online: boolean;
  distance_mi: number | null;
  distance_live: boolean;
  neighbourhood: string | null;
  mutual_count: number;
  is_friend: boolean;
  verified: boolean;
};

export type VerificationMethod = "in_app" | "link" | "self";
export type VerificationStatus =
  | "pending_target" | "pending_mutual" | "confirmed" | "declined" | "cancelled" | "expired";

export type Person = {
  id: string;
  first_name: string;
  name: string;
  avatar_url: string | null;
  bio: string;
  hometown: string | null;
  age: number | null;
  languages: string[];
  spots: string[];
  instagram: string | null;
  facebook: string | null;
  is_me: boolean;
  degree: 0 | 1 | 2;
  via_kind: "direct" | "friend" | "school" | null;
  via_school: string | null;
  mutuals: Mini[];
  online: boolean;
  now: { city_id: string; city: string; short: string; presence: "lives" | "visiting"; until: string | null; neighbourhood: string | null } | null;
  distance_mi: number | null;
  distance_kind: "nearby" | "same_city" | "far" | null;
  distance_live: boolean;
  /** They share live distance, even if there's no fresh position (and so no distance) right now. */
  live_on?: boolean;
  home: { city_id: string; city: string; short: string } | null;
  trips: { id: string; city_id: string; city: string; starts_on: string; ends_on: string }[];
  places: { city: string; years: string | null; kind: "lived" | "grew_up" }[];
  schools: { name: string; grad_year: number; level: string }[];
  // Only present when viewing someone else:
  shared_schools?: string[];
  shared_places?: string[];
  trip_overlaps?: { city: string; from: string; to: string }[];
  is_friend?: boolean;
  friend_request?: { id: string; status: "pending" | "declined"; direction: "sent" | "received" } | null;
  verified?: { id: string; method: VerificationMethod; confirmed_at: string; by: Mini | null; mutual_name: string | null } | null;
  verification?: {
    id: string; method: VerificationMethod; status: VerificationStatus; role: "requester" | "target";
    mutual: Partial<Mini> & { name: string | null }; chat_id: string | null; expires_at: string;
  } | null;
  chat_id?: string | null;
};

export type WorldCity = {
  city_id: string; city: string; short: string; is_launched: boolean; is_home: boolean;
  people: (Mini & { online: boolean; presence: "lives" | "visiting" | "upcoming"; from: string | null; until: string | null })[];
  based: number; visiting: number; upcoming: number;
  my_trip: { id: string; starts_on: string; ends_on: string } | null;
};

export type ConciergeAlert = {
  friend: Mini; city_id: string; city: string; short: string;
  from: string; to: string; is_new: boolean;
  /** visiting_you: they come to where you are. you_visiting: you go to where they live. both_away: you both travel there. */
  kind: "visiting_you" | "you_visiting" | "both_away";
};

export type ChatSummary = {
  id: string; kind: "direct" | "pod"; last_message_at: string; left: boolean;
  members: (Mini & { left: boolean })[];
  last: { body: string; kind: string; sender: string | null } | null;
  unread: boolean;
  verification: { id: string; status: VerificationStatus } | null;
};

export type ChatDetail = {
  id: string; kind: "direct" | "pod"; can_post: boolean;
  members: (Mini & { left: boolean; is_me: boolean })[];
  other: (Mini & {
    degree: 1 | 2 | null; online: boolean; via: string | null; via_kind: string | null;
    via_school: string | null; is_friend: boolean; verified: boolean;
    friend_request: { id: string; status: "pending" | "declined"; direction: "sent" | "received" } | null;
  }) | null;
  verification: {
    id: string; status: VerificationStatus; requester: Mini; target: Mini; mutual: Mini | null;
    i_am_mutual: boolean; expires_at: string;
  } | null;
};

export type Message = {
  id: number; chat_id: string; sender_id: string | null; kind: "text" | "system" | "venue" | "times";
  body: string; venue_id: string | null; created_at: string;
};

export type MeetPart = "morning" | "lunch" | "evening" | "night";

/** Days two people in a direct chat are in the same city (see meet_options). */
export type MeetOptions = {
  runs: { city_id: string; city: string; short: string; from: string; to: string; ongoing: boolean }[];
  days: { day: string; city_id: string; city: string; short: string }[];
};

/** The times one "times" message suggested, with the people who said each works (see meet_state). */
export type MeetState = {
  message_id: number;
  options: { day: string; part: MeetPart; city_id: string; city: string; by: string[] }[];
};

export type Inbox = {
  friend_requests: { id: string; from: Mini }[];
  verifications: {
    id: string; method: VerificationMethod; status: VerificationStatus; role: "target" | "mutual";
    requester: Mini; target: Mini; mutual: Mini | null; chat_id: string | null; expires_at: string;
  }[];
  contact_suggestions: Mini[];
};

export type Venue = {
  id: string; name: string; kind: "coffee" | "restaurant" | "bar" | "outdoors" | "movement";
  note: string; neighbourhood: string | null; walk_min: number | null; i_go: boolean; regulars: Mini[];
  added_by: Mini | null; mine: boolean;
};

export type FlightMatch = {
  flight_id: string; flight_no: string; flight_date: string;
  person: Mini & { degree: number; via: string | null };
};

export type City = { id: string; name: string; short_name: string; country: string; is_launched: boolean; is_home_option?: boolean; region?: string | null };
/** A city search result: one we have (id), or one from the geocoder we'll add when picked (geonameId). */
export type CityOption = { id?: string; geonameId?: number; name: string; detail: string; launched: boolean };
export type Neighbourhood = { id: string; city_id: string; name: string };

export type Units = "imperial" | "metric";

export type Profile = {
  id: string; first_name: string; last_initial: string; avatar_url: string | null; bio: string;
  hometown: string | null; birth_year: number | null; home_city_id: string | null;
  home_neighbourhood_id: string | null; languages: string[]; spots: string[];
  instagram: string | null; facebook: string | null; visibility: "first" | "fof";
  show_online: boolean; show_distance: boolean; show_trips: boolean; share_live_location: boolean;
  units: Units;
  invite_code: string; onboarded_at: string | null;
};

export type Trip = {
  id: string; city_id: string; neighbourhood_id: string | null; starts_on: string; ends_on: string;
  visibility: "first" | "fof" | "nobody";
  /** Started automatically because live distance found you in this city. */
  from_live: boolean;
  /** Open to carrying a small package for someone, and how much room is spare. */
  deliver_open: boolean;
  deliver_legs: "in" | "out" | "both" | null;
  deliver_luggage: boolean | null;
  deliver_space: "little" | "some" | "lot" | null;
  trip_flights: { id: string; direction: "in" | "out"; flight_no: string; flight_date: string }[];
};
