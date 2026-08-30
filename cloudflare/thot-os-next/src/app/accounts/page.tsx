import Link from "next/link";
import { addFanslyAccountAction, assignFanslyBrowserProfileAction, confirmFanslyIdentityAction, startInstagramReconnectAction } from "@/app/actions";
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
};

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
  const [setup, instagram] = await Promise.all([cloudflareEnv().DB.prepare(`SELECT oa.id,oa.label,oa.handle,oa.connection_status,oa.external_identity_confirmed_at,
    bp.label AS profile_label,bp.status AS profile_status,abp.verified_at AS profile_verified_at,
    (SELECT MAX(bc.last_seen_at) FROM bridge_credentials bc WHERE bc.creator_id=oa.creator_id AND bc.account_id=oa.id AND bc.status='active') AS bridge_last_seen_at
    FROM operational_accounts oa
    LEFT JOIN account_browser_profiles abp ON abp.creator_id=oa.creator_id AND abp.account_id=oa.id
    LEFT JOIN browser_profiles bp ON bp.creator_id=abp.creator_id AND bp.id=abp.profile_id
    WHERE oa.creator_id=? AND oa.platform='fansly' ORDER BY oa.label LIMIT 1`).bind(creatorId).first<FanslySetup>(),
    cloudflareEnv().DB.prepare(`SELECT oa.id,oa.label,oa.handle,oa.connection_status,oa.publishing_authority,oa.external_identity_confirmed_at,
      pc.status AS provider_status,pc.display_name,pc.last_error AS provider_error,state.last_analytics_sync_at
      FROM operational_accounts oa
      LEFT JOIN provider_connections pc ON pc.creator_id=oa.creator_id AND pc.service='instagram'
      LEFT JOIN instagram_sync_state state ON state.creator_id=oa.creator_id
      WHERE oa.creator_id=? AND oa.platform='instagram' ORDER BY oa.label LIMIT 1`).bind(creatorId).first<InstagramSetup>(),
  ]);
  const hasAssignedProfile = Boolean(setup?.profile_label && setup.profile_status !== "revoked");

  return <AppShell active="Accounts & connections"><PageHeader title="Accounts & connections" subtitle={`Set up creator-scoped platform access for ${context.creator.creator_name}. Platform passwords and 2FA stay in the native platform.`} />
    {query.saved === "fansly_added" && <div className="success">Fansly account and the assigned Chrome profile were added. Sign in natively, then confirm the visible identity.</div>}
    {query.saved === "fansly_profile_assigned" && <div className="success">Fansly Chrome profile assigned. Sign in natively, then confirm the visible identity.</div>}
    {query.saved === "fansly_identity_confirmed" && <div className="success">Fansly identity confirmed. You can now pair the assigned bridge and open the vault.</div>}
    <section className="panel connection-setup">
      <div className="section-heading"><div><span className="eyebrow">INSTAGRAM</span><h2>Official Instagram connection</h2><p>Connect the creator&apos;s professional Instagram account through the approved provider. Connecting verifies the visible account identity; it does not create, schedule or publish content.</p></div><span>{instagramStatus(instagram)}</span></div>
      {!instagram && <div className="empty"><b>Instagram account setup is required.</b><span>This creator does not yet have an Instagram account record. Add it during creator onboarding before starting OAuth.</span></div>}
      {instagram && <div className="fansly-workflow">
        <div className="connection-details"><div><small>Configured account</small><strong>{instagram.label}</strong><span>{instagram.handle || "Handle confirmed during connection"}</span></div><div><small>Provider identity</small><strong>{instagram.display_name || "Not verified"}</strong><span>{instagram.provider_status || "Connection not started"}</span></div><div><small>Latest analytics sync</small><strong>{formatDate(instagram.last_analytics_sync_at)}</strong><span>{instagram.publishing_authority === "confirmed" ? "Publishing authority confirmed" : "Publishing remains restricted"}</span></div></div>
        {instagram.provider_error && <div className="connection-banner attention"><div><strong>Connection needs attention</strong><span>{instagram.provider_error}</span></div></div>}
        {canManageIdentity ? <div className="connection-steps"><section><span>1</span><div><h3>{instagramStatus(instagram) === "Connected" ? "Reconnect the official account" : "Connect the official account"}</h3><p>OAuth opens the provider&apos;s native sign-in page. Complete credentials and 2FA there only. THOT OS verifies that the returned Instagram identity belongs to this creator workspace before enabling data sync.</p><form action={startInstagramReconnectAction}><button className="primary" type="submit">{instagramStatus(instagram) === "Connected" ? "Reconnect Instagram" : "Connect Instagram"}</button></form></div></section></div> : <div className="empty"><b>Instagram is {instagramStatus(instagram).toLowerCase()}.</b><span>An agency administrator can start or repair the provider connection.</span></div>}
        <div className="form-actions"><Link className="secondary-action" href="/operations?platform=instagram&section=analytics">Open read-only analytics</Link></div>
      </div>}
    </section>
    <section className="panel connection-setup">
      <div className="section-heading"><div><span className="eyebrow">FANSLY</span><h2>Fansly vault bridge</h2><p>THOT OS records a creator-scoped account and Chrome bridge assignment; it never asks for or stores a Fansly password.</p></div><span>{setup?.external_identity_confirmed_at ? "Identity confirmed" : setup ? "Setup in progress" : "Not configured"}</span></div>
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
        <div className="connection-details"><div><small>Configured account</small><strong>{setup.label}</strong><span>{setup.handle}</span></div><div><small>Chrome bridge profile</small><strong>{setup.profile_label || "Not assigned"}</strong><span>{setup.profile_status || "Profile required"}</span></div><div><small>Bridge last seen</small><strong>{formatDate(setup.bridge_last_seen_at)}</strong><span>{setup.profile_verified_at ? "Extension verified" : "Awaiting pairing"}</span></div></div>
        {canManageIdentity && <div className="connection-steps"><section><span>1</span><div><h3>Open secure sign-in</h3><p>Use the assigned local Chrome profile. Complete password and 2FA only on Fansly.</p><a className="secondary-action" href="https://fansly.com" target="_blank" rel="noreferrer">Open secure sign-in ↗</a></div></section>
          {!hasAssignedProfile ? <section><span>2</span><div><h3>Assign the THOT OS Chrome profile</h3><p>Open the THOT OS extension popup in the Chrome profile that will sign in to Fansly, then copy its installation ID. Assigning a profile requires confirming the native identity again.</p><form action={assignFanslyBrowserProfileAction} className="identity-confirm-form"><label>Chrome profile label<input name="profileLabel" required maxLength={80} placeholder={`${context.creator.creator_name} · Chrome`} /></label><label>THOT OS extension installation ID<input name="installationId" required minLength={36} maxLength={36} placeholder="Copy from the extension popup" autoComplete="off" /></label><button className="secondary-action" type="submit">Assign Chrome profile</button></form></div></section> : !setup.external_identity_confirmed_at ? <section><span>3</span><div><h3>Confirm the signed-in identity</h3><p>Check the handle visible in Fansly. A configured handle alone is never treated as proof.</p><form action={confirmFanslyIdentityAction} className="identity-confirm-form"><label>Visible Fansly handle<input name="observedHandle" defaultValue={setup.handle} required maxLength={80} autoComplete="off" /></label><label><input type="checkbox" name="identityConfirmed" value="yes" required /> I confirm this is {context.creator.creator_name}&apos;s signed-in Fansly account</label><button className="secondary-action" type="submit">Confirm identity</button></form></div></section> : <section><span>3</span><div><h3>Identity confirmed</h3><p>Confirmed {formatDate(setup.external_identity_confirmed_at)}. The browser profile can now receive a revocable bridge credential.</p></div></section>}
          {hasAssignedProfile && setup.external_identity_confirmed_at && <section><span>4</span><div><h3>Pair bridge and open vault</h3><p>The extension pairs only the configured Chrome profile, then opens Fansly&apos;s native vault. Opening this page is not evidence that an upload completed.</p><form action="/api/fansly/pair" method="post" target="_blank"><input type="hidden" name="destination" value="vault" /><button className="primary" type="submit">Pair bridge and open vault ↗</button></form></div></section>}
        </div>}
      </div>}
    </section>
    <section className="connection-banner muted"><div><strong>Private media stays in Cloudflare</strong><span>Fansly staging consumes creator-scoped R2 originals and remains pending until the native vault returns a receipt.</span></div><Link className="secondary-action" href="/library">Open Content Library</Link></section>
  </AppShell>;
}
