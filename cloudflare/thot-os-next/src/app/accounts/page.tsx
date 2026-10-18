import Link from "next/link";
import { addFanslyAccountAction, assignFanslyBrowserProfileAction, confirmFanslyIdentityAction, startInstagramReconnectAction } from "@/app/actions";
import { retireOperationalAccountAction } from "@/app/onboarding/actions";
import { instagramSendingBlocker } from "@/lib/instagram-readiness";
import { platformLabel, postingStatus } from "@/lib/account-presentation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { roleCan } from "@/lib/authorization";

type FanslySetup = {
  id: string;
  label: string;
  handle: string;
  connection_status: string;
  external_identity_confirmed_at: string | null;
  profile_label: string | null;
  profile_status: string | null;
  profile_verified_at: string | null;
  bridge_last_seen_at: string | null;
  has_live_bridge: number;
};
type InstagramSetup = {
  id: string;
  label: string;
  handle: string | null;
  connection_status: string;
  publishing_authority: string;
  external_identity_confirmed_at: string | null;
  provider_status: string | null;
  display_name: string | null;
  provider_error: string | null;
  last_analytics_sync_at: string | null;
  is_active: number;
  messaging_status: string | null; messaging_mode: string | null; messaging_write_enabled: number | null; messaging_outbound_validated: number | null; messaging_error: string | null; messaging_sync_error: string | null; messaging_paused: number;
};
type PlatformAccount = { id: string; platform: string; label: string; handle: string; connection_status: string; connection_method: string; account_kind: string; is_active: number; publishing_authority: string; has_credential: number };

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"));
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString("en-AU", { timeZone: "Australia/Perth", dateStyle: "medium", timeStyle: "short" });
}

