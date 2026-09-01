import { saveGuidedInterviewAction, saveOnboardingIdentityAction, savePrivateIdentityAction, submitCreatorOnboardingAction } from "@/app/onboarding/actions";
import { SecureLoginCapture } from "@/app/onboarding/secure-login-capture";
import { GuidedOnboardingInterview } from "@/components/guided-onboarding-interview";

type Account = { id: string; platform: string; label: string; handle: string; login_email: string; account_purpose: string; connection_method: string };
type Profile = { stage_name: string; preferred_name: string; contact_email: string; contact_phone: string; country: string; time_zone: string };
type Compliance = { legal_name: string; date_of_birth: string };
type Sections = { section_key: string; status: string }[];
type Brand = Record<string, string | null | undefined>;
type CreateAccount = (form: FormData) => Promise<{ ok: boolean; id: string }>;
type SaveLoginMethod = (form: FormData) => Promise<{ ok: boolean }>;

const status = (sections: Sections, keys: string[]) => keys.every((key) => sections.find((item) => item.section_key === key)?.status === "complete") ? "complete" : keys.some((key) => sections.find((item) => item.section_key === key)?.status === "creator_review") ? "ready for review" : "in progress";

export function CreatorOnboarding({ profile, compliance, sections, accounts, brand, hasPin, createAccount, saveLoginMethod }: { profile?: Profile | null; compliance?: Compliance | null; sections: Sections; accounts: Account[]; brand: Brand; hasPin: boolean; createAccount: CreateAccount; saveLoginMethod: SaveLoginMethod }) {
  const guidedValues = { stage_name: profile?.stage_name ?? "", short_bio: brand.short_bio ?? "", voice_summary: brand.voice_summary ?? "", interests: brand.interests ?? "", niches_themes: brand.niches_themes ?? "", hard_boundaries: brand.hard_boundaries ?? "", growth_priorities: brand.growth_priorities ?? "" };
  return <main className="creator-interview" aria-labelledby="creator-onboarding-title">
    <header className="creator-interview-intro"><span className="eyebrow">YOUR THOT OS SETUP</span><h1 id="creator-onboarding-title">Let’s make future-you’s life easier.</h1><p>Three short chapters and one final check. Save as you go, come back whenever you need, and let your assistant handle the boring wording bits.</p></header>

    <section className="panel creator-chapter"><div className="creator-chapter-heading"><span className="step-number">1</span><div><span className="eyebrow">WHO IS THE REAL YOU?</span><h2>Private details, handled with care</h2><p>We ask for this so the agency can contact you and complete compliance. Legal identity and date of birth stay out of AI, captions and general workspace screens.</p></div><span>{status(sections, ["identity"])}</span></div>
      <form action={savePrivateIdentityAction} className="inline-form creator-form"><label>Legal name<input defaultValue={compliance?.legal_name} name="legalName" autoComplete="name" required /></label><label>Date of birth<input defaultValue={compliance?.date_of_birth} name="dateOfBirth" type="date" autoComplete="bday" required /></label><p className="privacy-note">These restricted answers are used for compliance only and are never sent to Workers AI.</p><button className="primary" type="submit">Save private details</button></form>
      <form action={saveOnboardingIdentityAction} className="inline-form creator-form"><label>Phone<input defaultValue={profile?.contact_phone} name="contactPhone" type="tel" /></label><label>Contact email<input defaultValue={profile?.contact_email} name="contactEmail" type="email" /></label><label>Country<input defaultValue={profile?.country} name="country" /></label><label>Timezone<input defaultValue={profile?.time_zone} name="timeZone" placeholder="Australia/Perth" /></label><input name="stageName" type="hidden" value={profile?.stage_name ?? ""} /><input name="preferredName" type="hidden" value={profile?.preferred_name ?? ""} /><button className="secondary-action" type="submit">Save contact details</button></form>
    </section>

    <section className="panel creator-chapter"><div className="creator-chapter-heading"><span className="step-number">2</span><div><span className="eyebrow">WHO IS THE ONLINE YOU?</span><h2>Meet your THOT OS interviewer</h2><p>Answer naturally. Your assistant can tidy the wording, but it cannot invent facts or save anything until you approve it.</p></div><span>{status(sections, ["brand_voice", "positioning", "about_me"])}</span></div>
      <GuidedOnboardingInterview values={guidedValues} saveAction={saveGuidedInterviewAction} />
    </section>

    <section className="panel creator-chapter"><div className="creator-chapter-heading"><span className="step-number">3</span><div><span className="eyebrow">YOUR ACCOUNTS AND LOGINS</span><h2>Hand us the keys—safely</h2><p>Add every profile separately, including second Instagram, Reddit or X accounts. Passwords go into the encrypted vault, never the AI interview.</p></div><span>{status(sections, ["social_profiles", "paid_platforms"])}</span></div>
      <SecureLoginCapture accounts={accounts} hasPin={hasPin} createAccount={createAccount} saveLoginMethod={saveLoginMethod} />
      {accounts.length ? <div className="creator-account-list">{accounts.map((account) => <article className="identity-row" key={account.id}><div><strong>{account.platform} · {account.label}</strong><small>{account.handle || "No handle yet"}{account.account_purpose ? ` · ${account.account_purpose}` : ""}</small></div></article>)}</div> : <p className="muted">No accounts yet. Add the first one above whenever you’re ready.</p>}
    </section>

    <section className="panel creator-chapter creator-review"><div className="creator-chapter-heading"><span className="step-number">4</span><div><span className="eyebrow">REVIEW AND SUBMIT</span><h2>One last look, then off it goes</h2><p>Check the three chapters above. Submitting sends your saved answers to the agency for review; it does not connect accounts, publish content or activate anything.</p></div></div><form action={submitCreatorOnboardingAction}><button className="primary" type="submit">Send onboarding for review</button></form></section>
  </main>;
}
