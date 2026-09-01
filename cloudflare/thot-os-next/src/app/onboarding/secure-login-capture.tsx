"use client";

import { useState } from "react";

type Account = { id: string; platform: string; label: string };
type CreateAccount = (form: FormData) => Promise<{ ok: boolean; id: string }>;

/** Small onboarding bridge: account metadata is created separately, then its password is sent once to Access. */
export function SecureLoginCapture({ accounts, hasPin, createAccount }: { accounts: Account[]; hasPin: boolean; createAccount?: CreateAccount }) {
  const [pin, setPin] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [draft, setDraft] = useState({ platform: "instagram", label: "", username: "", loginEmail: "", profileUrl: "", purpose: "", password: "", notes: "" });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [pinReady, setPinReady] = useState(hasPin);

  async function save() {
    setMessage(""); setSaving(true);
    try {
      if (!pinReady && !/^\d{4}$/.test(pin)) throw new Error("Set a four-digit Access PIN before saving login details.");
      if (!draft.label.trim() || draft.password.length < 12) throw new Error("Enter a label and a password of at least 12 characters.");
      let selected = accountId;
      if (!selected) {
        if (!createAccount) throw new Error("Choose an account before saving login details.");
        const account = new FormData();
        account.set("accountKind", ["onlyfans", "fansly", "manyvids", "patreon"].includes(draft.platform) ? "paid" : "social");
        account.set("platform", draft.platform); account.set("label", draft.label); account.set("username", draft.username);
        account.set("loginEmail", draft.loginEmail); account.set("profileUrl", draft.profileUrl); account.set("purpose", draft.purpose); account.set("isActive", "yes");
        selected = (await createAccount(account)).id;
      }
      const platform = accounts.find((account) => account.id === selected)?.platform ?? draft.platform;
      const body: Record<string, unknown> = { action: "create", pin, accountId: selected, group: ["onlyfans", "fansly", "manyvids", "patreon"].includes(platform) ? "paid" : "social", label: draft.label, username: draft.username, loginEmail: draft.loginEmail, password: draft.password, notes: draft.notes };
      if (!pinReady) { body.action = "setup_pin"; await request(body); body.action = "create"; }
      await request(body);
      setDraft({ platform: "instagram", label: "", username: "", loginEmail: "", profileUrl: "", purpose: "", password: "", notes: "" });
      setPinReady(true); setMessage("Login details saved securely.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Login details could not be saved."); }
    finally { setSaving(false); }
  }
  async function request(body: Record<string, unknown>) {
    const response = await fetch("/api/access/credentials", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "Login details could not be saved.");
    return result;
  }
  return <section className="panel admin-section" aria-label="Secure login details"><div className="section-heading"><div><h2>Save login details</h2><p>Passwords and recovery or MFA notes are encrypted in Access and are never shown again after saving.</p></div><span>{pinReady ? "PIN ready" : "PIN required"}</span></div><div className="inline-form">
    {!pinReady && <label>Four-digit Access PIN<input inputMode="numeric" maxLength={4} type="password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} /></label>}
    {accounts.length > 0 && <label>Account<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Add a new account below</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.platform} · {account.label}</option>)}</select></label>}
    {!accountId && <><label>Platform<input value={draft.platform} onChange={(event) => setDraft({ ...draft, platform: event.target.value.toLowerCase() })} required /></label><label>Internal label<input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} required /></label><label>Username or handle<input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></label><label>Login email<input type="email" value={draft.loginEmail} onChange={(event) => setDraft({ ...draft, loginEmail: event.target.value })} /></label><label>Profile URL<input type="url" value={draft.profileUrl} onChange={(event) => setDraft({ ...draft, profileUrl: event.target.value })} /></label><label>What is this account for?<input value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value })} /></label></>}
    {accountId && <label>Login label<input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} required /></label>}<label>Password<input autoComplete="new-password" minLength={12} type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} required /></label><label>Recovery or MFA notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label><button className="primary" disabled={saving} onClick={save} type="button">{saving ? "Saving…" : "Encrypt and save"}</button><p aria-live="polite" role="status">{message}</p>
  </div></section>;
}
