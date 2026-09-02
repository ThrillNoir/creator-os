import { saveGuidedInterviewAction, saveOnboardingIdentityAction, savePrivateIdentityAction, submitCreatorOnboardingAction } from "@/app/onboarding/actions";
import { SecureLoginCapture } from "@/app/onboarding/secure-login-capture";
import { GuidedOnboardingInterview } from "@/components/guided-onboarding-interview";

type Account = { id: string; platform: string; label: string; handle: string; login_email: string; profile_url: string; account_purpose: string; connection_method: string };
type Profile = { stage_name: string; preferred_name: string; contact_email: string; contact_phone: string; country: string; time_zone: string; workflow_state: string };
type Compliance = { legal_name: string; date_of_birth: string };
type Sections = { section_key: string; status: string }[];
type Brand = Record<string, string | null | undefined>;
type CreateAccount = (form: FormData) => Promise<{ ok: boolean; id: string }>;
type SaveLoginMethod = (form: FormData) => Promise<{ ok: boolean }>;

const status = (sections: Sections, keys: string[]) => keys.every((key) => sections.find((item) => item.section_key === key)?.status === "complete") ? "complete" : keys.some((key) => sections.find((item) => item.section_key === key)?.status === "creator_review") ? "ready for review" : "in progress";

export function CreatorOnboarding({ profile, compliance, sections, accounts, brand, hasPin, submitted, createAccount, saveLoginMethod }: { profile?: Profile | null; compliance?: Compliance | null; sections: Sections; accounts: Account[]; brand: Brand; hasPin: boolean; submitted: boolean; createAccount: CreateAccount; saveLoginMethod: SaveLoginMethod }) {
  const guidedValues = { stage_name: profile?.stage_name ?? "", short_bio: brand.short_bio ?? "", voice_summary: brand.voice_summary ?? "", interests: brand.interests ?? "", niches_themes: brand.niches_themes ?? "", hard_boundaries: brand.hard_boundaries ?? "", growth_priorities: brand.growth_priorities ?? "" };
  const missing = [
    !compliance?.legal_name || !compliance.date_of_birth || !profile?.contact_email || !profile.contact_phone ? ["Who is the real you", "onboarding-real"] : null,
    Object.values(guidedValues).some((item) => !item.trim()) ? ["Who is the online you", "onboarding-online"] : null,
    accounts.length === 0 ? ["Accounts and logins", "onboarding-accounts"] : null,
  ].filter(Boolean) as string[][];
  const sentForReview = ["creator_review", "admin_review", "active"].includes(profile?.workflow_state ?? "draft");
  return <main className="creator-interview" aria-labelledby="creator-onboarding-title">
    <header className="creator-interview-intro"><span className="eyebrow">YOUR THOT OS SETUP</span><h1 id="creator-onboarding-title">Let’s make future-you’s life easier.</h1><p>Three short chapters and one final check. Save as you go, come back whenever you need, and let your assistant handle the boring wording bits.</p></header>

    <section className="panel creator-chapter" id="onboarding-real"><div className="creator-chapter-heading"><span className="step-number">1</span><div><span className="eyebrow">WHO IS THE REAL YOU?</span><h2>Private details, handled with care</h2><p>We ask for this so the agency can contact you and complete compliance. Legal identity and date of birth stay out of AI, captions and general workspace screens.</p></div><span>{status(sections, ["identity"])}</span></div>
      <form action={savePrivateIdentityAction} className="inline-form creator-form"><label>Legal name<input defaultValue={compliance?.legal_name} name="legalName" autoComplete="name" required /></label><label>Date of birth<input defaultValue={compliance?.date_of_birth} name="dateOfBirth" type="date" autoComplete="bday" required /></label><p className="privacy-note">These restricted answers are used for compliance only and are never sent to Workers AI.</p><button className="primary" type="submit">Save private details</button></form>
      <form action={saveOnboardingIdentityAction} className="inline-form creator-form"><label>Phone<input defaultValue={profile?.contact_phone} name="contactPhone" type="tel" /></label><label>Contact email<input defaultValue={profile?.contact_email} name="contactEmail" type="email" /></label><label>Country<input defaultValue={profile?.country} name="country" /></label><label>Timezone<input defaultValue={profile?.time_zone} name="timeZone" placeholder="Australia/Perth" /></label><input name="stageName" type="hidden" value={profile?.stage_name ?? ""} /><input name="preferredName" type="hidden" value={profile?.preferred_name ?? ""} /><button className="secondary-action" type="submit">Save contact details</button></form>
    </section>

    <section className="panel creator-chapter" id="onboarding-online"><div className="creator-chapter-heading"><span className="step-number">2</span><div><span className="eyebrow">WHO IS THE ONLINE YOU?</span><h2>Meet your THOT OS interviewer</h2><p>Answer naturally. You approve every answer before it becomes part of your profile.</p></div><span>{status(sections, ["brand_voice", "positioning", "about_me"])}</span></div>
      <GuidedOnboardingInterview values={guidedValues} saveAction={saveGuidedInterviewAction} />
    </section>

    <section className="panel creator-chapter" id="onboarding-accounts"><div className="creator-chapter-heading"><span className="step-number">3</span><div><span className="eyebrow">YOUR ACCOUNTS AND LOGINS</span><h2>Add your accounts and logins</h2><p>Save each profile separately. Login details stay in the encrypted vault and nothing connects or publishes automatically.</p></div><span>{status(sections, ["social_profiles", "paid_platforms"])}</span></div>
      <SecureLoginCapture accounts={accounts} hasPin={hasPin} createAccount={createAccount} saveLoginMethod={saveLoginMethod} />
    </section>

    <section className="panel creator-chapter creator-review" id="onboarding-review"><div className="creator-chapter-heading"><span className="step-number">4</span><div><span className="eyebrow">REVIEW AND HANDOFF</span><h2>Ready to send it over?</h2><p>Sending changes your saved chapters to Ready for review and puts them in the agency&apos;s Onboarding workspace.</p></div></div>
      <ul className="creator-review-safety"><li>It does not connect accounts.</li><li>It does not publish content or send messages.</li><li>It does not activate anything.</li></ul>
      {missing.length ? <div className="creator-review-missing"><strong>Finish these chapters before sending:</strong>{missing.map(([label, id]) => <a href={`#${id}`} key={id}>{label}</a>)}</div> : null}
      <form action={submitCreatorOnboardingAction}><button className="primary" disabled={missing.length > 0 || sentForReview} type="submit">{sentForReview ? "Sent for review" : "Send onboarding for review"}</button></form>
      {sentForReview ? <div className="creator-review-sent" aria-live="polite"><strong>{submitted ? "Sent for review" : "Ready for review"}</strong><span>Your saved chapters are now in the agency&apos;s Onboarding workspace. You can still edit them; editing reopens the affected section for review.</span></div> : null}
    </section>
  </main>;
}
