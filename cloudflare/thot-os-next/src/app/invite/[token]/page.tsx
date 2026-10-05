import { cloudflareEnv } from "@/lib/cloudflare";
import { verifyAccessIdentity } from "@/lib/access";
import { claimCreatorInvitationAction } from "@/app/identity-actions";

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default async function InvitationClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const identity = await verifyAccessIdentity();
  const token = (await params).token;
  const invitation = /^[a-f0-9]{64}$/.test(token)
    ? await cloudflareEnv().DB.prepare("SELECT i.invited_email,i.expires_at FROM creator_invitations i JOIN creators c ON c.id=i.creator_id AND c.status='active' WHERE i.token_hash=? AND i.status='pending' AND unixepoch(i.expires_at)>unixepoch(CURRENT_TIMESTAMP)").bind(await hashToken(token)).first<{ invited_email: string; expires_at: string }>()
    : null;
  const mayClaim = invitation?.invited_email.toLowerCase() === identity.email.toLowerCase();
  return <main className="workspace"><section className="panel admin-section"><span className="eyebrow">CREATOR INVITATION</span><h1>Claim your THOT OS workspace</h1>{mayClaim ? <><p>This invitation is for <strong>{invitation.invited_email}</strong>.</p><form action={claimCreatorInvitationAction}><input type="hidden" name="token" value={token} /><button className="primary" type="submit">Claim workspace</button></form></> : <p>This invitation is unavailable for the signed-in identity.</p>}</section></main>;
}
