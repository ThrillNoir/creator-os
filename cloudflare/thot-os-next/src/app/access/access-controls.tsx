"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Credential = { id: string; credential_group: string; label: string; username: string; login_email: string; account_label: string | null; platform: string | null; shared_with_creator: number; status: string; updated_at: string; last_native_password_confirmation_at: string | null; notes: string };
type Account = { id: string; platform: string; label: string };

function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join("");
}

export function AccessControls({ credentials, accounts, canAdmin, hasPin }: { credentials: Credential[]; accounts: Account[]; canAdmin: boolean; hasPin: boolean }) {
  const [pin, setPin] = useState("");
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [revealed, setRevealed] = useState<{ id: string; password: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ label: "", group: "social", accountId: "", username: "", loginEmail: "", password: "", notes: "", sharedWithCreator: false });

  async function request(action: string, payload: Record<string, unknown> = {}) {
    setNotice("");
    const response = await fetch("/api/access/credentials", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, pin, ...payload }) });
    const body = await response.json() as { error?: string; password?: string; notice?: string };
    if (!response.ok) throw new Error(body.error || "Access request failed.");
    return body;
  }
  async function withNotice(action: string, payload: Record<string, unknown> = {}) {
    try { const result = await request(action, payload); setNotice(result.notice || "Saved."); return result; } catch (error) { setNotice(error instanceof Error ? error.message : "Access request failed."); return null; }
  }
  async function reveal(credential: Credential, copy = false) {
    const result = await withNotice(copy ? "copy" : "reveal", { credentialId: credential.id });
    if (!result?.password) return;
    if (copy) { await navigator.clipboard.writeText(result.password); setNotice("Password copied. Clipboard contents remain under your browser’s control."); }
    else { setRevealed({ id: credential.id, password: result.password }); window.setTimeout(() => setRevealed((current) => current?.id === credential.id ? null : current), 30_000); }
  }
  async function create() {
    const result = await withNotice("create", draft);
    if (result) { setDraft({ label: "", group: "social", accountId: "", username: "", loginEmail: "", password: "", notes: "", sharedWithCreator: false }); setCreating(false); router.refresh(); }
  }

  const grouped = ["social", "paid", "chrome", "other"].map((group) => [group, credentials.filter((credential) => credential.credential_group === group)] as const);
  return <>
    <section className="panel admin-section"><div className="section-heading"><div><h2>PIN step-up</h2><p>{hasPin ? "Confirm this four-digit PIN before any password operation. It is never used as an encryption key." : "Set your four-digit Access PIN before using credentials."}</p></div><span>{hasPin ? "Configured" : "Required"}</span></div>
      <div className="inline-form"><label>Four-digit PIN<input aria-label="Four-digit PIN" autoComplete="off" inputMode="numeric" maxLength={4} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} type="password" value={pin} /></label><button className="primary" onClick={() => withNotice("setup_pin")} type="button">{hasPin ? "Replace PIN" : "Set PIN"}</button><small>Five failed attempts lock the PIN; each subsequent lockout increases.</small></div>
      <p className="identity-guardrail" aria-live="polite">{notice}</p>
    </section>
    {canAdmin ? <section className="panel admin-section"><div className="section-heading"><div><h2>Create encrypted credential</h2><p>Creating or replacing a stored password never changes a native platform password.</p></div><button className="primary" onClick={() => setCreating((open) => !open)} type="button">{creating ? "Close" : "New credential"}</button></div>
      {creating ? <div className="inline-form"><label>Label<input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label><label>Group<select value={draft.group} onChange={(event) => setDraft({ ...draft, group: event.target.value })}><option value="social">Social profile</option><option value="paid">Paid platform</option><option value="chrome">Chrome / Google</option><option value="other">Other service</option></select></label><label>Account<select value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}><option value="">No linked account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.platform} · {account.label}</option>)}</select></label><label>Username<input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></label><label>Login email<input type="email" value={draft.loginEmail} onChange={(event) => setDraft({ ...draft, loginEmail: event.target.value })} /></label><label>Password<input autoComplete="new-password" type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></label><button className="secondary" onClick={() => setDraft({ ...draft, password: randomPassword() })} type="button">Generate strong password</button><label><input checked={draft.sharedWithCreator} onChange={(event) => setDraft({ ...draft, sharedWithCreator: event.target.checked })} type="checkbox" /> Share with creator</label><label>Non-secret notes<input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label><small role="status">Requirements: label, password of at least 12 characters, and a 4-digit PIN.</small><button className="primary" disabled={!draft.label || draft.password.length < 12 || pin.length !== 4} onClick={create} type="button">Encrypt and save</button></div> : null}
    </section> : null}
    {grouped.map(([group, items]) => <section className="panel admin-section" key={group}><div className="section-heading"><div><h2>{({ social: "Social profiles", paid: "Paid platforms", chrome: "Chrome / Google access", other: "Other creator-owned services" } as Record<string, string>)[group]}</h2><p>{items.length} active credential{items.length === 1 ? "" : "s"} · passwords stay concealed by default.</p></div></div>
      {items.length ? items.map((credential) => { const stale = !credential.last_native_password_confirmation_at || Date.parse(credential.last_native_password_confirmation_at) < Date.parse(credential.updated_at); return <article className="identity-row" key={credential.id}><div><strong>{credential.label}</strong><small>{credential.platform ? `${credential.platform} · ` : ""}{credential.account_label || "Unlinked"}{credential.username ? ` · ${credential.username}` : ""}{credential.login_email ? ` · ${credential.login_email}` : ""}</small><span>{stale ? "Native-password confirmation required" : "Native password confirmed"}{credential.notes ? ` · ${credential.notes}` : ""}</span>{revealed?.id === credential.id ? <code aria-live="polite">{revealed.password}</code> : null}</div><div className="connection-row-actions"><button className="primary" disabled={pin.length !== 4} onClick={() => reveal(credential)} type="button">Reveal</button><button className="secondary" disabled={pin.length !== 4} onClick={() => reveal(credential, true)} type="button">Copy</button><button className="secondary" disabled={pin.length !== 4} onClick={() => { const next = window.prompt("New password (this does not change the native platform password)"); if (next) withNotice("replace", { credentialId: credential.id, password: next }); }} type="button">Replace</button><button className="secondary" disabled={pin.length !== 4} onClick={() => withNotice("confirm_native", { credentialId: credential.id })} type="button">Confirm native update</button>{canAdmin ? <><button className="secondary" disabled={pin.length !== 4} onClick={() => withNotice("visibility", { credentialId: credential.id, sharedWithCreator: !credential.shared_with_creator })} type="button">{credential.shared_with_creator ? "Hide from creator" : "Share with creator"}</button><button className="danger-action" disabled={pin.length !== 4} onClick={() => { if (window.confirm("Revoke this credential?")) withNotice("revoke", { credentialId: credential.id }); }} type="button">Revoke</button></> : null}</div></article>; }) : <div className="empty"><b>No credentials in this group</b><span>Credential details and passwords are never included in this page response.</span></div>}
    </section>)}
    <section className="panel reserved-control"><span className="eyebrow">SCRIPTS — COMING SOON</span><h2>Creator-approved scripts</h2><p>This section will later hold approved phrases, introductions, calls to action, video prompts, platform variations, and things the creator is comfortable saying. Script generation is not enabled here.</p></section>
  </>;
}
