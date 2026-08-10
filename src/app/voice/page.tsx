import { saveVoiceProfileAction } from "@/app/actions";
import { AppNav } from "@/components/app-nav";
import { getVoiceProfile } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";

export const dynamic = "force-dynamic";

export default async function VoicePage() {
  const creator = await getActiveCreator();
  const voice = getVoiceProfile(creator.id);
  return (
    <main className="app-shell">
      <AppNav active="Creator voice" />
      <section className="workspace form-workspace">
        <header className="form-header"><span className="eyebrow">MANAGING AGENT FOUNDATION</span><h1>{creator.name} voice</h1><p>Give the agent real examples and boundaries before it writes a caption.</p></header>
        <form action={saveVoiceProfileAction} className="voice-layout">
          <section className="form-panel person-form">
            <div className="form-section-title"><span>1</span><div><h2>Voice settings</h2><p>How the account naturally communicates</p></div></div>
            <label>Profile name<input name="displayName" defaultValue={voice?.display_name ?? creator.name} /></label>
            <label>Perspective<select name="perspective" defaultValue={voice?.perspective ?? "brand_voice"}><option value="brand_voice">Thrill Noir brand voice</option><option value="first_person">Creator first person</option><option value="manager_voice">Manager speaking for creator</option></select></label>
            <label>Tone and rhythm<textarea name="toneNotes" defaultValue={voice?.tone_notes} placeholder="Direct, cheeky, warm, sparse, story-led…" /></label>
            <label>Words and phrases that feel natural<textarea name="vocabulary" defaultValue={voice?.vocabulary} /></label>
            <label>Never use<textarea name="phrasesToAvoid" defaultValue={voice?.phrases_to_avoid} placeholder="Generic AI phrases, clichés, words the creator dislikes…" /></label>
            <div className="two-fields"><label>Emoji style<select name="emojiStyle" defaultValue={voice?.emoji_style ?? "light"}><option value="none">None</option><option value="light">Light</option><option value="expressive">Expressive</option></select></label><label>Hashtag style<select name="hashtagStyle" defaultValue={voice?.hashtag_style ?? "minimal"}><option value="none">None</option><option value="minimal">Minimal</option><option value="platform_specific">Platform-specific</option></select></label></div>
          </section>
          <section className="form-panel person-form">
            <div className="form-section-title"><span>2</span><div><h2>Approved examples</h2><p>Paste captions that genuinely sound right</p></div></div>
            <label>One caption per block<textarea className="example-textarea" name="approvedExamples" defaultValue={voice?.approved_examples} placeholder={"Paste 5–15 real captions here.\n\nSeparate examples with a blank line."} /></label>
            <div className="edit-warning">The managing agent cannot be queued until at least one approved example is saved.</div>
            <button className="primary-button">Save voice profile</button>
          </section>
        </form>
      </section>
    </main>
  );
}
