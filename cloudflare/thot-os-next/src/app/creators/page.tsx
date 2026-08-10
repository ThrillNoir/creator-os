import { AppShell, PageHeader } from "@/components/app-shell";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext, roleCan } from "@/lib/identity";
import { assignBrowserProfileAction, registerBrowserProfileAction, revokeBridgeCredentialsAction, saveCreatorMembershipAction, suspendCreatorMembershipAction } from "@/app/identity-actions";

export default async function CreatorsPage() {
  const context = await requireCreatorContext();
  const { DB } = cloudflareEnv();
  const canManage = roleCan(context.creator.role, "manage_identity");
  const [creators, memberships, profiles, accounts, assignments] = await Promise.all([DB.prepare(`
    SELECT c.id,c.name,c.status,COUNT(a.id) AS assets
    FROM creators c JOIN creator_memberships m ON m.creator_id=c.id AND lower(m.user_email)=? AND m.status='active'
    LEFT JOIN assets a ON a.creator_id=c.id AND a.source_available=1
    GROUP BY c.id,c.name,c.status ORDER BY c.name
  `).bind(context.email).all<{ id: string; name: string; status: string; assets: number }>(),
  DB.prepare(`SELECT m.user_email,u.display_name,m.role,m.status FROM creator_memberships m JOIN users u ON lower(u.email)=lower(m.user_email)
    WHERE m.creator_id=? AND (?=1 OR lower(m.user_email)=?) ORDER BY CASE m.status WHEN 'active' THEN 0 ELSE 1 END,u.display_name`).bind(context.creator.creator_id, canManage ? 1 : 0, context.email).all<{ user_email: string; display_name: string; role: string; status: string }>(),
  canManage ? DB.prepare("SELECT id,label,status,last_seen_at FROM browser_profiles WHERE creator_id=? AND status<>'revoked' ORDER BY label").bind(context.creator.creator_id).all<{ id: string; label: string; status: string; last_seen_at: string | null }>() : Promise.resolve({ results: [] as { id: string; label: string; status: string; last_seen_at: string | null }[], success: true, meta: {} }),
  DB.prepare("SELECT id,platform,label,handle FROM operational_accounts WHERE creator_id=? ORDER BY platform,label").bind(context.creator.creator_id).all<{ id: string; platform: string; label: string; handle: string }>(),
  DB.prepare(`SELECT abp.account_id,abp.platform,bp.label,abp.verified_at,
    EXISTS(SELECT 1 FROM bridge_credentials bc WHERE bc.creator_id=abp.creator_id AND bc.account_id=abp.account_id AND bc.profile_id=abp.profile_id AND bc.status='active' AND bc.expires_at>CURRENT_TIMESTAMP) AS credential_active
    FROM account_browser_profiles abp JOIN browser_profiles bp ON bp.id=abp.profile_id AND bp.creator_id=abp.creator_id WHERE abp.creator_id=? ORDER BY abp.platform`).bind(context.creator.creator_id).all<{ account_id: string; platform: string; label: string; verified_at: string | null; credential_active: number }>(),
  ]);
  return <AppShell active="Creators"><PageHeader title="Creators & access" subtitle="Creator memberships and explicit Chrome-profile boundaries." eyebrow={`${context.creator.creator_name.toUpperCase()} WORKSPACE`} />
    <section className="panel creator-list">{creators.results.map((creator) => <article key={creator.id}><span className="avatar">{creator.name.slice(0,1)}</span><div><strong>{creator.name}</strong><small>{creator.assets} assets · {creator.status}</small></div><span className="state">Connected to D1</span></article>)}</section>
    <section className="panel"><h2>Workspace memberships</h2><p>Cloudflare Access identifies the email. This membership grants its role only inside {context.creator.creator_name}.</p>
      {memberships.results.map((membership) => <article className="identity-row" key={membership.user_email}><div><strong>{membership.display_name}</strong><small>{membership.user_email} · {membership.role.replaceAll("_", " ")} · {membership.status}</small></div>{canManage && membership.status === "active" && membership.user_email.toLowerCase() !== context.email ? <form action={suspendCreatorMembershipAction}><input type="hidden" name="email" value={membership.user_email} /><button className="secondary-action" type="submit">Suspend</button></form> : null}</article>)}
      {canManage && <form action={saveCreatorMembershipAction} className="inline-form"><label>Email<input name="email" type="email" required maxLength={254} /></label><label>Display name<input name="displayName" maxLength={100} /></label><label>Role<select name="role" defaultValue="viewer"><option value="agency_admin">Agency admin</option><option value="operator">Operator</option><option value="creator">Creator</option><option value="viewer">Viewer</option></select></label><button className="primary" type="submit">Add or update</button></form>}
    </section>
    <div className="two-column identity-grid"><section className="panel"><h2>Chrome profiles</h2><p>Register a named Chrome profile, then assign it to exactly one account identity per platform.</p>
      {profiles.results.map((profile) => <article className="identity-row" key={profile.id}><div><strong>{profile.label}</strong><small>{profile.status}{profile.last_seen_at ? ` · seen ${profile.last_seen_at}` : " · not yet verified by extension"}</small></div></article>)}
      {canManage && <form action={registerBrowserProfileAction} className="inline-form"><label>Profile label<input name="label" required maxLength={80} placeholder={`${context.creator.creator_name} · Reddit`} /></label><label>Extension installation ID<input name="installationId" required maxLength={36} minLength={36} placeholder="Copy from the extension popup" /></label><button className="primary" type="submit">Register profile</button></form>}
    </section><section className="panel"><h2>Account pairing</h2><p>The assignment is the source of truth; a social handle alone never establishes identity.</p>
      {assignments.results.map((item) => <article className="identity-row" key={item.account_id}><div><strong>{item.platform} · {item.label}</strong><small>{item.credential_active ? "Active revocable credential" : item.verified_at ? "Extension verified · no active credential" : "Assigned · pairing verification pending"}</small></div>{canManage && item.credential_active ? <form action={revokeBridgeCredentialsAction}><input type="hidden" name="accountId" value={item.account_id} /><button className="secondary-action" type="submit">Revoke bridge</button></form> : null}</article>)}
      {canManage && <form action={assignBrowserProfileAction} className="inline-form"><label>Platform account<select name="accountId" required>{accounts.results.map((account) => <option value={account.id} key={account.id}>{account.platform} · {account.label} · {account.handle}</option>)}</select></label><label>Chrome profile<select name="profileId" required>{profiles.results.map((profile) => <option value={profile.id} key={profile.id}>{profile.label}</option>)}</select></label><button className="primary" type="submit" disabled={!accounts.results.length || !profiles.results.length}>Assign profile</button></form>}
    </section></div>
  </AppShell>;
}
