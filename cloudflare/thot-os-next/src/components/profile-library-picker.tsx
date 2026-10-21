"use client";

import { useCallback, useEffect, useState } from "react";

type Surface = "public_sfw" | "adult_profile";
export type SelectedProfilePhoto = { id: string; assetId: string; name: string; previewUrl: string; position: number };
type Candidate = { id: string; name: string; previewUrl: string | null; supported: boolean; people: Array<{ id: number; name: string; consentSatisfied: boolean }> };
type PickerData = { ok: boolean; canEdit: boolean; photos: Candidate[]; selected: SelectedProfilePhoto[] };

const errorMessages: Record<string, string> = {
  draft_required: "Save this profile as a draft before choosing photos.",
  photo_too_large: "This Library photo is over 12 MB. Choose another photo for now.",
  unsupported_image_type: "This Library image format cannot be processed for a profile yet.",
  source_identity_changed: "This Library original has changed. Review its upload before trying again.",
  source_checksum_changed: "This Library original failed its integrity check.",
  subject_consent_required: "Record permission for each linked person before adding this photo.",
  photo_limit_reached: "This profile can show up to six photos.",
  photo_already_selected: "This photo is already in the profile.",
  photo_order_needs_review: "The saved photo order needs checking. Refresh this section before adding another photo.",
};

