import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { authorizeCreatorScope, selectCreatorMembership, selectCreatorPortalMembership } from "../src/lib/authorization.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const fixtureCreator = { creator_id: "fixture", creator_name: "Empty Fixture", creator_initials: "EF", role: "creator" };
const fixtureViewer = { ...fixtureCreator, role: "viewer" };
const foreignCreator = { creator_id: "foreign", creator_name: "Foreign", creator_initials: "F", role: "viewer" };

test("creator and viewer scope is derived only from one active membership", () => {
  assert.equal(selectCreatorPortalMembership([fixtureCreator])?.creator_id, "fixture");
  assert.equal(selectCreatorPortalMembership([fixtureViewer])?.creator_id, "fixture");
  assert.equal(selectCreatorMembership([fixtureCreator], null, "foreign")?.creator_id, "fixture");
  assert.equal(selectCreatorMembership([fixtureViewer], null, "foreign")?.creator_id, "fixture");
  assert.equal(selectCreatorMembership([fixtureCreator], "foreign", null), null);
  assert.equal(selectCreatorMembership([fixtureViewer], "foreign", null), null);
  assert.equal(selectCreatorPortalMembership([]), null);
  assert.equal(selectCreatorPortalMembership([fixtureCreator, foreignCreator]), null);
  assert.equal(selectCreatorMembership([fixtureCreator, foreignCreator], null, null), null);
});

test("viewer mutations and role spoofing fail closed without changing authorization", () => {
  assert.deepEqual(authorizeCreatorScope([fixtureViewer], "mutate", "fixture", null), { ok: false, status: 404 });
  assert.deepEqual(authorizeCreatorScope([fixtureViewer], "approve", "fixture", null), { ok: false, status: 404 });
  assert.deepEqual(authorizeCreatorScope([{ ...fixtureViewer, role: "agency_admin" }], "manage_identity", "foreign", null), { ok: false, status: 404 });
  assert.equal(authorizeCreatorScope([fixtureCreator], "mutate", "fixture", "foreign").status, 200);
});

test("the creator portal shell has no switcher or agency controls", async () => {
  const shell = await source("../src/components/app-shell.tsx");
  const portal = shell.slice(shell.indexOf("function CreatorPortalShell"), shell.indexOf("export async function AppShell"));
  assert.match(portal, /Creator portal/);
  assert.match(portal, /Signed in/);
  assert.match(portal, /Creator workspace/);
  assert.match(portal, /fixed by your active THOT OS membership/);
  assert.doesNotMatch(portal, /switchCreatorAction|creator-picker|<select|Creators|Migration progress/);
  assert.match(shell, /function AgencyShell/);
  assert.match(shell, /switchCreatorAction/);
  assert.match(shell, /agencyNavigation/);
});

test("viewer interface is read-only and hidden controls are denied server-side", async () => {
  const [library, asset, operations, messages, migration, actions] = await Promise.all([
    source("../src/app/library/page.tsx"),
    source("../src/app/library/[objectId]/page.tsx"),
    source("../src/app/operations/page.tsx"),
    source("../src/app/messages/page.tsx"),
    source("../src/app/migration/page.tsx"),
    source("../src/app/actions.ts"),
  ]);
  assert.match(library, /roleCan\(context\.creator\.role, "mutate"\)/);
  assert.match(library, /Read-only workspace/);
  assert.match(asset, /Viewer access is read-only/);
  assert.match(operations, /context\.creator\.role === "viewer"\) notFound\(\)/);
  assert.match(messages, /context\.creator\.role === "viewer"\) notFound\(\)/);
  assert.match(migration, /requireCreatorContext\("manage_identity"\)/);
  assert.doesNotMatch(actions, /formData\.get\(["'](?:creatorId|actor_?role|role)["']\)/);
  assert.match(actions, /requireCreatorContext\("mutate"\)/);
  assert.match(actions, /identity\.creator\.role/);
});

test("Accounts exposes creator-scoped Instagram OAuth state without treating connection as publishing", async () => {
  const [accounts, actions] = await Promise.all([
    source("../src/app/accounts/page.tsx"),
    source("../src/app/actions.ts"),
  ]);
  assert.match(accounts, /Official Instagram connection/);
  assert.match(accounts, /WHERE oa\.creator_id=\? AND oa\.platform='instagram'/);
  assert.match(accounts, /provider_connections pc ON pc\.creator_id=oa\.creator_id AND pc\.service='instagram'/);
  assert.match(accounts, /startInstagramReconnectAction/);
  assert.match(accounts, /Connect Instagram/);
  assert.match(accounts, /does not create, schedule or publish content/i);
  assert.match(accounts, /Open read-only analytics/);
  assert.match(actions, /requireCreatorContext\("manage_identity"\)/);
  assert.match(actions, /instagram\.connection\.manage/);
});

test("creator APIs return only the effective server-derived workspace", async () => {
  const [libraryApi, previewApi, health, access, qaPage] = await Promise.all([
    source("../src/app/api/library/route.ts"),
    source("../src/app/api/preview/[objectId]/route.ts"),
    source("../src/app/health/route.ts"),
    source("../src/lib/access.ts"),
    source("../src/app/staging-qa/page.tsx"),
  ]);
  assert.match(libraryApi, /creatorId: context\.creator\.creator_id/);
  assert.match(libraryApi, /status: 404/);
  assert.match(previewApi, /ma\.authority_kind='r2_native'/);
  assert.match(previewApi, /a\.creator_id=\?/);
  assert.match(health, /WHERE creator_id=\?/);
  assert.match(access, /cf-access-jwt-assertion/);
  assert.doesNotMatch(access, /cf-access-authenticated-user-email/);
  assert.match(qaPage, /STAGING_QA_ENABLED/);
  assert.match(qaPage, /STAGING QA/);
});

test("the non-browser health checker requires Access authentication and never prints credentials", async () => {
  const checker = await source("../scripts/check-authenticated-health.mjs");
  assert.match(checker, /THOT_OS_ACCESS_TOKEN/);
  assert.match(checker, /THOT_OS_ACCESS_COOKIE/);
  assert.match(checker, /cf-access-token/);
  assert.match(checker, /CF_Authorization/);
  assert.match(checker, /https:\/\/thot-os-staging\.thot-os\.workers\.dev\/health/);
  assert.doesNotMatch(checker, /THOT_OS_HEALTH_BASE_URL/);
  assert.doesNotMatch(checker, /console\.log\([^\n]*(?:accessToken|accessCookie)/);
  assert.match(checker, /assertUnauthenticatedHealthDenied/);
  assert.match(checker, /validateAuthenticatedHealth/);
  assert.match(checker, /artifact-manifest/);
});

test("Access PIN PBKDF2 stays within the Workers limit and verifies with the stored iteration count", async () => {
  const vault = await source("../src/lib/access-vault.ts");
  assert.match(vault, /const PIN_ITERATIONS = 100_000/);
  assert.match(vault, /const MAX_PIN_ITERATIONS = 100_000/);
  assert.match(vault, /iterations > MAX_PIN_ITERATIONS/);
  assert.match(vault, /SELECT id,pin_scope,salt,verifier,kdf_iterations,locked_until/);
  assert.match(vault, /pinVerifier\(input\.pin, row\.salt, row\.kdf_iterations\)/);
  assert.doesNotMatch(vault, /310_000/);
});
