import { redirect } from "next/navigation";
import {
  confirmComposioIdentityAction,
  confirmLocalPlatformIdentityAction,
  confirmServiceIdentityAction,
  createAccountAction,
  disconnectCreatorServiceAction,
  disconnectPlatformAction,
  openLocalPlatformAction,
  saveCreatorLoginProfileAction,
  setConnectionPublishingAuthorityAction,
  verifyXQuikConnectionAction,
} from "@/app/actions";
import { saveCreatorMediaSourceAction } from "@/app/media-actions";
import { checkTelegramPairingAction, confirmTelegramPairingAction, createTelegramPairingLinkAction, revokeTelegramPairingAction } from "@/app/telegram-actions";
import { AppShell } from "@/components/app-shell";
import { getActiveCreator } from "@/lib/current-creator";
import {
  getAccounts,
  getActiveTelegramPairingInvite,
  getAgencyIntegration,
  getCreatorLoginProfile,
  getCreatorServiceConnections,
  getLatestComposioLinkRequests,
  getLatestServiceLinkRequests,
  getLocalBridgeConnections,
  getPlatformConnections,
  getTelegramCreatorPairing,
} from "@/lib/db";
import { getComposioConfiguration } from "@/lib/integrations/composio";
import { getXQuikConfiguration } from "@/lib/integrations/xquik";
import { getAvailableCreatorMediaSources, getCreatorMediaRoot } from "@/lib/media-sources";

export const dynamic = "force-dynamic";

const messages: Record<string, string> = {
  invalid_composio_account: "Choose an Instagram destination from this creator profile.",
  composio_not_configured: "Add the Composio project settings before connecting an account.",
  composio_link_failed: "THOT OS could not create the Composio authorization link.",
  composio_callback_failed: "Composio returned, but THOT OS could not verify the connected identity.",
  invalid_composio_service: "Choose a supported creator service.",
  composio_service_link_failed: "THOT OS could not create the service authorization link.",
  composio_service_callback_failed: "The service returned, but THOT OS could not verify its identity.",
};

