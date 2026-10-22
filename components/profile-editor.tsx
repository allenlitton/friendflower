"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { doodleFromPhoto, squarePhoto } from "@/lib/image";
import type { City, Neighbourhood, Profile } from "@/lib/types";
import { Card, ErrorNote, Flower, Pill, PrimaryButton, SecondaryButton, SectionLabel } from "@/components/ui";
import { Sheet } from "@/components/sheet";
import { turnOnLiveDistance } from "@/components/live-location";
import { CityPicker } from "@/components/city-picker";

type Place = { id: string; city_name: string; years: string | null; kind: "lived" | "grew_up" };
type School = { id: string; grad_year: number; level: string; schools: { name: string } };

const LEVELS = [
  { value: "high_school", label: "High school", short: "HS" },
  { value: "undergrad", label: "Undergraduate", short: "Undergrad" },
  { value: "grad", label: "Graduate", short: "Grad" },
];

export function ProfileEditor({
  mode, profile, cities, neighbourhoods, places: initialPlaces, schools: initialSchools, hasPhone,
}: {
  mode: "onboarding" | "edit";
  profile: Profile;
  cities: City[];
  neighbourhoods: Neighbourhood[];
  places: Place[];
  schools: School[];
  hasPhone: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [firstName, setFirstName] = useState(profile.first_name);
  const [lastInitial, setLastInitial] = useState(profile.last_initial);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  const [photo, setPhoto] = useState<File | null>(null);
  const [avatarMode, setAvatarMode] = useState<"photo" | "doodle">("photo");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [homeCity, setHomeCity] = useState(profile.home_city_id ?? "");
  const [homeLaunched, setHomeLaunched] = useState(!!cities.find((c) => c.id === profile.home_city_id)?.is_launched);
  const [homeNb, setHomeNb] = useState(profile.home_neighbourhood_id ?? "");
  const [phone, setPhone] = useState("");
  const [hometown, setHometown] = useState(profile.hometown ?? "");
  const [birthYear, setBirthYear] = useState(profile.birth_year?.toString() ?? "");
  const [languages, setLanguages] = useState(profile.languages.join(", "));
  const [spots, setSpots] = useState(profile.spots.join(", "));
  const [instagram, setInstagram] = useState(profile.instagram ?? "");
  const [facebook, setFacebook] = useState(profile.facebook ?? "");
  const [bio, setBio] = useState(profile.bio);
  const [places, setPlaces] = useState(initialPlaces);
  const [schools, setSchools] = useState(initialSchools);
  const [newPlace, setNewPlace] = useState({ city: "", years: "", grewUp: false });
  const [schoolSheet, setSchoolSheet] = useState(false);
  const [newSchool, setNewSchool] = useState({ name: "", year: "", level: "undergrad" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // After "save profile" on sign-up: ask whether to turn on live distance.
  const [livePrompt, setLivePrompt] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState("");

  const cityNbs = neighbourhoods.filter((n) => n.city_id === homeCity);
  // A neighbourhood is optional.
  const canSave = firstName.trim() && homeCity && (avatarUrl || photo);

  async function uploadAvatar(file: File, as: "photo" | "doodle") {
    setPhotoBusy(true);
    setError("");
    try {
      const blob = as === "doodle" ? await doodleFromPhoto(file) : await squarePhoto(file);
      const ext = as === "doodle" ? "png" : "jpg";
      const path = `${profile.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, blob, { contentType: blob.type });
      if (error) throw error;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      setAvatarUrl(data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't upload that photo");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhoto(file);
    await uploadAvatar(file, avatarMode);
  }

  async function switchMode(m: "photo" | "doodle") {
    setAvatarMode(m);
    if (photo) await uploadAvatar(photo, m);
  }

  async function addPlace() {
    if (!newPlace.city.trim()) return;
    const { data, error } = await supabase.from("user_places")
      .insert({ user_id: profile.id, city_name: newPlace.city.trim(), years: newPlace.years.trim() || null, kind: newPlace.grewUp ? "grew_up" : "lived" })
      .select("id, city_name, years, kind").single<Place>();
    if (error) return setError(error.message);
    setPlaces([...places, data]);
    setNewPlace({ city: "", years: "", grewUp: false });
  }

  async function removePlace(id: string) {
    await supabase.from("user_places").delete().eq("id", id);
    setPlaces(places.filter((p) => p.id !== id));
  }

  async function saveSchool() {
    const year = Number(newSchool.year);
    if (!newSchool.name.trim() || !year) return;
    const { error } = await supabase.rpc("add_school", { p_name: newSchool.name, p_year: year, p_level: newSchool.level });
    if (error) return setError(error.message);
    const { data } = await supabase.from("user_schools").select("id, grad_year, level, schools(name)").eq("user_id", profile.id);
    setSchools((data as unknown as School[]) ?? []);
    setSchoolSheet(false);
    setNewSchool({ name: "", year: "", level: "undergrad" });
  }

  async function removeSchool(id: string) {
    await supabase.from("user_schools").delete().eq("id", id);
    setSchools(schools.filter((s) => s.id !== id));
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    const list = (s: string, max: number) => s.split(",").map((x) => x.trim()).filter(Boolean).slice(0, max);
    const { error } = await supabase.from("profiles").update({
      first_name: firstName.trim(),
      last_initial: lastInitial.trim().slice(0, 1).toUpperCase(),
      avatar_url: avatarUrl,
      home_city_id: homeCity,
      home_neighbourhood_id: homeNb || null,
      hometown: hometown.trim() || null,
      birth_year: birthYear ? Number(birthYear) : null,
      languages: list(languages, 8),
      spots: list(spots, 3),
      instagram: instagram.trim().replace(/^@?/, "@").replace(/^@$/, "") || null,
      facebook: facebook.trim() || null,
      bio: bio.trim(),
    }).eq("id", profile.id);
    if (error) { setSaving(false); return setError(error.message); }

    // Register your own email (+ phone if given) so friends' contacts can find you.
    if (mode === "onboarding" || phone.trim()) {
      const res = await fetch("/api/identity", { method: "POST", body: JSON.stringify({ phone: phone.trim() || undefined }) });
      const json = await res.json();
      if (!res.ok) { setSaving(false); return setError(json.error); }
      if (json.phoneInUse) setError("That phone number is already linked to another account. Contact hello@friendflower.app if it's yours.");
    }

    if (mode === "onboarding") {
      const { error } = await supabase.rpc("complete_onboarding");
      if (error) { setSaving(false); return setError(error.message); }
      const invite = localStorage.getItem("ff_invite");
      if (invite) {
        await supabase.rpc("redeem_invite", { p_code: invite });
        localStorage.removeItem("ff_invite");
      }
      setSaving(false);
      return setLivePrompt(true);
    }
    router.replace("/you");
    router.refresh();
  }

  function finishOnboarding() {
    router.replace("/connect?welcome=1");
    router.refresh();
  }

  async function enableLive() {
    setLiveBusy(true);
    setLiveError("");
    const err = await turnOnLiveDistance(supabase, profile.id);
    setLiveBusy(false);
    if (err) return setLiveError(err);
    finishOnboarding();
  }

  return (
    <div className="flex flex-col">
      <SectionLabel>Profile picture</SectionLabel>
      <Card className="p-[15px]">
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-[76px] w-[76px] flex-none items-center justify-center overflow-hidden rounded-full border-[1.5px] border-dashed border-[#4d4740] bg-well">
            {avatarUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={avatarUrl} alt="" className="absolute inset-0 h-full w-full bg-white object-cover" />
              : <span className="text-[22px] text-faint">+</span>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[16.8px] font-semibold">
              {photoBusy ? (avatarMode === "doodle" ? "Drawing your doodle…" : "Uploading…")
                : !avatarUrl ? "How your friends will see you" : avatarMode === "doodle" ? "Your doodle" : "Your photo"}
            </div>
            <div className="mt-0.5 text-[13.8px] leading-snug text-muted">
              {avatarMode === "doodle" && photo
                ? "Drawn from your photo in the same ink style as everyone else. Only the doodle is uploaded — your photo stays on your phone."
                : "A real photo of you, or a doodle we draw from it. No logos, pets or landscapes."}
            </div>
          </div>
        </div>
        {photo && (
          <div className="mt-3 flex gap-0.5 rounded-xl bg-well p-[3px]">
            {(["photo", "doodle"] as const).map((m) => (
              <button key={m} type="button" onClick={() => switchMode(m)} disabled={photoBusy}
                className={`flex-1 rounded-[9px] py-[9px] text-[15px] font-bold ${avatarMode === m ? "bg-pink text-ink" : "text-soft"}`}>
                {m === "photo" ? "Real photo" : "Doodle of me"}
              </button>
            ))}
          </div>
        )}
        <label className={`mt-3 flex h-11 cursor-pointer items-center justify-center rounded-[13px] text-[16.2px] font-bold ${avatarUrl ? "text-pink" : "bg-pink text-ink"}`}>
          {avatarUrl ? "Use a different photo" : "Upload a real photo of you"}
          <input type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
        </label>
      </Card>

      <SectionLabel className="mt-[18px]">Your name</SectionLabel>
      <div className="grid grid-cols-[1fr_88px] gap-2">
        <input className="field" placeholder="First name" autoComplete="given-name" value={firstName} maxLength={40}
          onChange={(e) => setFirstName(e.target.value)} />
        <input className="field text-center" placeholder="Last initial" value={lastInitial} maxLength={1}
          onChange={(e) => setLastInitial(e.target.value)} />
      </div>

      <SectionLabel className="mt-[18px]">Currently living in</SectionLabel>
      <div className="flex flex-col gap-2">
        <CityPicker value={homeCity} cities={cities}
          onChange={(c) => { setHomeCity(c.id); setHomeLaunched(c.launched); setHomeNb(""); }} />
        {cityNbs.length > 0 && (
          <select className="field" value={homeNb} onChange={(e) => setHomeNb(e.target.value)}>
            <option value="">Choose your neighbourhood (optional)</option>
            {cityNbs.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        )}

        {homeCity && !homeLaunched && (
          <div className="text-[13.8px] leading-snug text-faint">
            The live map is only in San Francisco and New York for now. Friends will still see you&apos;re here on their World page, and you can add trips.
          </div>
        )}
      </div>

      <SectionLabel className="mt-[18px]">Your phone number</SectionLabel>
      <input className="field" type="tel" autoComplete="tel" placeholder={hasPhone ? "Saved · enter a new one to change" : "Optional"}
        value={phone} onChange={(e) => setPhone(e.target.value)} />
      <div className="mt-1.5 text-[13.8px] leading-snug text-faint">
        Lets friends who have your number in their contacts find you. It&apos;s never shown to anyone.
      </div>

      <SectionLabel className="mt-[18px]">Schools</SectionLabel>
      <div className="flex flex-wrap gap-[7px]">
        {schools.map((s) => (
          <button key={s.id} type="button" onClick={() => confirm(`Remove ${s.schools.name}?`) && removeSchool(s.id)}
            className="rounded-full border-[1.5px] border-pink bg-pink px-[13px] py-2 text-[15px] font-semibold text-ink">
            {s.schools.name} ’{String(s.grad_year).slice(-2)} · {LEVELS.find((l) => l.value === s.level)?.short}
          </button>
        ))}
        <Pill onClick={() => setSchoolSheet(true)}>+ Add school</Pill>
      </div>

      <SectionLabel className="mt-[18px]">Places you&apos;ve lived</SectionLabel>
      <Card className="rounded-[15px] px-3.5 py-1">
        {places.map((p) => (
          <div key={p.id} className="flex items-center gap-2.5 border-b border-rule py-[11px]">
            <span>🏠</span>
            <div className="min-w-0 flex-1">
              <div className="text-[16.8px] font-semibold">{p.city_name}</div>
              <div className="text-[13.8px] text-muted">{p.kind === "grew_up" ? "grew up" : ""}{p.kind === "grew_up" && p.years ? " · " : ""}{p.years}</div>
            </div>
            <button type="button" className="text-[14.4px] font-semibold text-faint" onClick={() => removePlace(p.id)}>Remove</button>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] items-center gap-2 py-[11px]">
          <input className="field !h-10 !text-[14px]" placeholder="City" value={newPlace.city}
            onChange={(e) => setNewPlace({ ...newPlace, city: e.target.value })} />
          <input className="field !h-10 !text-[14px]" placeholder="Years" value={newPlace.years}
            onChange={(e) => setNewPlace({ ...newPlace, years: e.target.value })} />
          <button type="button" onClick={addPlace} disabled={!newPlace.city.trim()}
            className="h-10 rounded-[11px] bg-pink px-[13px] text-[15.6px] font-bold text-ink disabled:opacity-45">Add</button>
        </div>
        <label className="flex items-center gap-2 pb-2.5 text-[14.4px] text-muted">
          <input type="checkbox" checked={newPlace.grewUp} onChange={(e) => setNewPlace({ ...newPlace, grewUp: e.target.checked })} />
          I grew up here
        </label>
      </Card>

      <SectionLabel className="mt-[18px]">About you</SectionLabel>
      <div className="grid grid-cols-[1fr_110px] gap-2">
        <input className="field" placeholder="Where you're from" value={hometown} maxLength={60} onChange={(e) => setHometown(e.target.value)} />
        <input className="field" placeholder="Birth year" inputMode="numeric" value={birthYear} maxLength={4}
          onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, ""))} />
      </div>
      <input className="field mt-2" placeholder="Languages you speak (comma separated)" value={languages} onChange={(e) => setLanguages(e.target.value)} />
      <input className="field mt-2" placeholder="Where you'd take a new friend (up to 3)" value={spots} onChange={(e) => setSpots(e.target.value)} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input className="field" placeholder="Instagram @handle" value={instagram} maxLength={60} onChange={(e) => setInstagram(e.target.value)} />
        <input className="field" placeholder="Facebook name" value={facebook} maxLength={80} onChange={(e) => setFacebook(e.target.value)} />
      </div>
      <div className="mt-1.5 text-[13.8px] text-faint">Shown on your profile.</div>

      <SectionLabel className="mt-[18px]">Bio</SectionLabel>
      <textarea className="field" maxLength={500} value={bio} onChange={(e) => setBio(e.target.value)}
        placeholder="Where you're from, what you're into, the kind of place you'd take a new friend." />

      <div className="mt-[18px] flex flex-col gap-2">
        <ErrorNote>{error}</ErrorNote>
        <PrimaryButton onClick={save} disabled={!canSave || saving || photoBusy} className="!h-[64px] !text-[24px]">
          {saving ? "saving…" : mode === "onboarding" ? "save profile" : "save changes"}
        </PrimaryButton>
        {!canSave && (
          <div className="text-center text-[13.8px] text-faint">
            {!avatarUrl && !photo ? "Add a profile picture so friends recognise you" : !firstName.trim() ? "Add your first name" : "Choose the city you live in"}
          </div>
        )}
      </div>
      {mode === "onboarding" && <div className="mt-[18px] flex justify-center"><Flower size={34} stroke="#fff" strokeWidth={3.2} /></div>}

      <Sheet open={livePrompt} onClose={finishOnboarding} title="Turn on live distance?">
        <p className="mt-2 text-[16.2px] leading-normal text-body">
          Turn on Live Distance to help you and your friend flowers find each other
        </p>
        <p className="mt-2 text-[14.4px] leading-snug text-muted">You can change this any time on the You page.</p>
        <div className="mt-4 flex flex-col gap-2">
          <ErrorNote>{liveError}</ErrorNote>
          <PrimaryButton onClick={enableLive} disabled={liveBusy}>{liveBusy ? "turning on…" : "turn on live distance"}</PrimaryButton>
          <SecondaryButton onClick={finishOnboarding} disabled={liveBusy}>Not now</SecondaryButton>
        </div>
      </Sheet>

      <Sheet open={schoolSheet} onClose={() => setSchoolSheet(false)} title="Add a school">
        <SectionLabel className="mt-4">School name</SectionLabel>
        <input className="field" placeholder="e.g. UCLA" value={newSchool.name} onChange={(e) => setNewSchool({ ...newSchool, name: e.target.value })} />
        <SectionLabel className="mt-3.5">Graduating year</SectionLabel>
        <input className="field" placeholder="e.g. 2018" inputMode="numeric" maxLength={4} value={newSchool.year}
          onChange={(e) => setNewSchool({ ...newSchool, year: e.target.value.replace(/\D/g, "") })} />
        <SectionLabel className="mt-3.5">Level</SectionLabel>
        <div className="flex gap-0.5 rounded-xl bg-card p-[3px]">
          {LEVELS.map((l) => (
            <button key={l.value} type="button" onClick={() => setNewSchool({ ...newSchool, level: l.value })}
              className={`flex-1 rounded-[9px] py-[9px] text-[15.6px] font-semibold ${newSchool.level === l.value ? "bg-pink text-ink" : "text-soft"}`}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="mt-2 text-[13.8px] text-faint">People from the same school within a year of you can appear as friends of friends.</div>
        <PrimaryButton className="mt-[18px]" onClick={saveSchool} disabled={!newSchool.name.trim() || newSchool.year.length !== 4}>add school</PrimaryButton>
      </Sheet>
    </div>
  );
}