export function ProfileLibraryPicker({ surface, versionId, draftFormId, onSelectionChange }: {
  surface: Surface; versionId?: string; draftFormId: string; onSelectionChange: (photos: SelectedProfilePhoto[]) => void;
}) {
  const [data, setData] = useState<PickerData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState("");
  const [search, setSearch] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const load = useCallback(async () => {
    if (!versionId) return;
    const query = new URLSearchParams({ surface, versionId, q: search });
    const response = await fetch(`/api/profile-library?${query}`, { cache: "no-store" });
    const result = await response.json().catch(() => null) as PickerData | null;
    if (!response.ok || !result?.ok) throw new Error("Your Library photos could not be loaded. Refresh this section.");
    setData(result);
    onSelectionChange(result.selected);
  }, [onSelectionChange, search, surface, versionId]);
  useEffect(() => { let active = true; const timer = setTimeout(() => { if (versionId) void load().catch(() => { if (active) setError("Your Library photos could not be loaded. Refresh this section."); }); }, 250); return () => { active = false; clearTimeout(timer); }; }, [load, versionId]);

  const applyOrder = async (ids: string[]) => {
    if (!versionId || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/profile-library", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ surface, versionId, selectionIds: ids }) });
      if (!response.ok) throw new Error("Photo changes could not be saved. Refresh this section and try again.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Photo changes could not be saved."); }
    finally { setBusy(false); }
  };
  const add = async () => {
    if (!versionId || !chosen || !rightsConfirmed || busy) return;
    const photo = data?.photos.find((item) => item.id === chosen);
    if (!photo) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/profile-library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        surface, versionId, assetId: chosen, rightsConfirmed,
        subjectConsents: photo.people.filter((person) => !person.consentSatisfied).map((person) => ({ personId: person.id, evidenceNote: notes[person.id]?.trim() ?? "" })),
      }) });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(errorMessages[result?.error ?? ""] ?? "This photo could not be added. Review its source and permissions.");
      await load(); setChosen(""); setRightsConfirmed(false); setNotes({});
    } catch (caught) { setError(caught instanceof Error ? caught.message : "This photo could not be added."); }
    finally { setBusy(false); }
  };
  const selected = data?.selected ?? [];
  const available = (data?.photos ?? []).filter((item) => !selected.some((photo) => photo.assetId === item.id));
  const candidate = available.find((item) => item.id === chosen);
  const canEdit = Boolean(data?.canEdit);

  return <section className="profile-library-picker" aria-labelledby={`${surface}-library-title`}>
    <div className="section-heading"><div><b id={`${surface}-library-title`}>Choose from Content Library</b><p>Use a single main portrait or up to six photos in a swipeable carousel. The original stays private.</p></div></div>
    {!versionId && <div><p>Create a private draft to start choosing Library photos.</p><button type="submit" form={draftFormId} className="secondary-action">Create draft and choose photos</button></div>}
    {versionId && !data && !error && <p role="status">Loading Library photos…</p>}
    {selected.length > 0 && <ol className="profile-library-selected">{selected.map((photo, index) => <li key={photo.id}>
      <img src={photo.previewUrl} alt="" /><span><b>{photo.name}</b><small>{index === 0 ? "Main portrait" : `Carousel photo ${index + 1}`}</small></span>
      {canEdit && <div className="profile-library-order"><button type="button" disabled={busy || index === 0} aria-label={`Move ${photo.name} earlier`} onClick={() => { const ids = selected.map((item) => item.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; void applyOrder(ids); }}>↑</button><button type="button" disabled={busy || index === selected.length - 1} aria-label={`Move ${photo.name} later`} onClick={() => { const ids = selected.map((item) => item.id); [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]; void applyOrder(ids); }}>↓</button><button type="button" disabled={busy} onClick={() => void applyOrder(selected.filter((item) => item.id !== photo.id).map((item) => item.id))}>Remove</button></div>}
    </li>)}</ol>}
    {selected.length > 0 && <p role="status">{selected.length === 1 ? "One main portrait selected." : `${selected.length} photos selected for the carousel.`} Photo choices are saved to this private draft immediately. Your live page changes only when you publish.</p>}
    {canEdit && selected.length < 6 && <div className="profile-library-add">
      <label htmlFor={`${surface}-library-search`}>Find a Library photo</label><input id={`${surface}-library-search`} type="search" value={search} maxLength={80} onChange={(event) => setSearch(event.target.value)} placeholder="Search by Library name" />
      <div className="profile-library-grid" aria-label="Available Library photos">{available.map((photo) => <button type="button" key={photo.id} className={chosen === photo.id ? "selected" : ""} aria-pressed={chosen === photo.id} disabled={!photo.supported || busy} onClick={() => { setChosen(photo.id); setRightsConfirmed(false); setNotes({}); }}>{photo.previewUrl ? <img src={photo.previewUrl} alt="" loading="lazy" /> : <span>Preview unavailable</span>}<b>{photo.name}</b>{!photo.supported && <small>Over 12 MB</small>}</button>)}{!available.length && <p>No eligible photos match this search.</p>}</div>
      {candidate && <><div className="profile-library-candidate">{candidate.previewUrl ? <img src={candidate.previewUrl} alt="Selected Library photo preview" /> : <span>Preview unavailable</span>}<b>{candidate.name}</b></div>
        <label className="profile-library-confirm"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /> I have the rights to publish this photo on {surface === "public_sfw" ? "my public creator page" : "my protected More page"}.</label>
        {candidate.people.filter((person) => person.consentSatisfied).map((person) => <p key={person.id}>Permission for {person.name} is already recorded for this page.</p>)}
        {candidate.people.filter((person) => !person.consentSatisfied).map((person) => <label key={person.id}>Permission evidence for {person.name}<input value={notes[person.id] ?? ""} maxLength={1000} onChange={(event) => setNotes((current) => ({ ...current, [person.id]: event.target.value }))} placeholder="Where and when this person agreed to this profile use" /></label>)}
        <button type="button" className="secondary-action" disabled={busy || !rightsConfirmed || candidate.people.some((person) => !person.consentSatisfied && !notes[person.id]?.trim())} onClick={() => void add()}>{busy ? "Saving photo…" : "Add photo"}</button></>}
    </div>}
    {versionId && data && !canEdit && <div><p>This is a saved version. Create a private draft to change its Library photos.</p><button type="submit" form={draftFormId} className="secondary-action">Create draft and change photos</button></div>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </section>;
}