function instagramStatus(setup: InstagramSetup | null | undefined) {
  if (!setup) return "Account setup required";
  if (setup.connection_status === "connected" && setup.provider_status === "active") return "Connected";
  if (setup.connection_status === "needs_reconnection") return "Reconnect required";
  return "Connection required";
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ saved?: string; connectionError?: string }> }) {
  const [query, context] = await Promise.all([searchParams, requireCreatorContext()]);
  const creatorId = context.creator.creator_id;
  const canManageIdentity = roleCan(context.creator.role, "manage_identity");
  const canConnectProviders = roleCan(context.creator.role, "mutate");
  const [accounts, setup, instagramAccounts] = await Promise.all([
    cloudflareEnv().DB.prepare("SELECT oa.id,oa.platform,oa.label,oa.handle,oa.connection_status,oa.connection_method,oa.account_kind,oa.is_active,oa.publishing_authority,EXISTS(SELECT 1 FROM vault_credentials vc WHERE vc.creator_id=oa.creator_id AND vc.account_id=oa.id AND vc.status='active') AS has_credential FROM operational_accounts oa WHERE oa.creator_id=? AND account_kind IN ('social','paid') ORDER BY account_kind,platform,label").bind(creatorId).all<PlatformAccount>(),
    cloudflareEnv().DB.prepare(`SELECT oa.id,oa.label,oa.handle,oa.connection_status,oa.external_identity_confirmed_at,
    bp.label AS profile_label,bp.status AS profile_status,abp.verified_at AS profile_verified_at,
    (SELECT MAX(bc.last_seen_at) FROM bridge_credentials bc WHERE bc.creator_id=oa.creator_id AND bc.account_id=oa.id AND bc.profile_id=abp.profile_id AND bc.status='active' AND bc.expires_at>CURRENT_TIMESTAMP AND bp.status<>'revoked') AS bridge_last_seen_at,
    EXISTS(SELECT 1 FROM bridge_credentials bc WHERE bc.creator_id=oa.creator_id AND bc.account_id=oa.id AND bc.profile_id=abp.profile_id AND bc.status='active' AND bc.expires_at>CURRENT_TIMESTAMP AND bp.status<>'revoked') AS has_live_bridge
    FROM operational_accounts oa
    LEFT JOIN account_browser_profiles abp ON abp.creator_id=oa.creator_id AND abp.account_id=oa.id
    LEFT JOIN browser_profiles bp ON bp.creator_id=abp.creator_id AND bp.id=abp.profile_id
    WHERE oa.creator_id=? AND oa.platform='fansly' AND oa.is_active=1 ORDER BY oa.label LIMIT 1`).bind(creatorId).first<FanslySetup>(),
    cloudflareEnv().DB.prepare(`SELECT oa.id,oa.label,oa.handle,oa.connection_status,oa.publishing_authority,oa.external_identity_confirmed_at,oa.is_active,
      pc.status AS provider_status,pc.display_name,pc.last_error AS provider_error,state.last_analytics_sync_at,
      mc.status AS messaging_status,mc.mode AS messaging_mode,mc.write_enabled AS messaging_write_enabled,mc.outbound_validated AS messaging_outbound_validated,mc.last_error AS messaging_error,mc.last_sync_error AS messaging_sync_error,
      EXISTS(SELECT 1 FROM messaging_connections paused WHERE paused.creator_id=oa.creator_id AND paused.emergency_paused=1) AS messaging_paused
      FROM operational_accounts oa
      LEFT JOIN provider_connections pc ON pc.creator_id=oa.creator_id AND pc.service='instagram' AND pc.account_id=oa.id
      LEFT JOIN instagram_account_sync_state state ON state.creator_id=oa.creator_id AND state.account_id=oa.id
      LEFT JOIN messaging_connections mc ON mc.creator_id=oa.creator_id AND mc.account_id=oa.id AND mc.platform='instagram'
      WHERE oa.creator_id=? AND oa.platform='instagram' ORDER BY oa.label`).bind(creatorId).all<InstagramSetup>(),
  ]);
  const hasAssignedProfile = Boolean(setup?.profile_label && setup.profile_status !== "revoked");
  const hasVerifiedBridge = Boolean(setup?.has_live_bridge && setup.profile_status === "paired" && setup.profile_verified_at && setup.bridge_last_seen_at);

  return <AppShell active="Accounts & connections"><PageHeader title="Accounts & connections" subtitle={`Set up creator-scoped platform access for ${context.creator.creator_name}. Saved logins stay encrypted in Access. Connecting a platform is a separate step; complete 2FA on that platform.`} />
    {query.saved === "fansly_added" && <div className="success">Fansly account and the assigned Chrome profile were added. Sign in natively, then confirm the visible identity.</div>}
    {query.saved === "fansly_profile_assigned" && <div className="success">Fansly Chrome profile assigned. Sign in natively, then confirm the visible identity.</div>}
    {query.saved === "fansly_identity_confirmed" && <div className="success">Fansly identity confirmed. You can now pair the assigned bridge and open the vault.</div>}
    {query.saved === "account_retired" && <div className="success">Account retired. History is preserved and publishing is blocked.</div>}
    <section className="panel connection-setup"><div className="section-heading"><div><span className="eyebrow">YOUR ACCOUNTS</span><h2>Your saved accounts</h2><p>Account details and platform connections are separate. Connect only the platforms THOT OS currently supports.</p></div><span>{accounts.results.length} received</span></div>
      {accounts.results.length ? <div className="identity-list">{accounts.results.map((account) => { const pending = !account.is_active; const supported = account.platform === "instagram" || account.platform === "reddit" || account.platform === "fansly"; const href = account.platform === "instagram" ? `#instagram-${account.id}` : account.platform === "reddit" ? `/operations?platform=reddit&accountId=${encodeURIComponent(account.id)}` : account.platform === "fansly" ? "#fansly" : ""; return <article className="identity-row" key={account.id}><div><strong>{platformLabel(account.platform)} · {account.handle || account.label}</strong><small>{account.handle || "No username"} · {pending ? "Inactive — review in onboarding" : account.connection_status === "connected" ? "Connected" : supported ? "Connection required" : "Account recorded"}</small><span>{account.connection_method === "password" ? account.has_credential ? "Password saved securely" : "Password still needed" : account.connection_method === "google" ? "Google sign-in recorded" : account.connection_method === "apple" ? "Apple sign-in recorded" : "Account details saved"}{!supported ? " · No THOT OS connector available yet" : ""}</span></div>{canConnectProviders && !pending && href ? <Link className="secondary-action" href={href}>{account.platform === "fansly" ? "Manage bridge" : account.connection_status === "connected" ? "Manage connection" : `Connect ${platformLabel(account.platform)}`}</Link> : pending ? <Link className="secondary-action" href="/onboarding">Review account</Link> : null}</article>; })}</div> : <div className="empty"><b>No accounts received</b><span>Add profiles during creator onboarding first.</span></div>}
    </section>
    <section className="panel connection-setup" id="instagram">
      <div className="section-heading"><div><span className="eyebrow">INSTAGRAM</span><h2>Instagram connections</h2><p>Each account has its own connection, publishing authority and inbox. Connecting does not publish or send anything.</p></div></div>
      {!instagramAccounts.results.length && <div className="empty"><b>No Instagram accounts added.</b><Link href="/onboarding">Add an account in onboarding</Link></div>}
      {instagramAccounts.results.map((account) => {
        const connected = instagramStatus(account) === "Connected";
        const messagingBlocker = instagramSendingBlocker(account.messaging_status ? { status: account.messaging_status, mode: account.messaging_mode ?? "observe", write_enabled: account.messaging_write_enabled ?? 0, outbound_validated: account.messaging_outbound_validated ?? 0, last_error: account.messaging_error } : undefined, true, Boolean(account.messaging_paused));
        const inboxHref = `/messages?platform=instagram&accountId=${encodeURIComponent(account.id)}`;
        return <article className="account-connection" id={`instagram-${account.id}`} key={account.id}>
          <div className="section-heading"><div><h3>Instagram · {account.handle || account.label}</h3><p>{account.is_active ? instagramStatus(account) : "Inactive — agency review required"}</p></div></div>
          {account.is_active ? <><dl className="account-details"><div><dt>Posting</dt><dd>{connected ? postingStatus({ ...account, platform: "instagram" }) : "Connection required"}</dd></div><div><dt>Messaging</dt><dd>{account.messaging_sync_error ? "Sync needs attention — open inbox" : messagingBlocker || "Replies enabled · availability checked per conversation"}</dd></div></dl>
          {(account.provider_error || account.messaging_sync_error) && <p className="reply-error">This account needs attention. {account.provider_error ? "Review its connection below." : "Open its inbox to review the latest sync."}</p>}
          <div className="connection-row-actions">{connected && <><Link className="primary" href={inboxHref}>Open inbox</Link><Link className="secondary-action" href={`/operations?platform=instagram&section=create&accountId=${encodeURIComponent(account.id)}`}>Create post</Link></>}
          {!connected && canConnectProviders && <form action={startInstagramReconnectAction}><input type="hidden" name="accountId" value={account.id} /><button className="primary" type="submit">Connect Instagram</button></form>}</div>
          <details className="account-connection-details"><summary>Connection details{connected ? " & reconnect" : ""}</summary><p>Analytics last checked: {formatDate(account.last_analytics_sync_at)}. Passwords and 2FA for this connection are entered on Instagram’s sign-in page.</p>{account.provider_error && <p role="status">{account.provider_error}</p>}
          <div className="connection-row-actions"><Link className="secondary-action" href={`/operations?platform=instagram&section=analytics&accountId=${encodeURIComponent(account.id)}`}>View analytics</Link>{connected && canConnectProviders && <form action={startInstagramReconnectAction}><input type="hidden" name="accountId" value={account.id} /><button className="secondary-action" type="submit">Reconnect Instagram</button></form>}</div></details></> : <Link href="/onboarding">Review account</Link>}
        </article>;
      })}
    </section>
    <section className="panel connection-setup" id="fansly">
      <div className="section-heading"><div><span className="eyebrow">FANSLY</span><h2>Fansly vault bridge</h2><p>The bridge uses this creator’s signed-in Chrome profile. Any login you save in Access stays encrypted and is never sent automatically to the extension.</p></div><span>{setup?.external_identity_confirmed_at ? "Identity confirmed" : setup ? "Setup in progress" : "Not configured"}</span></div>
      {!setup && canManageIdentity && <form action={addFanslyAccountAction} className="inline-form fansly-setup-form">
        <div className="section-divider"><b>Add Fansly for {context.creator.creator_name}</b><span>Open the THOT OS extension popup in the Chrome profile that will sign in to Fansly, then copy its installation ID below. This binds the bridge to that profile only.</span></div>
        <label>Account label<input name="label" required maxLength={80} placeholder={`${context.creator.creator_name} Fansly`} /></label>
        <label>Expected Fansly handle<input name="handle" required maxLength={80} placeholder="creatorhandle" autoComplete="off" /></label>
        <label>Chrome profile label<input name="profileLabel" required maxLength={80} placeholder={`${context.creator.creator_name} · Chrome`} /></label>
        <label>THOT OS extension installation ID<input name="installationId" required minLength={36} maxLength={36} placeholder="Copy from the extension popup" autoComplete="off" /></label>
        <button className="primary" type="submit">Add Fansly account</button>
      </form>}
      {!setup && !canManageIdentity && <div className="empty"><b>Fansly is not configured.</b><span>An agency administrator can add the account and assign its local Chrome bridge for this creator.</span></div>}
      {setup && <div className="fansly-workflow">
        <div className="connection-details"><div><small>Configured account</small><strong>{setup.label}</strong><span>{setup.handle}</span></div><div><small>Chrome bridge profile</small><strong>{setup.profile_label || "Not assigned"}</strong><span>{setup.profile_status || "Profile required"}</span></div><div><small>Bridge last seen</small><strong>{formatDate(setup.bridge_last_seen_at)}</strong><span>{hasVerifiedBridge ? "Extension verified" : "Awaiting pairing"}</span></div></div>
        {canManageIdentity && <div className="connection-steps"><section><span>1</span><div><h3>Open secure sign-in</h3><p>Use the assigned local Chrome profile. Complete password and 2FA only on Fansly.</p><a className="secondary-action" href="https://fansly.com" target="_blank" rel="noreferrer">Open secure sign-in ↗</a></div></section>
          {!hasAssignedProfile ? <section><span>2</span><div><h3>Assign the THOT OS Chrome profile</h3><p>Open the THOT OS extension popup in the Chrome profile that will sign in to Fansly, then copy its installation ID. Assigning a profile requires confirming the native identity again.</p><form action={assignFanslyBrowserProfileAction} className="identity-confirm-form"><label>Chrome profile label<input name="profileLabel" required maxLength={80} placeholder={`${context.creator.creator_name} · Chrome`} /></label><label>THOT OS extension installation ID<input name="installationId" required minLength={36} maxLength={36} placeholder="Copy from the extension popup" autoComplete="off" /></label><button className="secondary-action" type="submit">Assign Chrome profile</button></form></div></section> : !setup.external_identity_confirmed_at ? <section><span>3</span><div><h3>Confirm the signed-in identity</h3><p>Check the handle visible in Fansly. A configured handle alone is never treated as proof.</p><form action={confirmFanslyIdentityAction} className="identity-confirm-form"><label>Visible Fansly handle<input name="observedHandle" defaultValue={setup.handle} required maxLength={80} autoComplete="off" /></label><label><input type="checkbox" name="identityConfirmed" value="yes" required /> I confirm this is {context.creator.creator_name}&apos;s signed-in Fansly account</label><button className="secondary-action" type="submit">Confirm identity</button></form></div></section> : <section><span>3</span><div><h3>Identity confirmed</h3><p>Confirmed {formatDate(setup.external_identity_confirmed_at)}. The browser profile can now receive a revocable bridge credential.</p></div></section>}
          {hasAssignedProfile && setup.external_identity_confirmed_at && <section><span>4</span><div><h3>{hasVerifiedBridge ? "Open the signed vault" : setup.has_live_bridge ? "Pairing awaiting verification" : "Pair bridge and open vault"}</h3><p>{hasVerifiedBridge ? `Open the native Fansly vault in the assigned ${setup.profile_label} Chrome profile. Pairing a replacement requires a supervised cutover.` : setup.has_live_bridge ? "A credential was issued but the extension has not verified it. Check the pairing tab. If it failed, an agency administrator can review and revoke the unused credential on Creators before retrying." : "Copy this Chrome profile’s extension installation ID before pairing. Opening the vault is not evidence that an upload completed."}</p>{hasVerifiedBridge ? <a className="primary" href="https://fansly.com/creator/vault" target="_blank" rel="noreferrer">Open Fansly vault ↗</a> : setup.has_live_bridge ? <Link className="secondary-action" href={`/creators?creator=${encodeURIComponent(creatorId)}`}>Review bridge credential</Link> : <form action="/api/fansly/pair" method="post" target="_blank"><input type="hidden" name="destination" value="vault" /><label>Extension installation ID<input name="installationId" required minLength={36} maxLength={36} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}" autoComplete="off" placeholder="Copy from this Chrome profile’s extension popup" /></label><button className="primary" type="submit">Pair bridge and open vault ↗</button></form>}</div></section>}
        </div>}
      </div>}
    </section>
    {context.creator.role === "agency_admin" && <details className="panel account-lifecycle"><summary>Advanced account management</summary><h2>Retire an account</h2><p>Retirement preserves history and blocks publishing. Resolve draft, scheduled and publishing posts first.</p>{accounts.results.filter((account) => account.is_active).map((account) => <form className="identity-row" action={retireOperationalAccountAction} key={account.id}><div><strong>{platformLabel(account.platform)} · {account.handle || account.label}</strong></div><input name="accountId" type="hidden" value={account.id} /><button className="danger-action" type="submit">Retire account</button></form>)}</details>}
    <section className="connection-banner muted"><div><strong>Private media stays in Cloudflare</strong><span>Fansly staging consumes creator-scoped R2 originals and remains pending until the native vault returns a receipt.</span></div><Link className="secondary-action" href="/library">Open Content Library</Link></section>
  </AppShell>;
}
