import { createPersonAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { getPeople } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const creator = await getActiveCreator();
  const people = getPeople(creator.id);
  return (
    <AppShell active="People & tags">
      <section className="workspace library-workspace">
        <header className="topbar"><div><span className="eyebrow">{creator.name.toUpperCase()} · CREATOR FRIENDS</span><h1>Creator friends &amp; platform handles</h1><p className="page-subtitle">Attach one person to an asset, then THOT OS offers only the handle that exists for the chosen platform. Handles never imply consent.</p></div></header>
        <div className="people-layout">
          <section className="panel people-list">
            <div className="panel-heading"><div><h2>{people.length} creator friends</h2><p>Available to attach to assets and post packages</p></div></div>
            {people.map((person) => (
              <article className="person-row" key={person.id}>
                <div className="person-avatar">{(person.stage_name || person.display_name).slice(0, 1).toUpperCase()}</div>
                <div><h3>{person.stage_name || person.display_name}</h3>{person.stage_name && <p>{person.display_name}</p>}<span>{person.tags || "No social handles yet"}</span></div>
                <div><b className={`consent ${person.consent_status}`}>{person.consent_status.replaceAll("_", " ")}</b><small>{person.tagging_preference.replaceAll("_", " ")}</small></div>
              </article>
            ))}
            {people.length === 0 && <div className="mini-empty">Add the first collaborator or creator.</div>}
          </section>
          <section className="form-panel">
            <div className="form-section-title"><span>＋</span><div><h2>Add person</h2><p>Private notes are never used in captions</p></div></div>
            <form action={createPersonAction} className="person-form">
              <label>Name<input name="displayName" required /></label>
              <label>Stage/display name<input name="stageName" /></label>
              <div className="two-fields">
                <label>Consent status<select name="consentStatus"><option value="not_recorded">Not recorded</option><option value="requested">Requested</option><option value="confirmed">Confirmed</option><option value="expired">Expired</option></select></label>
                <label>Tagging preference<select name="taggingPreference"><option value="ask_each_time">Ask each time</option><option value="approved">Approved by default</option><option value="never_tag">Never tag</option></select></label>
              </div>
              <div className="tag-fields"><label>Instagram<input name="instagramHandle" placeholder="@handle" /></label><label>Facebook<input name="facebookHandle" placeholder="page or profile" /></label><label>Threads<input name="threadsHandle" placeholder="@handle" /></label><label>TikTok<input name="tiktokHandle" placeholder="@handle" /></label><label>YouTube<input name="youtubeHandle" placeholder="@channel" /></label><label>X<input name="xHandle" placeholder="@handle" /></label><label>Reddit<input name="redditHandle" placeholder="u/username" /></label><label>OnlyFans<input name="onlyfansHandle" placeholder="username" /></label><label>Fansly<input name="fanslyHandle" placeholder="username" /></label></div>
              <label>Private notes<textarea name="privateNotes" /></label>
              <button className="primary-button">Save person</button>
            </form>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
