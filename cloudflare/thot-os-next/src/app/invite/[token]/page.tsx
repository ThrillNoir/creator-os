import { cloudflareEnv } from "@/lib/cloudflare";
import { claimCreatorInvitationAction } from "@/app/identity-actions";

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default async function InvitationClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const invitation = /^[a-f0-9]{64}$/.test(token)
    ? await cloudflareEnv().DB.prepare("SELECT invited_email,expires_at FROM creator_invitations WHERE token_hash=? AND status='pending' AND unixepoch(expires_at)>unixepoch(CURRENT_TIMESTAMP)").bind(await hashToken(token)).first<{ invited_email: string; expires_at: string }>()
    : null;
  return <main className="workspace"><section className="panel admin-section"><span className="eyebrow">CREATOR INVITATION</span><h1>Claim your THOT OS workspace</h1>{invitation ? <><p>This invitation is for <strong>{invitation.invited_email}</strong>. Cloudflare Access will verify that you are the invited person.</p><form action={claimCreatorInvitationAction}><input type="hidden" name="token" value={token} /><button className="primary" type="submit">Claim workspace</button></form></> : <p>This invitation is invalid, expired, revoked, or already accepted.</p>}</section></main>;
}
