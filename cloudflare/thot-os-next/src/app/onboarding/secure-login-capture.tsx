"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Account = { id: string; platform: string; label: string; handle: string; login_email: string };
type CreateAccount = (form: FormData) => Promise<{ ok: boolean; id: string }>;

const paidPlatforms = new Set(["onlyfans", "fansly", "manyvids", "patreon", "myroomz"]);
const platforms = ["instagram", "reddit", "x", "tiktok", "threads", "facebook", "telegram", "youtube", "fansly", "onlyfans", "manyvids", "patreon", "myroomz", "other"];

export function SecureLoginCapture({ accounts, hasPin, createAccount }: { accounts: Account[]; hasPin: boolean; createAccount: CreateAccount }) {
  const router = useRouter();
  const initial = accounts[0];
  const [pin, setPin] = useState("");
  const [pinReady, setPinReady] = useState(hasPin);
  const [accountId, setAccountId] = useState(initial?.id ?? "");
  const [draft, setDraft] = useState({ platform: initial?.platform ?? "instagram", label: initial?.label ?? "", username: initial?.handle ?? "", loginEmail: initial?.login_email ?? "", profileUrl: "", purpose: "", password: "" });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function chooseAccount(id: string) {
    const account = accounts.find((item) => item.id === id);
    setAccountId(id);
    setDraft({ platform: account?.platform ?? "instagram", label: account?.label ?? "", username: account?.handle ?? "", loginEmail: account?.login_email ?? "", profileUrl: "", purpose: "", password: "" });
    setMessage("");
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
      if (!/^\d{4}$/.test(pin)) throw new Error(pinReady ? "Confirm your four-digit Access PIN." : "Create a four-digit Access PIN first.");
      if (!draft.label.trim() || draft.password.length < 12) throw new Error("Enter an account label and a password of at least 12 characters.");
      let selected = accountId;
      if (!selected) {
        const account = new FormData();
        account.set("accountKind", paidPlatforms.has(draft.platform) ? "paid" : "social");
        account.set("platform", draft.platform); account.set("label", draft.label); account.set("username", draft.username);
        account.set("loginEmail", draft.loginEmail); account.set("profileUrl", draft.profileUrl); account.set("purpose", draft.purpose); account.set("isActive", "yes");
        selected = (await createAccount(account)).id;
      }
      if (!pinReady) { await request({ action: "setup_pin", pin }); setPinReady(true); }
      await request({ action: "create", pin, accountId: selected, group: paidPlatforms.has(draft.platform) ? "paid" : "social", label: draft.label, username: draft.username, loginEmail: draft.loginEmail, password: draft.password });
      setAccountId(selected); setDraft((current) => ({ ...current, password: "" })); setPin(""); setMessage("Login details saved securely."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Login details could not be saved."); }
    finally { setSaving(false); }
  }

  return <section className="secure-login-capture" aria-labelledby="secure-login-title"><div className="section-heading"><div><h3 id="secure-login-title">Add an account and secure its login</h3><p>Passwords go straight into the encrypted Access vault. THOT OS never sends them to the onboarding AI.</p></div><span>{pinReady ? "PIN configured" : "PIN setup required"}</span></div><div className="inline-form creator-form">
    {accounts.length > 0 && <label>Account<select value={accountId} onChange={(event) => chooseAccount(event.target.value)}><option value="">Add another account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.platform} · {account.label}</option>)}</select></label>}
    {!accountId && <label>Platform<select value={draft.platform} onChange={(event) => setDraft({ ...draft, platform: event.target.value })}>{platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}</select></label>}
    <label>Account label<input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="e.g. main Instagram" required /></label>
    <label>Username or handle<input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></label>
    <label>Login email<input type="email" value={draft.loginEmail} onChange={(event) => setDraft({ ...draft, loginEmail: event.target.value })} /></label>
    {!accountId && <><label>Profile URL<input type="url" value={draft.profileUrl} onChange={(event) => setDraft({ ...draft, profileUrl: event.target.value })} /></label><label>What is this account for?<input value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value })} /></label></>}
    <label>Password<input autoComplete="new-password" minLength={12} type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} required /></label>
    <label>{pinReady ? "Confirm your four-digit vault PIN" : "Create a four-digit vault PIN"}<input autoComplete="off" inputMode="numeric" maxLength={4} type="password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} required /></label>
    <p className="privacy-note">Use a creator-specific email and unique password where possible. Never enter one-time passcodes or recovery codes.</p>
    <button className="primary" disabled={saving} onClick={save} type="button">{saving ? "Saving securely…" : "Encrypt and save login"}</button><p aria-live="polite" role="status">{message}</p>
  </div></section>;
}
