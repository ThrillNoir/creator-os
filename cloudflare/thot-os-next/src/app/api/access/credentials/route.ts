import { cookies } from "next/headers";
import { cloudflareEnv } from "@/lib/cloudflare";
import { isSameOriginRequest } from "@/lib/audit-identity";
import { requireCreatorContext } from "@/lib/identity";
import { STEP_UP_COOKIE, decryptCredentialPassword, encryptCredentialPassword, noStoreJson, requireStepUpSession, savePinVerifier, validatePin, verifyPinAndCreateSession } from "@/lib/access-vault";

type Credential = { id: string; creator_id: string; account_id: string | null; shared_with_creator: number; status: string; wrapped_dek: ArrayBuffer; wrapped_dek_nonce: ArrayBuffer; ciphertext: ArrayBuffer; ciphertext_nonce: ArrayBuffer; key_version: number };
const groups = new Set(["social", "paid", "chrome", "other"]);

function text(value: unknown, maximum: number) { return String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, maximum); }
function password(value: unknown) { const result = String(value ?? ""); if (!result || result.length > 512) throw new Error("Enter the platform password."); return result; }
function responseError(error: unknown) { return noStoreJson({ error: error instanceof Error ? error.message : "Access vault request failed." }, 400); }

async function accessContext() {
  const context = await requireCreatorContext("view");
  if (context.creator.role !== "agency_admin" && context.creator.role !== "creator") throw new Error("This role cannot use Access.");
  return context;
}

