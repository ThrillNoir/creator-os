# Creator OS API connections

## Safety boundary

API connection and API publishing are separate capabilities.

- OAuth proves which creator account granted access.
- Tokens are encrypted with AES-256-GCM before entering SQLite.
- App secrets and encryption keys stay in `.env.local`, which is ignored by Git.
- OAuth state is signed, bound to the selected creator/account, bound to the browser, and expires after ten minutes.
- Connecting an account does not publish anything.
- Every post remains bound to its media, copy, destination, schedule, and human approval.
- A live publishing test must use an explicitly approved test package.

## Instagram first

Creator OS uses the Instagram professional-account authorization flow. Configure the exact callback URI and requested permissions displayed on `/connections` in the Meta developer dashboard.

The current requested capabilities are:

- Basic professional account identity.
- Content publishing.

The API version is configurable with `META_GRAPH_VERSION` because Meta versions and permission requirements change. Confirm the version and permissions shown in the live developer dashboard before authorizing.

## Creator profiles and Composio

Each creator has a private access page at `/creators/[creatorId]`. Use it to:

- Record the dedicated Google email and Chrome profile label used for that creator. This is an operational reminder only; passwords, cookies, 2FA codes and recovery codes must never be stored in Creator OS.
- Connect each Instagram destination through the agency's Composio project.
- Compare the identity returned by Instagram with the handle already assigned to the destination.
- Confirm the match before assigning the connection to the creator.
- Enable or lock publishing authority independently from the OAuth connection.

Set `COMPOSIO_API_KEY` and `COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID` in `.env.local`. One agency-level Instagram auth configuration can serve multiple creators; Composio creates a separate connected account for each Creator OS creator and destination. The callback URL is derived from `CREATOR_OS_BASE_URL`.

Before selecting **Connect with Composio**, open Creator OS in the creator's dedicated Chrome profile. Thrill Noir and Adelaide should use their own Google profiles so the browser's active identities do not bleed into one another. A Google profile is not itself publishing permission.

The first Composio adapter is Instagram. Other platform rows remain visibly unavailable until their identity-verification and publishing implementations are added.

### Auth Config inventory

Creator OS uses one Composio project and one reusable Auth Config per toolkit. Creators do not need separate Composio projects.

| Environment setting | Toolkit | Purpose |
| --- | --- | --- |
| `COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID` | Instagram | Identity, publishing and reporting |
| `COMPOSIO_DROPBOX_AUTH_CONFIG_ID` | Dropbox | Temporary direct media links for Instagram ingestion |
| `COMPOSIO_YOUTUBE_AUTH_CONFIG_ID` | YouTube | Channel identity and approved uploads |
| `COMPOSIO_TIKTOK_AUTH_CONFIG_ID` | TikTok | Identity and approved posting where API access permits |
| `COMPOSIO_TWITTER_AUTH_CONFIG_ID` | Twitter/X | Identity and approved posting where the access tier permits |
| `COMPOSIO_REDDIT_AUTH_CONFIG_ID` | Reddit | Identity and approved subreddit submission after API approval |

Dropbox currently requires custom Dropbox OAuth credentials in Composio rather than Composio Managed Auth. Use a dedicated least-privilege Dropbox developer app. Creator OS needs only read access for the configured media tree and temporary-link creation; it does not need delete, move, rename or write access.

## YouTube

Creator OS also supports the Google OAuth web-server flow for a configured YouTube destination.

- Enable YouTube Data API v3 in Google Cloud.
- Create an OAuth 2.0 web application.
- Register the callback URI displayed on `/connections`.
- Creator OS requests `youtube.upload` and `youtube.readonly`.
- Google access and refresh tokens are encrypted separately.
- The callback verifies the real channel ID and title before marking the destination connected.
- The first upload must remain private until its receipt and channel identity are reviewed.

YouTube service accounts are not used because channel actions require user authorization.

## Connection sequence

1. Select the creator and open **Manage profile**.
2. Record the creator's dedicated Google email and Chrome profile name.
3. Add the Instagram destination to the correct creator.
4. Copy `.env.example` to `.env.local`.
5. Generate independent token-encryption and OAuth-state secrets.
6. Add either the Composio project settings or Meta App settings directly to `.env.local`.
7. Restart Creator OS.
8. Confirm the provider readiness checks are green.
9. While using the creator's dedicated browser profile, authorize the matching Instagram account.
10. Verify the returned username and explicitly assign it.
11. Leave publishing locked until a private validation test is ready.
12. Publish only a separately approved test package.

## Publishing queue

Connected destinations still cannot publish automatically. An approved post must be copied into a creator-scoped publishing job and receive a second, explicit publish approval. The job has a stable idempotency key so the same approved version cannot be queued twice accidentally. External execution stays locked until a provider-specific private or validation-only test succeeds.

For Composio Instagram, validation creates the Instagram media container but deliberately stops before the publish call. Live execution requires a separately approved live job, a confirmed creator identity, explicit account-level publishing authority, and a media URL Instagram can retrieve. Localhost URLs are never sent to Instagram.

## Analytics bridge

Manual CSV imports provide reporting before analytics APIs are connected. Creator OS accepts a bounded, reviewed schema and ignores unknown columns. Do not import customer names, emails, payment details, message content, or other unnecessary personal data.

## Later adapters

- YouTube: OAuth upload and channel analytics.
- TikTok: Content Posting API after app review.
- X: only if the required API access tier is worthwhile.
- Reddit: OAuth posting only after Reddit approves the commercial use case and each subreddit target passes current rules.
- Paid creator platforms: desktop-assisted until an official supported API is verified.

## Reddit operations

`/reddit` is the rule-aware distribution workspace.

- Each subreddit has a creator-scoped rules record, official rules URL and verification date.
- Rules older than 30 days block new targets.
- NSFW permission, creator verification, required flair, account-age/karma notes and cooldown are explicit.
- One approved Reddit package may create multiple subreddit targets, but every target has its own title, flair, schedule and human approval.
- A stable idempotency key prevents the same approved package version being queued twice for one community.
- The browser-assisted handoff opens the correct subreddit composer and prepares downloads/copy actions, but stops before Submit.
- OAuth credentials are accepted only after Reddit approves the app/use case.
- External submission stays disabled until the approved API documentation and media-upload flow can be verified live.
