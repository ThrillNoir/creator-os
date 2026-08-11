const healthUrl = "https://thot-os-staging.thot-os.workers.dev/health";
const accessToken = process.env.THOT_OS_ACCESS_TOKEN?.trim();
const accessCookie = process.env.THOT_OS_ACCESS_COOKIE?.trim();

if (!accessToken && !accessCookie) {
  throw new Error("Set THOT_OS_ACCESS_TOKEN or THOT_OS_ACCESS_COOKIE to an authenticated Cloudflare Access session. The credential is never printed.");
}

const headers = new Headers({ accept: "application/json" });
if (accessToken) headers.set("cf-access-token", accessToken);
if (accessCookie) headers.set("cookie", `CF_Authorization=${accessCookie}`);

const response = await fetch(healthUrl, { headers, redirect: "manual" });
if (response.status !== 200) {
  throw new Error(`Authenticated health check failed with HTTP ${response.status}.`);
}
const contentType = response.headers.get("content-type") ?? "";
if (!contentType.includes("application/json")) throw new Error("Authenticated health check did not return JSON.");
const result = await response.json();
if (result?.ok !== true || result?.runtime !== "nextjs-opennext" || typeof result?.creatorId !== "string") {
  throw new Error("Authenticated health response did not match the THOT OS contract.");
}

console.log(JSON.stringify({ ok: true, service: result.service, runtime: result.runtime, status: response.status }));