async function audit(creatorId: string, email: string, role: string, event: string, subject: string, detail: Record<string, unknown> = {}) {
  await cloudflareEnv().DB.prepare(`INSERT INTO creator_access_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail)
    VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), creatorId, email, role, event, subject, JSON.stringify(detail)).run();
}

async function availableCredential(context: Awaited<ReturnType<typeof accessContext>>, id: string) {
  const row = await cloudflareEnv().DB.prepare(`SELECT id,creator_id,account_id,shared_with_creator,status,wrapped_dek,wrapped_dek_nonce,ciphertext,ciphertext_nonce,key_version
    FROM vault_credentials WHERE id=? AND creator_id=?`).bind(id, context.creator.creator_id).first<Credential>();
  if (!row || row.status !== "active" || (context.creator.role === "creator" && !row.shared_with_creator)) throw new Error("That credential is not available in this workspace.");
  return row;
}

async function verifyStepUp(context: Awaited<ReturnType<typeof accessContext>>, pin: unknown) {
  try {
    const result = await verifyPinAndCreateSession({ email: context.email, creatorId: context.creator.creator_id, role: context.creator.role, pin: validatePin(pin) });
    await audit(context.creator.creator_id, context.email, context.creator.role, "access_pin_verified", "step_up", { pinScope: result.scope });
    return result;
  } catch (error) {
    // The attempted PIN and verifier state are intentionally absent from the
    // event. This records both ordinary failures and lockout checks safely.
    await audit(context.creator.creator_id, context.email, context.creator.role, "access_pin_verification_failed", "step_up", {});
    throw error;
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return noStoreJson({ error: "Same-origin request required." }, 403);
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = text(body.action, 40);
    const context = await accessContext();
    const creatorId = context.creator.creator_id;
    const DB = cloudflareEnv().DB;

    if (action === "setup_pin") {
      const scope = await savePinVerifier({ email: context.email, creatorId, role: context.creator.role, pin: validatePin(body.pin) });
      await audit(creatorId, context.email, context.creator.role, "access_pin_setup", "pin", { pinScope: scope });
      return noStoreJson({ ok: true });
    }

    if (action === "step_up") {
      const stepUp = await verifyStepUp(context, body.pin);
      const cookieStore = await cookies();
      cookieStore.set(STEP_UP_COOKIE, stepUp.sessionId, { httpOnly: true, secure: process.env.NODE_ENV !== "development", sameSite: "strict", path: "/", maxAge: 5 * 60 });
      return noStoreJson({ ok: true });
    }

    if (action === "reveal" || action === "copy") {
      const credential = await availableCredential(context, text(body.credentialId, 80));
      const stepUp = await verifyStepUp(context, body.pin);
      const cookieStore = await cookies();
      cookieStore.set(STEP_UP_COOKIE, stepUp.sessionId, { httpOnly: true, secure: process.env.NODE_ENV !== "development", sameSite: "strict", path: "/", maxAge: 5 * 60 });
      const response = noStoreJson({ password: await decryptCredentialPassword(credential) });
      response.headers.set("Cache-Control", "no-store, private");
      await audit(creatorId, context.email, context.creator.role, action === "copy" ? "credential_password_copied" : "credential_password_revealed", credential.id, { pinScope: stepUp.scope });
      return response;
    }

    const cookieStore = await cookies();
    // Sensitive mutations accept a freshly confirmed PIN or an unexpired
    // server-side step-up session. The browser never supplies a role or scope.
    const freshStepUp = body.pin ? await verifyStepUp(context, body.pin) : null;
    const existingSession = freshStepUp ?? await requireStepUpSession({ sessionId: cookieStore.get(STEP_UP_COOKIE)?.value, email: context.email, creatorId, role: context.creator.role });
    const pinScope = "scope" in existingSession ? existingSession.scope : existingSession.pin_scope;

    if (action === "create") {
      const accountId = text(body.accountId, 160) || null;
      const group = text(body.group, 20);
      const label = text(body.label, 100);
      if (!label) throw new Error("Enter a credential label.");
      if (!groups.has(group)) throw new Error("Choose a credential group.");
      if (context.creator.role === "creator" && !accountId) throw new Error("Choose an account in your workspace.");
      if (accountId) {
        const account = await DB.prepare("SELECT id FROM operational_accounts WHERE id=? AND creator_id=?").bind(accountId, creatorId).first<{ id: string }>();
        if (!account) throw new Error("Choose an account in this creator workspace.");
      }
      const id = crypto.randomUUID();
      const encrypted = await encryptCredentialPassword({ creatorId, credentialId: id, accountId, password: password(body.password) });
      await DB.prepare(`INSERT INTO vault_credentials (id,creator_id,account_id,credential_group,label,username,login_email,wrapped_dek,wrapped_dek_nonce,ciphertext,ciphertext_nonce,key_version,created_by,shared_with_creator,notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, creatorId, accountId, group, label, text(body.username, 254), text(body.loginEmail, 254).toLowerCase(), encrypted.wrappedDek, encrypted.wrappedDekNonce, encrypted.ciphertext, encrypted.ciphertextNonce, encrypted.keyVersion, context.email, context.creator.role === "creator" ? 1 : (body.sharedWithCreator ? 1 : 0), context.creator.role === "creator" ? "" : text(body.notes, 2000)).run();
      await audit(creatorId, context.email, context.creator.role, "credential_created", id, { group, sharedWithCreator: context.creator.role === "creator" ? true : Boolean(body.sharedWithCreator), pinScope });
      return noStoreJson({ ok: true, id, notice: "Login details saved securely." });
    }

    const credential = await availableCredential(context, text(body.credentialId, 80));
    if (action === "replace") {
      const encrypted = await encryptCredentialPassword({ creatorId, credentialId: credential.id, accountId: credential.account_id, password: password(body.password) });
      await DB.prepare(`UPDATE vault_credentials SET wrapped_dek=?,wrapped_dek_nonce=?,ciphertext=?,ciphertext_nonce=?,key_version=?,updated_at=CURRENT_TIMESTAMP,last_native_password_confirmation_at=NULL
        WHERE id=? AND creator_id=? AND status='active'`).bind(encrypted.wrappedDek, encrypted.wrappedDekNonce, encrypted.ciphertext, encrypted.ciphertextNonce, encrypted.keyVersion, credential.id, creatorId).run();
      await audit(creatorId, context.email, context.creator.role, "credential_password_replaced", credential.id, { nativePasswordChanged: false, pinScope });
      return noStoreJson({ ok: true, notice: "Stored password replaced. Update the native platform separately, then confirm it here." });
    }
    if (action === "confirm_native") {
      await DB.prepare("UPDATE vault_credentials SET last_native_password_confirmation_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='active'").bind(credential.id, creatorId).run();
      await audit(creatorId, context.email, context.creator.role, "credential_native_password_confirmed", credential.id, { pinScope });
      return noStoreJson({ ok: true });
    }
    if (action === "revoke") {
      if (context.creator.role !== "agency_admin") throw new Error("Only agency administrators can revoke credentials.");
      await DB.prepare("UPDATE vault_credentials SET status='revoked',revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(credential.id, creatorId).run();
      await audit(creatorId, context.email, context.creator.role, "credential_revoked", credential.id, { pinScope });
      return noStoreJson({ ok: true });
    }
    if (action === "visibility") {
      if (context.creator.role !== "agency_admin") throw new Error("Only agency administrators can change creator visibility.");
      await DB.prepare("UPDATE vault_credentials SET shared_with_creator=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='active'").bind(body.sharedWithCreator ? 1 : 0, credential.id, creatorId).run();
      await audit(creatorId, context.email, context.creator.role, "credential_visibility_changed", credential.id, { sharedWithCreator: Boolean(body.sharedWithCreator), pinScope });
      return noStoreJson({ ok: true });
    }
    throw new Error("Unsupported Access request.");
  } catch (error) { return responseError(error); }
}
