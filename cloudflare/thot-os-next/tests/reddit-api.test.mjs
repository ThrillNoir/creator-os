import assert from "node:assert/strict";
import test from "node:test";

import { findPublishedImage, imageMimeType, parseMediaLease, parseRedditFlairChoices, parseRedditMediaReceipt, parseRedditPostRequirements, redditApiErrors, redditProfileCommunityName, redditSubmissionWebsocketUrl } from "../../reddit-scheduler/src/reddit-api.ts";

test("derives the profile community only from the verified Reddit identity", () => {
  assert.equal(redditProfileCommunityName("AdelaideSuede"), "u_AdelaideSuede");
  assert.equal(redditProfileCommunityName("u/AdelaideSuede"), "u_AdelaideSuede");
  assert.throws(() => redditProfileCommunityName("different account"), /invalid profile identity/);
});

test("parses Reddit's native media upload lease", () => {
  const lease = parseMediaLease({
    args: {
      action: "//reddit-uploaded-media.s3-accelerate.amazonaws.com",
      fields: [
        { name: "key", value: "rte_images/example.jpg" },
        { name: "policy", value: "signed-policy" },
      ],
    },
  });
  assert.equal(lease.uploadUrl, "https://reddit-uploaded-media.s3-accelerate.amazonaws.com");
  assert.equal(lease.mediaUrl, "https://reddit-uploaded-media.s3-accelerate.amazonaws.com/rte_images/example.jpg");
  assert.throws(() => parseMediaLease({ args: { action: "javascript:alert(1)", fields: [{ name: "key", value: "x" }] } }), /invalid media upload destination/);
});

test("requires a verified native Reddit image receipt", () => {
  const created = Date.now();
  const listing = { data: { children: [{ data: {
    name: "t3_abc123", author: "AdelaideSuede", subreddit: "ExampleSub", title: "Approved title",
    permalink: "/r/ExampleSub/comments/abc123/approved_title/", created_utc: created / 1000,
    post_hint: "image", domain: "i.redd.it", url_overridden_by_dest: "https://i.redd.it/example.jpg",
    link_flair_template_id: "flair-approved",
  } }] } };
  assert.equal(findPublishedImage({ children: listing, expectedAuthor: "u/AdelaideSuede", expectedCommunity: "r/ExampleSub", expectedTitle: "Approved title", submittedAfterMs: created })?.name, "t3_abc123");
  assert.equal(findPublishedImage({ children: listing, expectedAuthor: "different", expectedCommunity: "ExampleSub", expectedTitle: "Approved title", submittedAfterMs: created }), null);
  assert.equal(findPublishedImage({ children: listing, expectedAuthor: "AdelaideSuede", expectedCommunity: "ExampleSub", expectedTitle: "changed", submittedAfterMs: created }), null);
  assert.equal(findPublishedImage({ children: listing, expectedAuthor: "AdelaideSuede", expectedCommunity: "ExampleSub", expectedTitle: "Approved title", submittedAfterMs: created, expectedFlairId: "flair-approved" })?.name, "t3_abc123");
  assert.equal(findPublishedImage({ children: listing, expectedAuthor: "AdelaideSuede", expectedCommunity: "ExampleSub", expectedTitle: "Approved title", submittedAfterMs: created, expectedFlairId: "different-flair" }), null);
});

test("verifies creator-profile receipts without accepting another subreddit", () => {
  const created = Date.now();
  const listing = { data: { children: [{ data: {
    name: "t3_profile123", author: "AdelaideSuede", subreddit: "u_AdelaideSuede", title: "Profile post",
    permalink: "/user/AdelaideSuede/comments/profile123/profile_post/", created_utc: created / 1000,
    post_hint: "image", domain: "i.redd.it", url: "https://i.redd.it/profile.jpg",
  } }] } };
  assert.equal(findPublishedImage({ children: listing, expectedAuthor: "u/AdelaideSuede", expectedCommunity: "u_AdelaideSuede", expectedProfileUsername: "AdelaideSuede", expectedTitle: "Profile post", submittedAfterMs: created })?.name, "t3_profile123");
  assert.equal(findPublishedImage({ children: listing, expectedAuthor: "u/OtherAccount", expectedCommunity: "u_OtherAccount", expectedProfileUsername: "OtherAccount", expectedTitle: "Profile post", submittedAfterMs: created }), null);
  assert.equal(findPublishedImage({ children: { data: { children: [{ data: { ...listing.data.children[0].data, subreddit: "OtherCommunity", permalink: "/r/OtherCommunity/comments/profile123/profile_post/" } }] } }, expectedAuthor: "AdelaideSuede", expectedCommunity: "u_AdelaideSuede", expectedProfileUsername: "AdelaideSuede", expectedTitle: "Profile post", submittedAfterMs: created }), null);
});

test("normalizes image MIME types and Reddit API errors", () => {
  assert.equal(imageMimeType("photo.JPG", "application/octet-stream"), "image/jpeg");
  assert.equal(imageMimeType("photo.png", "image/png; charset=binary"), "image/png");
  assert.throws(() => imageMimeType("clip.mp4"), /supports JPG/);
  assert.deepEqual(redditApiErrors({ json: { errors: [["RATELIMIT", "Try again later", "ratelimit"]] } }), ["RATELIMIT: Try again later: ratelimit"]);
});

test("validates Reddit media websocket and success receipt", () => {
  const websocket = "wss://k8s-lb.wss.redditmedia.com/receipt-token";
  assert.equal(redditSubmissionWebsocketUrl({ json: { data: { websocket_url: websocket } } }), websocket);
  assert.equal(redditSubmissionWebsocketUrl({ json: { data: { websocket_url: null } } }), null);
  assert.throws(() => redditSubmissionWebsocketUrl({ json: { data: { websocket_url: "wss://example.com/steal" } } }), /untrusted/);
  assert.deepEqual(
    parseRedditMediaReceipt(JSON.stringify({ type: "success", payload: { redirect: "https://www.reddit.com/r/Example/comments/abc123/approved/" } })),
    { externalPostId: "t3_abc123", externalUrl: "https://www.reddit.com/r/Example/comments/abc123/approved/" },
  );
  assert.throws(() => parseRedditMediaReceipt({ type: "failed", payload: {} }), /failed while processing/);
  assert.throws(() => parseRedditMediaReceipt({ type: "success", payload: { redirect: "https://example.com/comments/abc123" } }), /invalid/);
});

test("parses Reddit post requirements and user-selectable flair choices", () => {
  assert.deepEqual(parseRedditPostRequirements({ is_flair_required: true }), { flairRequired: true });
  assert.deepEqual(parseRedditPostRequirements({ is_flair_required: false }), { flairRequired: false });
  assert.deepEqual(parseRedditFlairChoices({ choices: [
    { flair_template_id: "flair-one", flair_text: "Verified", flair_text_editable: false },
    { flair_template_id: "flair-two", flair_text: "", flair_text_editable: true },
    { flair_template_id: "flair-one", flair_text: "Duplicate" },
    { flair_text: "Missing ID" },
  ] }), [
    { id: "flair-one", text: "Verified", textEditable: false },
    { id: "flair-two", text: "Untitled flair", textEditable: true },
  ]);
});