function normaliseUsername(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

export default async function CreatorProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ creatorId: string }>;
  searchParams: Promise<{ error?: string; connected?: string; telegramPairing?: string }>;
}) {
  const { creatorId } = await params;
  const creator = await getActiveCreator();
  if (creator.id !== creatorId) redirect("/creators");
  const query = await searchParams;
  const accounts = getAccounts(creator.id);
  const loginProfile = getCreatorLoginProfile(creator.id);
  const connections = getPlatformConnections(creator.id);
  const pendingRequests = getLatestComposioLinkRequests(creator.id);
  const serviceConnections = getCreatorServiceConnections(creator.id);
  const serviceRequests = getLatestServiceLinkRequests(creator.id);
  const telegramPairing = getTelegramCreatorPairing(creator.id);
  const agencyTelegram = getAgencyIntegration("telegram");
  const telegramInvite = getActiveTelegramPairingInvite(creator.id);
  const composio = getComposioConfiguration();
  const xquik = getXQuikConfiguration();
  const mediaSources = getAvailableCreatorMediaSources();
  const localBridgeConnections = getLocalBridgeConnections(creator.id);

  return (
    <AppShell active="Accounts & connections">
      <section className="workspace library-workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{creator.name.toUpperCase()} · PRIVATE CREATOR PROFILE</span>
            <h1>{creator.name} accounts & connections</h1>
            <p className="page-subtitle">Add each destination, connect its verified identity and keep publishing authority separate.</p>
          </div>
        </header>

        {query.error && <div className="connection-alert error">{messages[query.error] ?? "The connection could not be completed."}</div>}
        {query.connected && <div className="connection-alert success">The account returned successfully. Confirm the verified identity below before assigning it.</div>}
        {query.telegramPairing === "waiting" && <div className="connection-alert error">No matching Start message yet. Ask the creator to open the current pairing link and press Start, then check again.</div>}
        {query.telegramPairing === "paired" && <div className="connection-alert success">Telegram chat paired successfully. No message was sent.</div>}

        <div className="creator-profile-grid">
          <section className="panel creator-identity-panel">
            <div className="panel-heading"><div><h2>Dedicated creator Chrome profile</h2><p>One persistent, isolated browser profile for this creator&apos;s platform sessions.</p></div><b>{loginProfile?.google_email ? "Recorded" : "Add profile"}</b></div>
            <form action={saveCreatorLoginProfileAction} className="creator-identity-form">
              <label>Google account email<input name="googleEmail" type="email" defaultValue={loginProfile?.google_email ?? ""} placeholder={`${creator.slug}@gmail.com`} /></label>
              <label>Chrome profile name<input name="chromeProfileLabel" defaultValue={loginProfile?.chrome_profile_label ?? ""} placeholder={`${creator.name} profile`} /></label>
              <label className="wide">Operational note<textarea name="notes" defaultValue={loginProfile?.notes ?? ""} placeholder="Which browser profile to open. Never enter passwords or recovery codes." /></label>
              <p className="identity-guardrail">This is an identity reminder only. THOT OS never stores the Google password, cookies, 2FA codes or recovery details.</p>
              <button className="primary-button">Save profile context</button>
            </form>
          </section>

          <aside className="panel composio-status-panel">
            <div className="panel-heading"><div><h2>Composio delivery</h2><p>Managed OAuth and platform tools</p></div><b className={composio.ready ? "ready" : ""}>{composio.ready ? "Ready" : "Needs setup"}</b></div>
            <div className="config-checks three">
              <span className={composio.checks.apiKey ? "done" : ""}>Project key</span>
              <span className={composio.checks.instagramAuthConfig ? "done" : ""}>Instagram auth</span>
              <span className={composio.checks.stateSecret ? "done" : ""}>OAuth protection</span>
            </div>
            <p>Connections remain private to this THOT OS destination. Connecting never enables publishing automatically.</p>
          </aside>
        </div>

        <section className="panel media-source-panel">
          <div className="panel-heading">
            <div><h2>Dropbox media folder</h2><p>Choose one creator folder. STILLS, VIDEO and every nested campaign folder remain visible and read-only.</p></div>
            <b>{creator.media_source ? "Selected" : "Choose folder"}</b>
          </div>
          <form action={saveCreatorMediaSourceAction} className="media-source-form">
            <label>Creator folder
              <select name="mediaSource" defaultValue={creator.media_source ?? ""} required>
                <option value="" disabled>Select a folder inside # Creator OS</option>
                {mediaSources.map((source) => <option value={source.absolutePath} key={source.absolutePath}>{source.name} · {source.mediaCount} media files</option>)}
              </select>
            </label>
            <button className="primary-button">Save folder</button>
          </form>
          <div className="media-source-details">
            <span>Approved root</span><code>{getCreatorMediaRoot()}</code>
            {mediaSources.map((source) => <article className={creator.media_source === source.absolutePath ? "active" : ""} key={source.absolutePath}><strong>{source.name}</strong><span>{source.subfolders.length ? source.subfolders.join(" · ") : "No subfolders yet"}</span><b>{source.mediaCount} files</b></article>)}
          </div>
          <p className="identity-guardrail media-source-note">Saving a folder does not move, rename, delete or index anything. Indexing stays a separate read-only action.</p>
        </section>

        <section className="panel setup-form-panel destination-setup-panel" id="destination-setup">
          <div className="panel-heading"><div><h2>Add a platform account</h2><p>Add the expected public identity first. Instagram OAuth appears on the account immediately afterward.</p></div></div>
          <form action={createAccountAction} className="setup-grid">
            <label>Account label<input name="label" required placeholder={`${creator.name} main`} /></label>
            <label>Platform<select name="platform" defaultValue="instagram"><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="threads">Threads</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="x">X</option><option value="reddit">Reddit</option><option value="myroomz">MyRoomz</option><option value="onlyfans">OnlyFans</option><option value="fansly">Fansly</option><option value="other">Other</option></select></label>
            <label>Public handle<input name="handle" required placeholder="@handle" /></label>
            <label>Profile URL<input name="url" type="url" required placeholder="https://…" /></label>
            <label>Purpose<select name="category"><option value="public_promotion">Public promotion</option><option value="paid_platform">Paid platform</option></select></label>
            <label>Publishing workflow<select name="publishingMode"><option value="manual_handoff">Finish on device</option><option value="desktop_manual">Desktop manual</option><option value="api">API when connected</option></select></label>
            <button className="primary-button">Add account</button>
          </form>
        </section>

        <section className="panel premium-platform-panel">
          <div className="panel-heading"><div><h2>Secure OnlyFans and Fansly sign-in</h2><p>Open THOT OS inside this creator&apos;s Chrome profile first. Platform buttons continue in that same profile; passwords and 2FA stay in the native platform.</p></div><b>Local only</b></div>
          <div className="premium-platform-list">
            {accounts.filter((account) => account.platform === "onlyfans" || account.platform === "fansly").map((account) => {
              const bridge = localBridgeConnections.find((item) => item.account_id === account.id);
              const ready = bridge?.status === "ready_for_private_validation";
              return <article key={account.id}>
                <div className={`account-logo ${account.platform}`}>{account.platform === "onlyfans" ? "OF" : "FA"}</div>
                <div className="premium-platform-copy">
                  <span>{account.platform}</span><strong>{account.label}</strong><small>Expected identity: {account.handle}</small>
                  <em className={`connection-health ${ready ? "healthy" : bridge ? "warning" : ""}`}>{ready ? "Identity confirmed · private validation next" : bridge ? "Login window opened · confirm identity" : "Not started"}</em>
                </div>
                <div className="premium-platform-actions">
                  <form action={openLocalPlatformAction}>
                    <input type="hidden" name="accountId" value={account.id} /><input type="hidden" name="destination" value={ready ? (account.platform === "fansly" ? "vault" : "inbox") : "login"} />
                    <button className="primary-button">{ready ? (account.platform === "fansly" ? "Pair bridge and open vault" : "Pair bridge and open inbox") : "Open secure sign-in"}</button>
                  </form>
                  {ready && <form action={openLocalPlatformAction}>
                    <input type="hidden" name="accountId" value={account.id} /><input type="hidden" name="destination" value="earnings" />
                    <button className="handoff-button">Open earnings</button>
                  </form>}
                </div>
                {bridge && !ready && <form action={confirmLocalPlatformIdentityAction} className="premium-identity-confirm">
                  <input type="hidden" name="accountId" value={account.id} />
                  <label>Username visible after sign-in<input name="observedUsername" defaultValue={account.handle} required /></label>
                  <label className="premium-confirm-check"><input type="checkbox" name="identityConfirmed" value="yes" required /> I confirm this native account belongs to {creator.name}</label>
                  <button className="handoff-button">Confirm signed-in identity</button>
                </form>}
              </article>;
            })}
            {accounts.every((account) => account.platform !== "onlyfans" && account.platform !== "fansly") && <div className="mini-empty">Add an OnlyFans or Fansly destination above to create its isolated bridge profile.</div>}
          </div>
          <p className="identity-guardrail premium-platform-note">Sign in to both native platforms first. THOT OS stores the configured profile label and verified handles only. Add the bridge extension once to each creator profile; platform buttons never launch a guest or separate automation profile.</p>
        </section>

        <section className="panel creator-connected-accounts">
          <div className="panel-heading"><div><h2>Connected accounts</h2><p>{accounts.length} configured destinations · multiple accounts per platform supported</p></div></div>
          <div className="creator-account-list">
            {accounts.map((account) => {
              const composioProvider = `composio_${account.platform}`;
              const connectionProvider = account.platform === "x" ? "xquik_x" : composioProvider;
              const connection = connections.find((item) => item.account_id === account.id && item.provider === connectionProvider);
              const pending = pendingRequests.find((item) => item.account_id === account.id && item.provider === composioProvider);
              const identityMatches = pending?.discovered_username
                ? normaliseUsername(pending.discovered_username) === normaliseUsername(account.handle)
                : false;
              return (
                <article key={account.id} className="creator-account-row">
                  <div className={`account-logo ${account.platform}`}>{account.platform.slice(0, 2).toUpperCase()}</div>
                  <div className="creator-account-copy">
                    <span>{account.platform} · {account.category.replaceAll("_", " ")}</span>
                    <strong>{account.label}</strong>
                    <small>Expected identity: {account.handle}</small>
                    {loginProfile?.chrome_profile_label && <em>Open in: {loginProfile.chrome_profile_label}</em>}
                  </div>

                  {connection ? (
                    <div className="verified-connection-card">
                      <strong>Verified @{connection.external_username}</strong>
                      <span>Identity confirmed {connection.identity_confirmed_at ? "✓" : "pending"}</span>
                      <span>Publishing {connection.publishing_authorized_at ? "allowed after post approval" : "locked"}</span>
                      <div className="connection-row-actions">
                        <form action={setConnectionPublishingAuthorityAction}>
                          <input type="hidden" name="connectionId" value={connection.id} />
                          <input type="hidden" name="allowed" value={connection.publishing_authorized_at ? "no" : "yes"} />
                          <button className={connection.publishing_authorized_at ? "handoff-button" : "primary-button"}>{connection.publishing_authorized_at ? "Lock publishing" : "Allow approved publishing"}</button>
                        </form>
                        <form action={disconnectPlatformAction}>
                          <input type="hidden" name="accountId" value={account.id} />
                          <input type="hidden" name="provider" value={connectionProvider} />
                          <button className="handoff-button">Disconnect locally</button>
                        </form>
                      </div>
                    </div>
                  ) : pending?.status === "awaiting_identity_confirmation" ? (
                    <form action={confirmComposioIdentityAction} className={`identity-confirm-card ${identityMatches ? "match" : "mismatch"}`}>
                      <input type="hidden" name="requestId" value={pending.id} />
                      <strong>Composio returned @{pending.discovered_username}</strong>
                      <span>{identityMatches ? "Username matches this destination." : `Mismatch: expected ${account.handle}. Do not confirm.`}</span>
                      <label><input type="checkbox" name="identityConfirmed" value="yes" disabled={!identityMatches} /> I confirm this account belongs to {creator.name}</label>
                      <button className="primary-button" disabled={!identityMatches}>Assign verified account</button>
                    </form>
                  ) : account.platform === "instagram" && composio.ready ? (
                    <a className="primary-button button-link" href={`/api/connections/composio/start?accountId=${encodeURIComponent(account.id)}`}>Connect with Composio</a>
                  ) : account.platform === "instagram" ? (
                    <span className="connection-disabled">Configure Composio first</span>
                  ) : account.platform === "x" && xquik.ready ? (
                    <form action={verifyXQuikConnectionAction}><input type="hidden" name="accountId" value={account.id} /><button className="primary-button">Verify XQuik account</button></form>
                  ) : account.platform === "x" ? (
                    <span className="connection-disabled">Add the private XQuik API key first</span>
                  ) : account.platform === "onlyfans" || account.platform === "fansly" ? (
                    <span className="connection-disabled">Managed by local bridge above</span>
                  ) : (
                    <span className="connection-disabled">Composio adapter coming next</span>
                  )}
                </article>
              );
            })}
            {accounts.length === 0 && <div className="empty-state"><h2>No destinations yet</h2><p>Add the creator&apos;s public accounts before connecting OAuth.</p></div>}
          </div>
        </section>

        <section className="panel agency-telegram-panel" id="telegram-mobile">
          <div className="panel-heading"><div><h2>Telegram mobile connection</h2><p>One agency bot, with a separate private chat pairing for each creator.</p></div><b className={agencyTelegram ? "ready" : ""}>{agencyTelegram ? "Agency bot connected" : "Agency bot missing"}</b></div>
          <div className="agency-bot-summary">
            <div className="account-logo telegram">TG</div>
            <div><span>AGENCY BOT</span><strong>{agencyTelegram?.display_name || "Connect the THOT OS bot"}</strong><small>The bot belongs to the agency. The creator only opens a private one-time pairing link.</small></div>
          </div>
          {telegramPairing ? (
            <div className="telegram-pairing-state connected">
              <div><span>PAIRED CREATOR CHAT</span><strong>{telegramPairing.telegram_username ? `@${telegramPairing.telegram_username}` : telegramPairing.display_name}</strong><small>Paired {telegramPairing.paired_at} · messages still require THOT OS approval</small></div>
              <form action={revokeTelegramPairingAction}><button className="handoff-button">Revoke pairing</button></form>
            </div>
          ) : telegramInvite?.status === "awaiting_confirmation" ? (
            <form action={confirmTelegramPairingAction} className="telegram-pairing-state candidate">
              <input type="hidden" name="inviteId" value={telegramInvite.id} />
              <div><span>IDENTITY RETURNED — CONFIRM BEFORE PAIRING</span><strong>{telegramInvite.candidate_username ? `@${telegramInvite.candidate_username}` : telegramInvite.candidate_display_name}</strong><small>{telegramInvite.candidate_display_name} · Telegram user ID {telegramInvite.candidate_user_id}</small><label><input type="checkbox" name="identityConfirmed" value="yes" required /> I confirm this is {creator.name}</label></div>
              <button className="primary-button">Pair this chat</button>
            </form>
          ) : telegramInvite ? (
            <div className="telegram-invite-box">
              <div><span>REMOTE PAIRING LINK · EXPIRES {telegramInvite.expires_at}</span><a href={`https://t.me/${agencyTelegram?.display_name.replace(/^@/,"")}?start=cos_${telegramInvite.token}`} target="_blank" rel="noreferrer">{`https://t.me/${agencyTelegram?.display_name.replace(/^@/,"")}?start=cos_${telegramInvite.token}`}</a><small>Send this only to {creator.name}. They open it and press Start.</small></div>
              <div className="connection-row-actions"><form action={checkTelegramPairingAction}><button className="primary-button">Check for Start</button></form><form action={createTelegramPairingLinkAction}><button className="handoff-button">Replace link</button></form></div>
            </div>
          ) : agencyTelegram ? (
            <form action={createTelegramPairingLinkAction} className="telegram-create-pairing"><p>Create a private, single-use link that can be sent to {creator.name} remotely.</p><button className="primary-button">Create pairing link</button></form>
          ) : <p className="identity-guardrail telegram-missing">The existing brand bot could not be migrated. Reconnect it once at agency level.</p>}
        </section>

        <section className="panel creator-connected-accounts">
          <div className="panel-heading"><div><h2>Creator services</h2><p>Private operational connections; these are not publishing destinations.</p></div></div>
          <div className="creator-account-list">
            {([
              {
                service: "dropbox" as const,
                badge: "DB",
                label: "Dropbox",
                type: "Media source · read workflow",
                description: "THOT OS indexes files and requests temporary links; it does not rename, move, delete or edit media.",
                connectedLabel: "Read-only THOT OS workflow",
                authConfigId: composio.dropboxAuthConfigId,
              },
              {
                service: "reddit" as const,
                badge: "RE",
                label: "Reddit",
                type: "Creator identity · posting locked",
                description: "Verifies the creator account. Posting remains approval-gated and subreddit rules are checked separately.",
                connectedLabel: "Identity connected · posting locked",
                authConfigId: composio.redditAuthConfigId,
              },
              {
                service: "youtube" as const,
                badge: "YT",
                label: "YouTube",
                type: "Creator channel · publishing locked",
                description: "Verifies the creator's YouTube channel. Uploading remains disabled until a publishing workflow is approved.",
                connectedLabel: "Channel connected · publishing locked",
                authConfigId: composio.youtubeAuthConfigId,
              },
            ]).map(({ service, badge, label, type, description, connectedLabel, authConfigId }) => {
              const connection = serviceConnections.find((item) => item.service === service);
              const pending = serviceRequests.find((item) => item.service === service);
              return (
                <article className="creator-account-row" key={service}>
                  <div className={`account-logo ${service}`}>{badge}</div>
                  <div className="creator-account-copy">
                    <span>{type}</span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </div>
                  {connection ? (
                    <div className="verified-connection-card">
                      <strong>{connection.display_name || `${label} account`}</strong>
                      <span>{connection.email || "Identity confirmed"}</span>
                      <span>{connectedLabel}</span>
                      <div className="connection-row-actions">
                        <form action={disconnectCreatorServiceAction}>
                          <input type="hidden" name="service" value={service} />
                          <button className="handoff-button">Disconnect locally</button>
                        </form>
                      </div>
                    </div>
                  ) : pending?.status === "awaiting_identity_confirmation" ? (
                    <form action={confirmServiceIdentityAction} className="identity-confirm-card match">
                      <input type="hidden" name="requestId" value={pending.id} />
                      <strong>{label} returned {pending.discovered_name || "an account"}</strong>
                      <span>{pending.discovered_email || "Review the account before assigning it."}</span>
                      <label><input type="checkbox" name="identityConfirmed" value="yes" /> I confirm this {label} belongs to {creator.name}</label>
                      <button className="primary-button">Assign {label}</button>
                    </form>
                  ) : authConfigId ? (
                    <a className="primary-button button-link" href={`/api/connections/composio/service/start?service=${service}`}>Connect {label}</a>
                  ) : (
                    <span className="connection-disabled">Configure {label} Auth first</span>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </AppShell>
  );
}
