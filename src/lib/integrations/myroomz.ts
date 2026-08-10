import "server-only";

export function getMyRoomzConfiguration() {
  const configured = process.env.MYROOMZ_VAULT_UPLOAD_URL?.trim() || "";
  try {
    const url = new URL(configured);
    const valid = url.protocol === "https:" && url.hostname === "live.myroomz.co" && url.pathname.startsWith("/upload/");
    return { ready: valid, uploadUrl: valid ? url.toString() : "" };
  } catch {
    return { ready: false, uploadUrl: "" };
  }
}
