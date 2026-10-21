import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("../src/portfolio-release.ts", import.meta.url), "utf8");
const start = source.indexOf("async function sourceForCard(");
const end = source.indexOf("\nasync function sha256(", start);
const code = stripTypeScriptTypes(source.slice(start, end));
const poster = "creators/adelaide/assets/preview-a/previews/old.jpg";
const card = { id: "card-a", assetId: "preview-a", fullLengthAssetId: null, kind: "video", title: "Clip",
  description: "", section: "Clips", previewKey: "", posterKey: poster };

function fixture(revoked = false, codec = "h264") {
  const checked = [];
  const row = { preview_r2_key: "creators/adelaide/assets/preview-a/previews/new.jpg", is_teaser: 0,
    teaser_for_asset_id: null, source_codec: codec, state: "canonical_verified", object_key: "private-canonical",
    sha256: "a".repeat(64), byte_count: 1000, verified_mime_type: "video/mp4", r2_version: "v1", r2_etag: "etag" };
  const env = { PREVIEWS: { async head(key) { return key === poster ? { size: 100 } : null; } },
    DB: { prepare(sql) { return { bind() { return { async first() { return sql.includes("SELECT a.preview_r2_key") ? row : { id: "preview-a" }; } }; } }; } } };
  const sourceForCard = new Function("assertAssetConsent", "SHA", "MAX_VIDEO_BYTES", `${code};return sourceForCard;`)(
    async (_env, _creatorId, assetId) => { checked.push(assetId); if (revoked) throw new Error("portfolio_media_rights_or_consent_missing"); },
    /^[a-f0-9]{64}$/, 64 * 1024 * 1024,
  );
  return { checked, run: (pinned) => sourceForCard(env, "adelaide", card, 2, pinned) };
}

test("a new private thumbnail does not withdraw the already pinned public copy", async () => {
  const { checked, run } = fixture();
  await assert.rejects(run(false), /portfolio_short_preview_changed_or_too_large/);
  const source = await run(true);
  assert.equal(source.poster.key, poster);
  assert.deepEqual(checked, ["preview-a", "preview-a"]);
});

test("ongoing consent revocation still invalidates a pinned release", async () => {
  await assert.rejects(fixture(true).run(true), /portfolio_media_rights_or_consent_missing/);
});

test("verified H.265 uses the same short preview source checks as H.264", async () => {
  const source = await fixture(false, "h265").run(true);
  assert.equal(source.preview.mime, "video/mp4");
  assert.equal(source.preview.key, "private-canonical");
});
