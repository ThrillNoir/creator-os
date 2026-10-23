"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type LoginMethod = "not_configured" | "password" | "google" | "apple";
type Account = { id: string; platform: string; label: string; handle: string; login_email: string; profile_url: string; account_purpose: string; connection_method: string; has_credential: number };
type CreateAccount = (form: FormData) => Promise<{ ok: boolean; id: string }>;
type SaveLoginMethod = (form: FormData) => Promise<{ ok: boolean }>;
type Draft = { platform: string; username: string; loginEmail: string; profileUrl: string; purpose: string; password: string };

const paidPlatforms = new Set(["onlyfans", "fansly", "manyvids", "patreon", "myroomz"]);
const platforms = ["instagram", "reddit", "x", "tiktok", "threads", "facebook", "telegram", "youtube", "fansly", "onlyfans", "manyvids", "patreon", "myroomz", "other"];
const platformLabels: Record<string, string> = { instagram: "IG", reddit: "Reddit", x: "X", tiktok: "TikTok", threads: "Threads", facebook: "Facebook", telegram: "Telegram", youtube: "YouTube", fansly: "Fansly", onlyfans: "OF", manyvids: "ManyVids", patreon: "Patreon", myroomz: "MyRoomz", other: "Other" };
const profilePlaceholders: Record<string, string> = { instagram: "https://instagram.com/username", reddit: "https://reddit.com/user/username", x: "https://x.com/username", tiktok: "https://tiktok.com/@username", threads: "https://threads.net/@username", facebook: "https://facebook.com/username", telegram: "https://t.me/username", youtube: "https://youtube.com/@username", fansly: "https://fansly.com/username", onlyfans: "https://onlyfans.com/username", manyvids: "https://manyvids.com/Profile/username", patreon: "https://patreon.com/username", myroomz: "https://myroomz.com/username" };
const emptyDraft: Draft = { platform: "instagram", username: "", loginEmail: "", profileUrl: "", purpose: "", password: "" };

function loginMethod(value?: string): LoginMethod { return value === "google" || value === "apple" || value === "not_configured" ? value : "password"; }
function accountName(account: Account) { return `${platformLabels[account.platform] ?? account.platform} – ${account.handle || account.label}${account.connection_method === "password" && !account.has_credential ? " · password needed" : ""}`; }

