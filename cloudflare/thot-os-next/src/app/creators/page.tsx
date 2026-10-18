import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app-shell";
import { cloudflareEnv } from "@/lib/cloudflare";
import { creatorRoleLabel, requireCreatorContext } from "@/lib/identity";
import type { CreatorRole } from "@/lib/identity";
import { assignBrowserProfileAction, onboardCreatorWorkspaceAction, registerBrowserProfileAction, revokeBridgeCredentialsAction, saveCreatorMembershipAction, suspendCreatorMembershipAction, revokeCreatorInvitationAction, resendCreatorInvitationAction, switchCreatorAction } from "@/app/identity-actions";

type AdminCreator = { id: string; name: string; status: string; workflow_state: string; onboarding_updated_at: string | null; assets: number; active_memberships: number; accounts: number; platforms: string | null; profiles: number };
type Membership = { user_email: string; display_name: string; role: CreatorRole; status: string; created_at: string; updated_at: string };
type BrowserProfile = { id: string; label: string; status: string; last_seen_at: string | null; assigned_accounts: number; verified_accounts: number };
type Account = { id: string; platform: string; label: string; handle: string; connection_status: string; publishing_mode: string };
type Assignment = { account_id: string; platform: string; account_label: string; handle: string; profile_label: string; profile_status: string; verified_at: string | null; credential_id: string | null; credential_last_seen_at: string | null };
type AuditRow = { id: string; actor: string; actor_role: string; event_type: string; target: string; created_at: string; source: string };
type Invitation = { id: string; invited_email: string; status: string; expires_at: string; sent_at: string | null; created_at: string };

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default async function CreatorsPage({ searchParams }: { searchParams: Promise<{ creator?: string }> }) {
  const requestedCreatorId = (await searchParams).creator?.trim() || undefined;
  const context = await requireCreatorContext("manage_identity", requestedCreatorId);
  const creatorId = context.creator.creator_id;
  const { DB } = cloudflareEnv();
  const [creators, memberships, profiles, accounts, assignments, invitations, identityAudit, assetAudit, postAudit, communityAudit, vaultAudit, messagingAudit] = await Promise.all([
    DB.prepare(`SELECT c.id,c.name,c.status,COALESCE(cop.workflow_state,'draft') AS workflow_state,cop.updated_at AS onboarding_updated_at,
      COUNT(DISTINCT CASE WHEN a.source_available=1 THEN a.id END) AS assets,
      COUNT(DISTINCT CASE WHEN cm.status='active' THEN lower(cm.user_email) END) AS active_memberships,
      COUNT(DISTINCT oa.id) AS accounts,GROUP_CONCAT(DISTINCT oa.platform) AS platforms,
      COUNT(DISTINCT bp.id) AS profiles
      FROM creators c
      JOIN creator_memberships scope ON scope.creator_id=c.id
      LEFT JOIN assets a ON a.creator_id=c.id
      LEFT JOIN creator_memberships cm ON cm.creator_id=c.id
      LEFT JOIN operational_accounts oa ON oa.creator_id=c.id
      LEFT JOIN browser_profiles bp ON bp.creator_id=c.id AND bp.status<>'revoked'
      LEFT JOIN creator_onboarding_profiles cop ON cop.creator_id=c.id
      WHERE lower(scope.user_email)=? AND scope.status='active' AND scope.role='agency_admin'
      GROUP BY c.id,c.name,c.status,cop.workflow_state,cop.updated_at ORDER BY c.name`).bind(context.email).all<AdminCreator>(),
    DB.prepare(`SELECT m.user_email,u.display_name,m.role,m.status,m.created_at,m.updated_at
      FROM creator_memberships m JOIN users u ON lower(u.email)=lower(m.user_email)
      WHERE m.creator_id=? ORDER BY CASE m.status WHEN 'active' THEN 0 ELSE 1 END,u.display_name`).bind(creatorId).all<Membership>(),
    DB.prepare(`SELECT bp.id,bp.label,bp.status,bp.last_seen_at,COUNT(abp.account_id) AS assigned_accounts,
      SUM(CASE WHEN abp.verified_at IS NOT NULL THEN 1 ELSE 0 END) AS verified_accounts
      FROM browser_profiles bp LEFT JOIN account_browser_profiles abp ON abp.profile_id=bp.id AND abp.creator_id=bp.creator_id
      WHERE bp.creator_id=? AND bp.status<>'revoked' GROUP BY bp.id,bp.label,bp.status,bp.last_seen_at ORDER BY bp.label`).bind(creatorId).all<BrowserProfile>(),
    DB.prepare("SELECT id,platform,label,handle,connection_status,publishing_mode FROM operational_accounts WHERE creator_id=? ORDER BY platform,label").bind(creatorId).all<Account>(),
    DB.prepare(`SELECT abp.account_id,abp.platform,oa.label AS account_label,oa.handle,bp.label AS profile_label,bp.status AS profile_status,abp.verified_at,
      (SELECT bc.id FROM bridge_credentials bc WHERE bc.creator_id=abp.creator_id AND bc.account_id=abp.account_id AND bc.profile_id=abp.profile_id
        AND bc.status='active' AND bc.revoked_at IS NULL AND unixepoch(bc.expires_at)>unixepoch(CURRENT_TIMESTAMP)
        ORDER BY bc.created_at DESC,bc.id DESC LIMIT 1) AS credential_id,
      (SELECT MAX(bc.last_seen_at) FROM bridge_credentials bc WHERE bc.creator_id=abp.creator_id AND bc.account_id=abp.account_id AND bc.profile_id=abp.profile_id) AS credential_last_seen_at
      FROM account_browser_profiles abp
      JOIN browser_profiles bp ON bp.id=abp.profile_id AND bp.creator_id=abp.creator_id
      JOIN operational_accounts oa ON oa.id=abp.account_id AND oa.creator_id=abp.creator_id
      WHERE abp.creator_id=? ORDER BY abp.platform,oa.label`).bind(creatorId).all<Assignment>(),
    DB.prepare("SELECT id,invited_email,status,expires_at,sent_at,created_at FROM creator_invitations WHERE creator_id=? ORDER BY created_at DESC LIMIT 20").bind(creatorId).all<Invitation>(),
    DB.prepare("SELECT id,actor_email AS actor,actor_role,event_type,subject AS target,created_at,'identity' AS source FROM identity_audit_events WHERE creator_id=? ORDER BY created_at DESC LIMIT 40").bind(creatorId).all<AuditRow>(),
    DB.prepare("SELECT id,actor,actor_role,event_type,asset_id AS target,created_at,'asset' AS source FROM asset_classification_events WHERE creator_id=? ORDER BY created_at DESC LIMIT 20").bind(creatorId).all<AuditRow>(),
    DB.prepare("SELECT id,actor,actor_role,event_type,post_id AS target,created_at,'social post' AS source FROM social_post_events WHERE creator_id=? ORDER BY created_at DESC LIMIT 20").bind(creatorId).all<AuditRow>(),
    DB.prepare("SELECT id,actor,actor_role,event_type,CAST(community_id AS TEXT) AS target,created_at,'reddit community' AS source FROM reddit_community_events WHERE creator_id=? ORDER BY created_at DESC LIMIT 20").bind(creatorId).all<AuditRow>(),
    DB.prepare("SELECT id,actor,actor_role,event_type,job_id AS target,created_at,'vault' AS source FROM vault_upload_events WHERE creator_id=? ORDER BY created_at DESC LIMIT 20").bind(creatorId).all<AuditRow>(),
    DB.prepare("SELECT id,actor,actor_role,event_type,COALESCE(thread_id,connection_id,'workspace') AS target,created_at,'messaging' AS source FROM messaging_audit_events WHERE creator_id=? ORDER BY created_at DESC LIMIT 30").bind(creatorId).all<AuditRow>(),
  ]);
  const activity = [identityAudit, assetAudit, postAudit, communityAudit, vaultAudit, messagingAudit]
    .flatMap((result) => result.results)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 60);
  const selectedCreator = creators.results.find((creator) => creator.id === creatorId);
  if (!selectedCreator) throw new Error("The selected creator is outside this administrator scope.");
  const activeMemberships = memberships.results.filter((membership) => membership.status === "active");
  const activePlatforms = [...new Set(accounts.results.map((account) => account.platform))];
  const verifiedPairings = assignments.results.filter((assignment) => assignment.verified_at && assignment.credential_id).length;
  const onboardingReviews = creators.results.filter((creator) => creator.workflow_state === "creator_review" || creator.workflow_state === "admin_review");
  const saveMembership = saveCreatorMembershipAction.bind(null, creatorId);
  const suspendMembership = suspendCreatorMembershipAction.bind(null, creatorId);
  const registerProfile = registerBrowserProfileAction.bind(null, creatorId);
  const assignProfile = assignBrowserProfileAction.bind(null, creatorId);
  const revokeBridge = revokeBridgeCredentialsAction.bind(null, creatorId);

  return <AppShell active="Creators" creatorId={creatorId}>
    <PageHeader title="Agency administration" subtitle="Identity, access, device pairing and audit controls for creators you are explicitly authorized to administer." eyebrow="ADMINISTRATIVE CONTROL PLANE" />
    <section className="admin-context-banner">
      <div><small>SIGNED-IN IDENTITY</small><strong>{context.email}</strong><span>Agency administrator</span></div>
      <div><small>SELECTED CREATOR WORKSPACE</small><strong>{selectedCreator.name}</strong><span>{statusLabel(selectedCreator.status)} · administrative actions remain attributed to you</span></div>
      <span className="admin-context-mode">Administrative view only</span>
    </section>

    <section className="metric-grid admin-metrics">
      <article><b>{creators.results.length}</b><span>Authorized creators</span></article>
      <article><b>{activeMemberships.length}</b><span>Active memberships · {selectedCreator.name}</span></article>
      <article><b>{activePlatforms.length}</b><span>Connected platform types</span></article>
      <article><b>{verifiedPairings}</b><span>Verified active bridge pairings</span></article>
    </section>

    <section className="panel admin-section"><div className="section-heading"><div><h2>Onboarding reviews</h2><p>Creator submissions waiting for agency review appear here.</p></div><span>{onboardingReviews.length} waiting</span></div>
      {onboardingReviews.length ? onboardingReviews.map((creator) => <article className="identity-row admin-identity-row" key={creator.id}><div><strong>{creator.name}</strong><small>{statusLabel(creator.workflow_state)}{creator.onboarding_updated_at ? ` · submitted ${creator.onboarding_updated_at}` : ""}</small></div><form action={switchCreatorAction}><input name="creatorId" type="hidden" value={creator.id} /><input name="returnTo" type="hidden" value="/onboarding" /><button className="primary" type="submit">Review onboarding</button></form></article>) : <div className="empty"><b>No onboarding waiting</b><span>New creator submissions will appear here automatically.</span></div>}
    </section>

    <div className="admin-overview-grid">
      <section className="panel creator-portfolio"><div className="section-heading"><div><h2>Creator portfolio</h2><p>Only creators covered by your active agency-administrator memberships appear here.</p></div><span>{creators.results.length} authorized</span></div>
        {creators.results.map((creator) => <article className={creator.id === creatorId ? "selected" : ""} key={creator.id}>
          <span className="avatar">{creator.name.slice(0, 1)}</span><div><strong>{creator.name}</strong><small>{statusLabel(creator.status)} · {creator.assets} assets · {creator.active_memberships} active members</small><small>{creator.accounts} accounts · {creator.platforms?.split(",").join(" · ") || "no platforms"} · {creator.profiles} Chrome profiles</small></div>
          {creator.id === creatorId ? <span className="state">Selected</span> : <Link href={`/creators?creator=${encodeURIComponent(creator.id)}`}>Manage</Link>}
        </article>)}
      </section>
    </div>

    <section className="panel admin-section"><div className="section-heading"><div><h2>Onboard a canonical creator workspace</h2><p>Creates identity, one agency-administrator membership and an immutable receipt only. It does not import legacy data, create accounts or connect credentials.</p></div><span>Metadata only</span></div>
      <form action={onboardCreatorWorkspaceAction} className="inline-form admin-membership-form"><label>Canonical ID<input name="creatorId" required maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="thrill-noir" /></label><label>Creator name<input name="name" required maxLength={100} placeholder="THRILL NOIR" /></label><label>Initials<input name="initials" required maxLength={8} pattern="[A-Za-z0-9]+" placeholder="TN" /></label><label>Accent<input name="accent" defaultValue="#6f4df6" required pattern="#[a-fA-F0-9]{6}" /></label><label>Invitation email<input name="invitationEmail" type="email" required maxLength={254} /></label><input type="hidden" name="slug" value="" /><button className="primary" type="submit">Approve and invite</button></form>
    </section>

    <section className="panel admin-section"><div className="section-heading"><div><h2>{selectedCreator.name} invitations</h2><p>Only the hash is stored. Failed delivery leaves a pending invitation for replacement.</p></div><span>{invitations.results.length} recent</span></div>
      {invitations.results.map((invitation) => <article className="identity-row" key={invitation.id}><div><strong>{invitation.invited_email}</strong><small>{statusLabel(invitation.status)} · expires {invitation.expires_at}</small></div>{invitation.status === "pending" ? <div className="connection-row-actions"><form action={resendCreatorInvitationAction}><input type="hidden" name="invitationId" value={invitation.id} /><button className="secondary-action" type="submit">Replace and resend</button></form><form action={revokeCreatorInvitationAction} className="confirmed-action"><input type="hidden" name="invitationId" value={invitation.id} /><label><input type="checkbox" name="confirmation" value="revoke-invitation" required /> Confirm revocation</label><button className="danger-action" type="submit">Revoke</button></form></div> : null}</article>)}
    </section>

    <section className="panel admin-section"><div className="section-heading"><div><h2>{selectedCreator.name} memberships</h2><p>Cloudflare Access establishes identity. These creator-scoped memberships establish authorization.</p></div><span>Administrative action</span></div>
      {memberships.results.map((membership) => <article className="identity-row admin-identity-row" key={membership.user_email}><div><strong>{membership.display_name}</strong><small>{membership.user_email}</small><span>{creatorRoleLabel(membership.role)} · {statusLabel(membership.status)}</span></div>
        {membership.status === "active" && membership.user_email.toLowerCase() !== context.email ? <form action={suspendMembership} className="confirmed-action"><input type="hidden" name="email" value={membership.user_email} /><label><input type="checkbox" name="confirmation" value="suspend-membership" required /> Confirm suspension for this creator only</label><button className="danger-action" type="submit">Suspend membership</button></form> : null}
      </article>)}
      <form action={saveMembership} className="inline-form admin-membership-form"><div className="section-divider"><b>Add or update an approved membership</b><span>The administrator actor role is derived from your active membership, never from this form.</span></div><label>Email<input name="email" type="email" required maxLength={254} /></label><label>Display name<input name="displayName" maxLength={100} /></label><label>Approved role<select name="role" defaultValue="viewer"><option value="agency_admin">Agency administrator</option><option value="operator">Operator</option><option value="creator">Creator</option><option value="viewer">Viewer</option></select></label><button className="primary" type="submit">Save membership</button></form>
    </section>

    <div className="two-column identity-grid"><section className="panel"><div className="section-heading"><div><h2>Chrome profiles and extension status</h2><p>Installation identifiers remain hidden. Only creator-scoped status and activity are shown.</p></div><span>{profiles.results.length} profiles</span></div>
      {profiles.results.length ? profiles.results.map((profile) => <article className="identity-row" key={profile.id}><div><strong>{profile.label}</strong><small>{profile.status === "paired" ? "Extension paired" : "Extension registered"} · {profile.assigned_accounts} assignments · {profile.verified_accounts} verified</small><span>{profile.last_seen_at ? `Last seen ${profile.last_seen_at}` : "Extension has not checked in"}</span></div></article>) : <div className="empty"><b>No Chrome profiles</b><span>This empty creator has no device or platform authority.</span></div>}
      <form action={registerProfile} className="inline-form"><label>Profile label<input name="label" required maxLength={80} placeholder={`${selectedCreator.name} · Chrome`} /></label><label>Extension installation ID<input name="installationId" required maxLength={36} minLength={36} placeholder="Copy from the extension popup" autoComplete="off" /></label><button className="primary" type="submit">Register profile</button></form>
    </section><section className="panel"><div className="section-heading"><div><h2>Platform accounts and pairing</h2><p>A platform handle is descriptive only; verified profile assignment is the identity boundary.</p></div><span>{accounts.results.length} accounts</span></div>
      {accounts.results.map((account) => <article className="identity-row" key={account.id}><div><strong>{account.platform} · {account.label}</strong><small>{account.handle || "No public handle"} · {statusLabel(account.connection_status)} · {statusLabel(account.publishing_mode)}</small></div></article>)}
      {assignments.results.map((item) => <article className="identity-row pairing-row" key={item.account_id}><div><strong>{item.platform} · {item.account_label}</strong><small>{item.profile_label} · {item.profile_status}</small><span>{item.credential_id ? "Active revocable credential" : item.verified_at ? "Extension verified · no active credential" : "Pairing verification pending"}{item.credential_last_seen_at ? ` · last used ${item.credential_last_seen_at}` : ""}</span></div>{item.credential_id ? <form action={revokeBridge} className="confirmed-action"><input type="hidden" name="accountId" value={item.account_id} /><input type="hidden" name="credentialId" value={item.credential_id} /><label><input type="checkbox" name="confirmation" value="revoke-bridge" required /> Revoke this profile’s credential only</label><button className="danger-action" type="submit">Revoke bridge</button></form> : null}</article>)}
      <form action={assignProfile} className="inline-form"><label>Platform account<select name="accountId" required>{accounts.results.map((account) => <option value={account.id} key={account.id}>{account.platform} · {account.label} · {account.handle}</option>)}</select></label><label>Chrome profile<select name="profileId" required>{profiles.results.map((profile) => <option value={profile.id} key={profile.id}>{profile.label}</option>)}</select></label><button className="primary" type="submit" disabled={!accounts.results.length || !profiles.results.length}>Assign profile</button></form>
    </section></div>

    <section className="panel admin-section"><div className="section-heading"><div><h2>Creator-scoped operational activity and audit history</h2><p>Administrative and selected-workspace actions are shown together with actor identity and immutable role-at-time provenance.</p></div><span>{activity.length} recent events</span></div>
      {activity.length ? <div className="admin-audit-list">{activity.map((event) => <article key={`${event.source}-${event.id}`}><span className="post-state">{event.source}</span><div><strong>{statusLabel(event.event_type)}</strong><small>{event.actor} · {statusLabel(event.actor_role)} · target {event.target}</small></div><time>{event.created_at}</time></article>)}</div> : <div className="empty"><b>No creator activity</b><span>This workspace has no operational or administrative audit history yet.</span></div>}
    </section>
  </AppShell>;
}
