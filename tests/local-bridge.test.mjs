import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { getLocalBridgeUrl, isLocalBridgePlatform, localBridgeProfilePath, normalisePlatformUsername } from "../src/lib/local-bridge/config.ts";
import { redditHasNativeMedia, verifyRedditPostMetadata } from "../cloudflare/vault-bridge/src/reddit-verification.ts";

test("recognises only supported premium bridge platforms", () => {
  assert.equal(isLocalBridgePlatform("onlyfans"), true);
  assert.equal(isLocalBridgePlatform("fansly"), true);
  assert.equal(isLocalBridgePlatform("instagram"), false);
});

test("uses isolated profile paths beneath the approved root", () => {
  const root = path.resolve(".creator-os", "browser-profiles");
  assert.equal(localBridgeProfilePath(root, "adelaide", "adelaide-onlyfans-main"), path.join(root, "adelaide", "adelaide-onlyfans-main"));
  assert.throws(() => localBridgeProfilePath(root, "../adelaide", "account"));
});

test("normalises handles and uses HTTPS native destinations", () => {
  assert.equal(normalisePlatformUsername(" @Adelaide "), "adelaide");
  assert.match(getLocalBridgeUrl("onlyfans", "inbox"), /^https:\/\/onlyfans\.com\//);
  assert.match(getLocalBridgeUrl("fansly", "earnings"), /^https:\/\/fansly\.com\//);
});

test("collector recovery requires an explicit pairing and does not trust Origin as authentication", async () => {
  const [claimRoute, background] = await Promise.all([
    readFile("src/app/api/local-bridge/claim/route.ts", "utf8"),
    readFile("public/local-bridge-extension/background.js", "utf8"),
  ]);
  assert.match(claimRoute, /status:410/);
  assert.doesNotMatch(claimRoute, /claimLocalBridgeCollector/);
  assert.doesNotMatch(background, /api\/local-bridge\/claim/);
  assert.match(background, /Open and pair \$\{platform\} from Creator OS again/);
});

test("Reddit publishing survives extension service-worker suspension and always records an outcome", async () => {
  const [manifestText, background, publisher, bridge] = await Promise.all([
    readFile("public/local-bridge-extension/manifest.json", "utf8"),
    readFile("public/local-bridge-extension/background.js", "utf8"),
    readFile("public/local-bridge-extension/reddit-publisher.js", "utf8"),
    readFile("cloudflare/vault-bridge/src/index.ts", "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.version, "0.9.9");
  const redditScript = manifest.content_scripts.find((entry) => entry.js.includes("reddit-publisher.js"));
  assert.ok(redditScript);
  assert.deepEqual(redditScript.matches, ["https://reddit.com/*", "https://www.reddit.com/*"]);
  assert.match(background, /creatorOsRedditPending/);
  assert.match(background, /state:"composer_opened"/);
  assert.doesNotMatch(background, /waitForRedditReceipt/);
  assert.match(publisher, /state:"submitted"/);
  assert.match(publisher, /externalPostId:`t3_\$\{match\[1\]\}`/);
  assert.match(publisher, /THOT OS stopped before posting/);
  assert.match(publisher, /nativeMediaProof:"reddit-rendered-preview"/);
  assert.match(publisher, /POST-COMPOSER-TOOLBAR-BUTTON-IMAGE/);
  assert.match(publisher, /baselineMedia=new Set\(renderedMediaSignals/);
  assert.match(publisher, /const composerHost=redditComposerHost\(\)/);
  assert.match(publisher, /hasRenderedMedia\(baselineMedia,job\.basename\)/);
  assert.match(publisher, /mediaControl\.input\.files\[0\]\?\.name===basename/);
  assert.match(publisher, /previewChanged&&\(attachedFile\|\|removalControl\)/);
  assert.match(publisher, /style\.backgroundImage/);
  assert.match(publisher, /fillVerifiedControl\(redditTitleControls,job\.title,"title"\)/);
  assert.match(publisher, /Reddit did not retain the approved \$\{label\}/);
  assert.match(publisher, /redditMetadata/);
  assert.match(publisher, /verifiable visible image preview/);
  assert.doesNotMatch(publisher, /new DataTransfer/);
  assert.doesNotMatch(publisher, /NSFW control|tag selection modal|text-category-nsfw|Not Safe For Work/);
  assert.match(background, /DOM\.setFileInputFiles/);
  assert.match(background, /POST-COMPOSER-TOOLBAR-BUTTON-IMAGE/);
  assert.match(background, /rect\.width>0&&rect\.height>0/);
  assert.match(background, /chrome\.downloads\.removeFile/);
  assert.match(bridge, /input\.status === "published" && observedHandle !== expectedHandle/);
  assert.match(bridge, /verifyRedditNativePost/);
  assert.match(bridge, /verifyRedditPostMetadata/);
  assert.match(bridge, /native_publish_rejected/);
  const redditClaim = bridge.slice(bridge.indexOf("async function claimRedditJob"), bridge.indexOf("async function redditMediaResponse"));
  assert.match(redditClaim, /oa\.publishing_mode='local_bridge'/);
  assert.match(redditClaim, /oa\.publishing_authority='device_only'/);
  const redditMedia = bridge.slice(bridge.indexOf("async function redditMediaResponse"), bridge.indexOf("async function recordRedditReceipt"));
  assert.match(redditMedia, /return new Response\(source\.body/);
  assert.match(redditMedia, /oa\.publishing_mode='local_bridge'/);
  assert.match(redditMedia, /oa\.publishing_authority='device_only'/);
  assert.doesNotMatch(redditMedia, /status: 302|location: temporary\.link/);
  const redditReceipt = bridge.slice(bridge.indexOf("async function recordRedditReceipt"), bridge.indexOf("export default"));
  assert.match(redditReceipt, /post\.publishing_mode !== "local_bridge"/);
  assert.match(redditReceipt, /post\.publishing_authority !== "device_only"/);
});

test("Reddit receipts accept native media and reject empty self posts", () => {
  const expected = { title: "Approved image", expected_handle: "u/AdelaideSuede", community_name: "OutdoorRecreation" };
  const image = { id: "abc123", author: "AdelaideSuede", subreddit: "OutdoorRecreation", title: "Approved image", is_self: false, is_reddit_media_domain: true, post_hint: "image", url_overridden_by_dest: "https://i.redd.it/example.jpg" };
  assert.equal(redditHasNativeMedia(image), true);
  assert.equal(verifyRedditPostMetadata(image, "abc123", expected).nativeMedia, true);
  assert.equal(redditHasNativeMedia({ ...image, is_self: true, is_reddit_media_domain: false, post_hint: undefined, url_overridden_by_dest: undefined }), false);
  assert.throws(() => verifyRedditPostMetadata({ ...image, author: "different-user" }, "abc123", expected), /different account/);
  assert.throws(() => verifyRedditPostMetadata({ ...image, subreddit: "different-community" }, "abc123", expected), /different community/);
});

test("Fansly vault uploads use Chrome's native file attachment and verify a receipt", async () => {
  const background = await readFile("public/local-bridge-extension/background.js", "utf8");
  const fanslyFlow = background.slice(background.indexOf("const processVaultQueue"), background.indexOf("let redditPublishRunning"));
  assert.match(background, /attachLocalFileToNativeInput/);
  assert.match(background, /DOM\.setFileInputFiles/);
  assert.match(fanslyFlow, /downloadBridgeMedia\(config,job\)/);
  assert.match(fanslyFlow, /attachLocalFileToNativeInput\(tabId,download\.localMediaPath,"fansly"\)/);
  assert.match(fanslyFlow, /verifyFanslyVaultAttachment/);
  assert.match(fanslyFlow, /discardBridgeDownload\(download\.downloadId\)/);
  assert.match(background, /savedVaultRecord:true/);
  assert.match(background, /externalMediaId/);
  assert.match(background, /did not create a saved vault record/);
});