export function SecureLoginCapture({ accounts, hasPin, createAccount, saveLoginMethod }: { accounts: Account[]; hasPin: boolean; createAccount: CreateAccount; saveLoginMethod: SaveLoginMethod }) {
  const router = useRouter();
  const editor = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState("");
  const [pinReady, setPinReady] = useState(hasPin);
  const [accountId, setAccountId] = useState("");
  const [method, setMethod] = useState<LoginMethod>("not_configured");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function focusEditor(selector = "select") { requestAnimationFrame(() => editor.current?.querySelector<HTMLElement>(selector)?.focus()); }
  function addAccount() {
    setAccountId(""); setMethod("not_configured"); setDraft(emptyDraft); setShowPassword(false); setMessage(""); setEditing(true); focusEditor();
  }
  function chooseAccount(account: Account) {
    setAccountId(account.id); setMethod(loginMethod(account.connection_method));
    setDraft({ platform: account.platform, username: account.handle || account.label, loginEmail: account.login_email, profileUrl: account.profile_url, purpose: account.account_purpose, password: "" });
    setShowPassword(false); setMessage(""); setEditing(true); focusEditor("input");
  }

  async function request(body: Record<string, unknown>) {
    const response = await fetch("/api/access/credentials", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: string; notice?: string };
    if (!response.ok) throw new Error(result.error || "Login details could not be saved.");
    return result;
  }

  async function save() {
    setMessage(""); setSaving(true);
    try {
      if (!draft.username.trim()) throw new Error("Enter the username for this account.");
      if (!/^\d{4}$/.test(pin)) throw new Error(pinReady ? "Enter your four-digit Account PIN." : "Create a four-digit Account PIN first.");
      if ((method === "google" || method === "apple") && !draft.loginEmail.trim()) throw new Error("Enter the email used for Google or Apple sign-in.");
      if (method === "password" && (!accountId || !accounts.find((account) => account.id === accountId)?.has_credential) && !draft.password) throw new Error("Enter the password used for this account.");
      if (!pinReady) { await request({ action: "setup_pin", pin }); setPinReady(true); }
      await request({ action: "step_up", pin });

      let selected = accountId;
      if (!selected) {
        const account = new FormData();
        account.set("accountKind", paidPlatforms.has(draft.platform) ? "paid" : "social");
        account.set("platform", draft.platform); account.set("username", draft.username); account.set("loginEmail", draft.loginEmail);
        account.set("profileUrl", draft.profileUrl); account.set("purpose", draft.purpose); account.set("loginMethod", method);
        selected = (await createAccount(account)).id;
      } else {
        const account = new FormData();
        account.set("accountId", selected); account.set("loginMethod", method); account.set("username", draft.username);
        account.set("loginEmail", draft.loginEmail); account.set("profileUrl", draft.profileUrl); account.set("purpose", draft.purpose);
        await saveLoginMethod(account);
      }
      if (method === "password" && draft.password) await request({ action: "create", accountId: selected, group: paidPlatforms.has(draft.platform) ? "paid" : "social", label: draft.username, username: draft.username, loginEmail: draft.loginEmail, password: draft.password });

      editor.current?.dispatchEvent(new Event("onboarding:saved", { bubbles: true }));
      setDraft((current) => ({ ...current, password: "" })); setPin(""); setEditing(false);
      setMessage(method === "password" && draft.password ? "Login details saved securely." : "Account details saved securely."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Login details could not be saved."); }
    finally { setSaving(false); }
  }

  return <section className="secure-login-capture" aria-labelledby="secure-login-title">
    <div className="account-pin-callout" role="note"><div><span className="eyebrow">YOUR ACCOUNT PIN</span><h3 id="secure-login-title">This is your Account PIN.</h3><p>You use it to view and change your account details. Keep it private. It is required for every save, including Google or Apple sign-in.</p></div><strong>{pinReady ? "PIN configured" : "Create your PIN"}</strong></div>
    <div className="creator-account-nav" aria-label="Your saved accounts">
      <button aria-pressed={editing && !accountId} className="secondary-action creator-add-account" onClick={addAccount} type="button">+ Add account</button>
      {accounts.map((account) => <button aria-pressed={editing && accountId === account.id} className="creator-account-tab" key={account.id} onClick={() => chooseAccount(account)} type="button">{accountName(account)}</button>)}
    </div>
    {editing ? <div className="creator-account-editor" ref={editor}><div className="inline-form creator-form">
      <label>Platform<select disabled={Boolean(accountId)} value={draft.platform} onChange={(event) => { setDraft({ ...draft, platform: event.target.value, profileUrl: "" }); if (paidPlatforms.has(event.target.value) && method === "not_configured") setMethod("password"); }}>{platforms.map((platform) => <option key={platform} value={platform}>{platformLabels[platform] ?? platform}</option>)}</select></label>
      <label>How did you sign in?<select value={method} onChange={(event) => { setMethod(event.target.value as LoginMethod); setDraft({ ...draft, password: "" }); setShowPassword(false); }}>{!paidPlatforms.has(draft.platform) && <option value="not_configured">Not recorded yet</option>}<option value="password">Password</option><option value="google">Sign in with Google</option><option value="apple">Sign in with Apple</option></select></label>
      <label>Username<input autoComplete="username" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} required /></label>
      <label>Profile URL<input autoComplete="url" placeholder={profilePlaceholders[draft.platform] ?? "https://example.com/username"} type="url" value={draft.profileUrl} onChange={(event) => setDraft({ ...draft, profileUrl: event.target.value })} /></label>
      <label>Email<input autoComplete="email" type="email" value={draft.loginEmail} onChange={(event) => setDraft({ ...draft, loginEmail: event.target.value })} required={method === "google" || method === "apple"} /></label>
      {method === "password" ? <label>Password<div className="creator-password-field"><input autoComplete={accountId ? "current-password" : "new-password"} maxLength={512} placeholder={accountId ? "Leave blank to keep the stored password" : "Current platform password"} type={showPassword ? "text" : "password"} value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} required={!accountId} /><button aria-label={showPassword ? "Hide password" : "Reveal password"} aria-pressed={showPassword} className="creator-reveal-password" onClick={() => setShowPassword((shown) => !shown)} type="button">{showPassword ? "Hide" : "Show"}</button></div></label> : <div className="provider-password-note"><strong>No password needed here.</strong><span>{method === "not_configured" ? "Record this profile now and connect it later from Accounts & connections." : `Your ${method === "google" ? "Google" : "Apple"} password stays with that provider.`}</span></div>}
      <label className="creator-purpose-field">What is this account for?<input value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value })} /></label>
      <div className="creator-purpose-suggestions"><span>Suggestions:</span>{["Main", "Backup", "Reels"].map((purpose) => <button key={purpose} onClick={() => setDraft({ ...draft, purpose })} type="button">{purpose}</button>)}<span>No wrong answers</span></div>
      <label className="creator-pin-field">{pinReady ? "Enter PIN to unlock and save" : "Create your four-digit Account PIN"}<input autoComplete="off" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" type="password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} required /></label>
      <p className="privacy-note">Never enter one-time passcodes or recovery codes.</p>
      <div className="creator-account-actions"><button className="secondary-action" onClick={() => { setEditing(false); setMessage(""); }} type="button">Cancel</button><button className="primary" disabled={saving} onClick={save} type="button">{saving ? "Saving securely…" : method === "password" && draft.password ? "Encrypt and save login" : "Save account details"}</button></div>
    </div></div> : null}
    {!accounts.length && !editing ? <p className="muted">No accounts yet. Add the first one whenever you&apos;re ready.</p> : null}
    <p className="creator-account-review-note">Creator-added accounts remain inactive until agency review.</p>
    <p aria-live="polite" className="creator-account-feedback" role="status">{message}</p>
  </section>;
}
